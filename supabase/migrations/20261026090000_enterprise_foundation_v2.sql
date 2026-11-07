-- Sakkhi Enterprise foundation v2. Safe to run more than once.
-- Needs the three earlier enterprise migrations (the check below stops with a clear message if they are missing).

do $$ begin
  if to_regclass('public.enterprise_workspaces') is null then
    raise exception 'Apply the earlier enterprise migrations first: enterprise_workspaces does not exist yet.';
  end if;
end $$;

-- 1. Bug fix: the invoices table defaulted to a status ("unpaid") that its own check constraint rejects.
alter table public.enterprise_invoices alter column status set default 'issued';

-- 2. Studio profile (used on invoices, enquiry forms and the company settings page).
alter table public.enterprise_workspaces
  add column if not exists slug text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists gstin text,
  add column if not exists logo_url text,
  add column if not exists currency text not null default 'INR',
  add column if not exists invoice_prefix text not null default 'INV',
  add column if not exists invoice_terms text,
  add column if not exists bank_details jsonb not null default '{}'::jsonb;
create unique index if not exists enterprise_workspaces_slug_key on public.enterprise_workspaces (lower(slug)) where slug is not null;

-- 3. Leads: a lead exists before any client record, so it carries its own contact details.
alter table public.enterprise_leads
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists message text,
  add column if not exists form_id uuid,
  add column if not exists lost_reason text,
  add column if not exists priority text not null default 'normal',
  add column if not exists notes text;
create index if not exists enterprise_leads_ws_status_idx on public.enterprise_leads (workspace_id, status, created_at desc);
create index if not exists enterprise_leads_ws_followup_idx on public.enterprise_leads (workspace_id, follow_up_at) where follow_up_at is not null;

-- 4. Enquiry forms (the public page at /enquiry/?f=<token>).
create table if not exists public.enterprise_inquiry_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  name text not null default 'Website enquiry form',
  token text not null unique default encode(gen_random_bytes(9), 'hex'),
  is_active boolean not null default true,
  title text not null default 'Tell us about your event',
  intro text not null default 'Share a few details and our team will get back to you shortly.',
  event_types text[] not null default array['Wedding','Pre-wedding','Engagement','Birthday','Corporate event','Product / Commercial','Other'],
  ask_date boolean not null default true,
  ask_location boolean not null default true,
  ask_budget boolean not null default true,
  success_message text not null default 'Thank you! We have received your enquiry and will contact you soon.',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists enterprise_inquiry_forms_ws_idx on public.enterprise_inquiry_forms (workspace_id);

-- 5. Notifications shown in the Enterprise bell. read_by holds the user ids who have read each one.
create table if not exists public.enterprise_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  user_id text,                                   -- null = for everyone in `audience`
  audience text[] not null default array['owner','admin','manager','finance'],
  kind text not null default 'info',
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  read_by text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists enterprise_notifications_ws_idx on public.enterprise_notifications (workspace_id, created_at desc);

alter table public.enterprise_inquiry_forms enable row level security;
alter table public.enterprise_notifications enable row level security;

drop policy if exists enterprise_forms_manage on public.enterprise_inquiry_forms;
create policy enterprise_forms_manage on public.enterprise_inquiry_forms for all to authenticated
  using (private.enterprise_has_workspace_role(workspace_id, array['owner','admin','manager']))
  with check (private.enterprise_has_workspace_role(workspace_id, array['owner','admin','manager']));

drop policy if exists enterprise_notifications_read on public.enterprise_notifications;
create policy enterprise_notifications_read on public.enterprise_notifications for select to authenticated
  using ((user_id is null or user_id = auth.uid()::text) and private.enterprise_has_workspace_role(workspace_id, audience));

grant select, insert, update, delete on public.enterprise_inquiry_forms to authenticated;
grant select on public.enterprise_notifications to authenticated;

-- 6. Mark notifications as read for the signed-in user.
create or replace function public.enterprise_mark_notifications_read(p_workspace_id uuid, p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not private.enterprise_has_workspace_role(p_workspace_id, null) then raise exception 'not allowed'; end if;
  update public.enterprise_notifications n
     set read_by = array_append(n.read_by, auth.uid()::text)
   where n.workspace_id = p_workspace_id
     and not (auth.uid()::text = any(n.read_by))
     and (n.user_id is null or n.user_id = auth.uid()::text)
     and private.enterprise_has_workspace_role(n.workspace_id, n.audience)
     and (p_ids is null or n.id = any(p_ids));
end $$;
revoke all on function public.enterprise_mark_notifications_read(uuid, uuid[]) from public, anon;
grant execute on function public.enterprise_mark_notifications_read(uuid, uuid[]) to authenticated;

-- 7. Public enquiry form: read what to show, and submit. Visitors are anonymous, so these are the only doors.
create or replace function public.enterprise_get_public_form(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.enterprise_inquiry_forms; w public.enterprise_workspaces;
begin
  select * into f from public.enterprise_inquiry_forms where token = p_token and is_active;
  if not found then return null; end if;
  select * into w from public.enterprise_workspaces where id = f.workspace_id;
  return jsonb_build_object('studio', w.name, 'phone', w.phone, 'logo', w.logo_url, 'title', f.title, 'intro', f.intro,
    'event_types', to_jsonb(f.event_types), 'ask_date', f.ask_date, 'ask_location', f.ask_location, 'ask_budget', f.ask_budget,
    'success_message', f.success_message);
end $$;

create or replace function public.enterprise_submit_inquiry(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.enterprise_inquiry_forms; v_name text; v_email text; v_phone text; v_msg text; v_type text; v_loc text;
        v_budget numeric; v_date date; v_id uuid;
begin
  select * into f from public.enterprise_inquiry_forms where token = p_token and is_active;
  if not found then raise exception 'This form is not accepting enquiries right now.'; end if;
  -- Bots fill the hidden "website" field. Pretend it worked and store nothing.
  if coalesce(p_payload->>'website', '') <> '' then return jsonb_build_object('ok', true, 'message', f.success_message); end if;

  v_name  := left(btrim(coalesce(p_payload->>'name', '')), 120);
  v_email := lower(left(btrim(coalesce(p_payload->>'email', '')), 160));
  v_phone := left(btrim(coalesce(p_payload->>'phone', '')), 30);
  v_msg   := left(btrim(coalesce(p_payload->>'message', '')), 2000);
  v_type  := left(btrim(coalesce(p_payload->>'event_type', '')), 60);
  v_loc   := left(btrim(coalesce(p_payload->>'location', '')), 160);
  if v_name = '' then raise exception 'Please enter your name.'; end if;
  if v_email = '' and regexp_replace(v_phone, '[^0-9]', '', 'g') = '' then raise exception 'Please enter a phone number or an email address.'; end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.'; end if;
  begin v_budget := least(nullif(regexp_replace(coalesce(p_payload->>'budget', ''), '[^0-9.]', '', 'g'), '')::numeric, 999999999); exception when others then v_budget := null; end;
  begin v_date := nullif(p_payload->>'event_date', '')::date; exception when others then v_date := null; end;

  -- Flood control: 30 enquiries per form per 10 minutes. The same contact twice within 10 minutes counts once.
  if (select count(*) from public.enterprise_leads where form_id = f.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'We are receiving a lot of enquiries right now. Please try again in a few minutes.';
  end if;
  if exists (select 1 from public.enterprise_leads where form_id = f.id and created_at > now() - interval '10 minutes'
             and ((v_email <> '' and contact_email = v_email) or (v_phone <> '' and contact_phone = v_phone))) then
    return jsonb_build_object('ok', true, 'message', f.success_message);
  end if;

  insert into public.enterprise_leads (workspace_id, source, event_type, event_date, location, budget, requirements, status, created_by,
                                       contact_name, contact_email, contact_phone, message, form_id)
  values (f.workspace_id, 'Enquiry form', nullif(v_type, ''), v_date, nullif(v_loc, ''), coalesce(v_budget, 0), nullif(v_msg, ''), 'new', 'public-form',
          v_name, nullif(v_email, ''), nullif(v_phone, ''), nullif(v_msg, ''), f.id)
  returning id into v_id;

  insert into public.enterprise_notifications (workspace_id, kind, title, body, link, entity_type, entity_id)
  values (f.workspace_id, 'lead', 'New enquiry from ' || v_name,
          coalesce(nullif(v_type, ''), 'Enquiry') || coalesce(' · ' || to_char(v_date, 'DD Mon YYYY'), ''), 'leads.html?id=' || v_id, 'lead', v_id);

  return jsonb_build_object('ok', true, 'message', f.success_message);
end $$;

revoke all on function public.enterprise_get_public_form(text) from public;
revoke all on function public.enterprise_submit_inquiry(text, jsonb) from public;
grant execute on function public.enterprise_get_public_form(text) to anon, authenticated;
grant execute on function public.enterprise_submit_inquiry(text, jsonb) to anon, authenticated;
