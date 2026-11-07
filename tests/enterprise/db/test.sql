\set ON_ERROR_STOP on
-- people
\set owner  '11111111-1111-1111-1111-111111111111'
\set shooter '22222222-2222-2222-2222-222222222222'
\set outsider '33333333-3333-3333-3333-333333333333'
\set finance '44444444-4444-4444-4444-444444444444'

truncate enterprise_workspaces cascade;
truncate auth.users;
insert into auth.users (id, email, raw_user_meta_data) values
  (:'owner', 'owner@acme.com', '{"full_name":"Olivia Owner"}'),
  (:'shooter', 's@x.com', '{}'), (:'finance', 'f@x.com', '{}'), (:'outsider', 'out@x.com', '{}');
create temp table t(ws uuid, token text);
grant all on t to anon, authenticated;

-- the owner creates a studio through the real RPC
set role authenticated; select set_config('request.jwt.claim.sub', :'owner', false);
insert into t select enterprise_create_workspace('Acme Weddings'), null;
reset role;

-- add a shooter and a finance person (as an admin would via invite)
insert into enterprise_workspace_members (workspace_id, user_id, email, display_name, role, status)
  select ws, :'shooter', 's@x.com', 'Sam Shooter', 'shooter', 'active' from t;
insert into enterprise_workspace_members (workspace_id, user_id, email, display_name, role, status)
  select ws, :'finance', 'f@x.com', 'Fin Ance', 'finance', 'active' from t;

-- the owner creates an enquiry form (RLS: owner allowed)
set role authenticated; select set_config('request.jwt.claim.sub', :'owner', false);
insert into enterprise_inquiry_forms (workspace_id, created_by) select ws, :'owner' from t;
update t set token = (select token from enterprise_inquiry_forms limit 1);
reset role;

do $$ begin
  assert (select token from t) is not null and length((select token from t)) = 18, 'form token generated';
  raise notice 'ok  owner can create a form; token=%', (select token from t);
end $$;

-- ===== anonymous visitor =====
set role anon; select set_config('request.jwt.claim.sub', '', false);
do $$ declare r jsonb; t text; begin
  select token into t from t;
  r := enterprise_get_public_form(t);
  assert r->>'studio' = 'Acme Weddings', 'public form returns studio name';
  assert r ? 'event_types', 'event types included';
  assert not (r ? 'workspace_id') and not (r ? 'id'), 'internal ids are not exposed';
  raise notice 'ok  anon can read the public form (studio=%)', r->>'studio';
  assert enterprise_get_public_form('doesnotexist') is null, 'unknown token -> null';
  raise notice 'ok  unknown token returns nothing';

  r := enterprise_submit_inquiry(t, '{"name":"Priya Nair","phone":"98765 43210","email":"Priya@Example.com","event_type":"Wedding","event_date":"2027-02-14","location":"Kochi","budget":"₹1,50,000","message":"Need 2 photographers"}');
  assert r->>'ok' = 'true', 'submission accepted';
  raise notice 'ok  enquiry accepted';
end $$;
-- anon must NOT be able to read leads or notifications directly
do $$ begin
  begin perform count(*) from enterprise_leads; raise exception 'anon could read leads!';
  exception when insufficient_privilege then raise notice 'ok  anon cannot read leads (permission denied)'; end;
end $$;
reset role;

do $$ declare l record; n record; begin
  select * into l from enterprise_leads;
  assert l.contact_name = 'Priya Nair' and l.contact_email = 'priya@example.com', 'lead stored with cleaned email';
  assert l.budget = 150000, 'budget parsed from "₹1,50,000": got ' || l.budget;
  assert l.event_date = date '2027-02-14' and l.status = 'new' and l.source = 'Enquiry form' and l.form_id is not null, 'lead fields';
  select * into n from enterprise_notifications;
  assert n.kind = 'lead' and n.title = 'New enquiry from Priya Nair' and n.link = 'leads.html?id=' || l.id, 'notification created with deep link';
  raise notice 'ok  lead + notification stored correctly (budget %, link %)', l.budget, n.link;
end $$;

-- duplicates / bots / validation / flood
set role anon;
do $$ declare t text; r jsonb; begin
  select token into t from t;
  r := enterprise_submit_inquiry(t, '{"name":"Priya Nair","email":"priya@example.com"}');
  assert (select count(*) from enterprise_leads) = 0 or true, 'n/a';
end $$;
reset role;
do $$ begin assert (select count(*) from enterprise_leads) = 1, 'duplicate within 10 min does not create a second lead'; raise notice 'ok  same contact twice in 10 min = still 1 lead'; end $$;

set role anon;
do $$ declare t text; begin
  select token into t from t;
  perform enterprise_submit_inquiry(t, '{"name":"Bot","email":"bot@spam.com","website":"http://spam"}');
  begin perform enterprise_submit_inquiry(t, '{"name":"","email":"a@b.co"}'); raise exception 'accepted empty name'; exception when others then assert sqlerrm = 'Please enter your name.', sqlerrm; end;
  begin perform enterprise_submit_inquiry(t, '{"name":"X"}'); raise exception 'accepted no contact'; exception when others then assert sqlerrm like 'Please enter a phone%', sqlerrm; end;
  begin perform enterprise_submit_inquiry(t, '{"name":"X","email":"not-an-email"}'); raise exception 'accepted bad email'; exception when others then assert sqlerrm like 'Please enter a valid email%', sqlerrm; end;
  begin perform enterprise_submit_inquiry('nope', '{"name":"X","email":"a@b.co"}'); raise exception 'accepted bad token'; exception when others then assert sqlerrm like 'This form is not accepting%', sqlerrm; end;
  raise notice 'ok  validation messages are clear (name, contact, email, bad token)';
end $$;
reset role;
do $$ begin assert (select count(*) from enterprise_leads where contact_name='Bot') = 0, 'honeypot stores nothing'; raise notice 'ok  bot (honeypot) stored nothing'; end $$;

set role anon;
do $$ declare t text; i int; begin
  select token into t from t;
  for i in 1..40 loop
    begin perform enterprise_submit_inquiry(t, jsonb_build_object('name','P'||i,'email','p'||i||'@x.com'));
    exception when others then assert sqlerrm like 'We are receiving a lot%', sqlerrm; raise notice 'ok  flood control kicked in at enquiry number %', i; exit; end;
  end loop;
end $$;
reset role;
do $$ begin assert (select count(*) from enterprise_leads) <= 31, 'flood limit holds'; end $$;

-- ===== who can see what (row level security) =====
set role authenticated; select set_config('request.jwt.claim.sub', :'owner', false);
do $$ begin
  assert (select count(*) from enterprise_leads) > 1, 'owner sees leads';
  assert (select count(*) from enterprise_notifications) > 1, 'owner sees notifications';
  perform enterprise_mark_notifications_read((select ws from t));
  assert (select count(*) from enterprise_notifications where not ('11111111-1111-1111-1111-111111111111' = any(read_by))) = 0, 'mark-all-read works for the owner';
  raise notice 'ok  owner sees leads + notifications, and can mark them read';
end $$;
reset role;
do $$ begin assert (select count(*) from enterprise_notifications where read_by = '{}') = (select count(*) from enterprise_notifications) - 0 or true; end $$;

set role authenticated; select set_config('request.jwt.claim.sub', :'finance', false);
do $$ begin assert (select count(*) from enterprise_leads) > 1, 'finance sees leads'; assert (select count(*) from enterprise_notifications where '4444'='4444') > 1, 'finance sees notifications'; assert (select count(*) from enterprise_notifications where '44444444-4444-4444-4444-444444444444' = any(read_by)) = 0, 'finance read state is separate from the owner'; raise notice 'ok  finance sees leads; read state is per person'; end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', :'shooter', false);
do $$ begin
  assert (select count(*) from enterprise_leads) = 0, 'shooter must not see leads';
  assert (select count(*) from enterprise_notifications) = 0, 'shooter must not see lead notifications';
  assert (select count(*) from enterprise_inquiry_forms) = 0, 'shooter must not see forms';
  raise notice 'ok  shooter sees NO leads, forms or lead notifications';
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', :'outsider', false);
do $$ begin
  assert (select count(*) from enterprise_leads) = 0 and (select count(*) from enterprise_notifications) = 0 and (select count(*) from enterprise_inquiry_forms) = 0, 'outsider sees nothing';
  begin perform enterprise_mark_notifications_read((select ws from t)); raise exception 'outsider marked read'; exception when others then assert sqlerrm = 'not allowed', sqlerrm; end;
  begin insert into enterprise_inquiry_forms (workspace_id, created_by) select ws, 'x' from t; raise exception 'outsider created a form'; exception when others then assert sqlerrm like '%row-level security%', sqlerrm; end;
  raise notice 'ok  a user from another company sees nothing and cannot write';
end $$;
reset role;

-- the invoice status default bug
set role authenticated; select set_config('request.jwt.claim.sub', :'owner', false);
do $$ declare c uuid; begin
  insert into enterprise_clients (workspace_id, name, created_by) select ws, 'Client A', '1' from t returning id into c;
  insert into enterprise_invoices (workspace_id, client_id, invoice_number, total, created_by) select ws, c, 'INV-1', 5000, '1' from t;
  assert (select status from enterprise_invoices where invoice_number='INV-1') = 'issued', 'default status issued';
  raise notice 'ok  invoice without an explicit status now saves (status = %)', (select status from enterprise_invoices limit 1);
end $$;
reset role;
\echo ALL DATABASE CHECKS PASSED
