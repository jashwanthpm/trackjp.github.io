-- Sakkhi Enterprise CRM and studio operations foundation.
-- Intentionally uses enterprise_* tables only; never reads or writes Solo Creator tables.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.enterprise_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  name text not null default 'My Studio',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  user_id text,
  email text not null,
  display_name text,
  role text not null default 'crew' check (role in ('owner','admin','manager','finance','shooter','crew','editor')),
  status text not null default 'invited' check (status in ('invited','active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create unique index if not exists enterprise_workspace_members_user_unique
  on public.enterprise_workspace_members(workspace_id,user_id) where user_id is not null;

create table if not exists public.enterprise_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  client_type text not null default 'direct',
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  client_id uuid references public.enterprise_clients(id) on delete set null,
  source text,
  event_type text,
  event_date date,
  location text,
  budget numeric(12,2) not null default 0,
  requirements text,
  status text not null default 'new' check (status in ('new','contacted','qualified','quoted','won','lost')),
  follow_up_at timestamptz,
  assigned_to text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  client_id uuid references public.enterprise_clients(id) on delete set null,
  lead_id uuid references public.enterprise_leads(id) on delete set null,
  quote_number text not null,
  title text not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  terms text,
  bank_details jsonb not null default '{}'::jsonb,
  led_requirements text,
  status text not null default 'draft' check (status in ('draft','sent','viewed','approved','rejected','expired','converted')),
  public_token_hash text unique,
  expires_at timestamptz,
  approved_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, quote_number)
);

create table if not exists public.enterprise_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  client_id uuid references public.enterprise_clients(id) on delete set null,
  quote_id uuid references public.enterprise_quotes(id) on delete set null,
  shoot_id text,
  invoice_number text not null,
  status text not null default 'unpaid' check (status in ('draft','issued','part_paid','paid','overdue','void')),
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  due_date date,
  items jsonb not null default '[]'::jsonb,
  terms text,
  issued_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, invoice_number)
);

create table if not exists public.enterprise_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  invoice_id uuid not null references public.enterprise_invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text,
  reference text,
  notes text,
  recorded_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.enterprise_crew (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  user_id text,
  name text not null,
  email text,
  phone text,
  role text not null default 'crew',
  employment_type text not null default 'freelance' check (employment_type in ('in_house','freelance','vendor')),
  payout_rate numeric(12,2) not null default 0,
  payout_basis text not null default 'per_event' check (payout_basis in ('per_event','per_day','fixed')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_shoot_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  crew_id uuid not null references public.enterprise_crew(id) on delete cascade,
  assignment_role text not null default 'crew',
  call_time timestamptz,
  payout_amount numeric(12,2) not null default 0,
  payout_status text not null default 'pending' check (payout_status in ('pending','approved','paid','cancelled')),
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, shoot_id, crew_id, assignment_role)
);

create table if not exists public.enterprise_gear (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  asset_tag text not null,
  name text not null,
  category text not null default 'other',
  brand text,
  model text,
  serial_number text,
  replacement_value numeric(12,2) not null default 0,
  condition text not null default 'good' check (condition in ('new','good','needs_service','damaged','retired')),
  status text not null default 'available' check (status in ('available','checked_out','maintenance','retired')),
  qr_token text not null default encode(gen_random_bytes(18),'hex') unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, asset_tag)
);

create table if not exists public.enterprise_gear_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  gear_id uuid not null references public.enterprise_gear(id) on delete restrict,
  shoot_id text,
  checked_out_to text not null,
  checked_out_by text not null,
  checked_out_at timestamptz not null default now(),
  due_back_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by text,
  checkout_condition text,
  return_condition text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.enterprise_shoot_expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  submitted_by text not null,
  category text not null default 'travel',
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  receipt_path text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','reimbursed')),
  reviewed_by text,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  notes text
);

create table if not exists public.enterprise_data_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  dumped_by text not null,
  dump_completed_at timestamptz,
  primary_storage_type text,
  primary_storage_location text,
  backup_storage_type text,
  backup_storage_location text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','issue')),
  verified_by text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  name text not null,
  pipeline_type text not null default 'photo' check (pipeline_type in ('photo','video','film','album','general')),
  sort_order integer not null default 0,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, pipeline_type, name)
);

create table if not exists public.enterprise_production_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  task_type text not null default 'photo' check (task_type in ('photo','video','film','teaser','album','other')),
  title text not null,
  stage_id uuid references public.enterprise_pipeline_stages(id) on delete set null,
  assigned_to text,
  due_date date,
  notes text,
  status text not null default 'queued' check (status in ('queued','in_progress','review','blocked','complete')),
  completed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_album_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  title text not null default 'Wedding Album',
  status text not null default 'design' check (status in ('design','internal_review','client_approval','approved','printing','ready','delivered')),
  design_link text,
  client_approved_at timestamptz,
  sent_to_print_at timestamptz,
  delivered_at timestamptz,
  vendor_name text,
  tracking_reference text,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_portal_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  shoot_id text not null,
  client_id uuid references public.enterprise_clients(id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.enterprise_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.enterprise_workspaces(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('client_payment','crew_payout','expense_review','follow_up','gear_return','delivery')),
  subject_id uuid,
  shoot_id text,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','snoozed','resolved','cancelled')),
  recipient text,
  message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists enterprise_leads_workspace_status_idx on public.enterprise_leads(workspace_id,status,follow_up_at);
create index if not exists enterprise_quotes_workspace_status_idx on public.enterprise_quotes(workspace_id,status,created_at desc);
create index if not exists enterprise_invoices_workspace_due_idx on public.enterprise_invoices(workspace_id,status,due_date);
create index if not exists enterprise_assignments_workspace_shoot_idx on public.enterprise_shoot_assignments(workspace_id,shoot_id);
create index if not exists enterprise_gear_checkout_active_idx on public.enterprise_gear_checkouts(workspace_id,checked_in_at);
create index if not exists enterprise_tasks_workspace_status_idx on public.enterprise_production_tasks(workspace_id,status,due_date);
create index if not exists enterprise_portal_tokens_lookup_idx on public.enterprise_portal_tokens(token_hash,revoked_at,expires_at);

-- Authorization helpers live in a non-exposed schema. Role data is never read from user-editable metadata.
create or replace function private.enterprise_has_workspace_role(p_workspace_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.enterprise_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())::text
      and m.status = 'active'
      and (p_roles is null or m.role = any(p_roles))
  );
$$;
revoke all on function private.enterprise_has_workspace_role(uuid,text[]) from public, anon;
grant execute on function private.enterprise_has_workspace_role(uuid,text[]) to authenticated;

create or replace function public.enterprise_create_workspace(workspace_name text default 'My Studio')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id text;
  v_workspace_id uuid;
  v_name text;
begin
  v_user_id := (select auth.uid())::text;
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  select id into v_workspace_id
  from public.enterprise_workspaces
  where owner_user_id = v_user_id
  order by created_at
  limit 1;
  if v_workspace_id is not null then
    return v_workspace_id;
  end if;
  v_name := coalesce(nullif(trim(workspace_name),''),'My Studio');
  insert into public.enterprise_workspaces(owner_user_id,name)
  values(v_user_id,v_name)
  returning id into v_workspace_id;
  insert into public.enterprise_workspace_members(workspace_id,user_id,email,display_name,role,status)
  select v_workspace_id,v_user_id,u.email,coalesce(u.raw_user_meta_data->>'full_name',split_part(u.email,'@',1)),'owner','active'
  from auth.users u where u.id = (select auth.uid())
  on conflict (workspace_id,email) do nothing;
  return v_workspace_id;
end;
$$;
revoke all on function public.enterprise_create_workspace(text) from public, anon;
grant execute on function public.enterprise_create_workspace(text) to authenticated;

-- All new Enterprise tables are isolated from Solo Creator data and guarded by workspace membership.
do $$
declare t text;
begin
  foreach t in array array[
    'enterprise_workspaces','enterprise_workspace_members','enterprise_clients','enterprise_leads',
    'enterprise_quotes','enterprise_invoices','enterprise_invoice_payments','enterprise_crew',
    'enterprise_shoot_assignments','enterprise_gear','enterprise_gear_checkouts','enterprise_shoot_expenses',
    'enterprise_data_logs','enterprise_pipeline_stages','enterprise_production_tasks','enterprise_album_jobs',
    'enterprise_portal_tokens','enterprise_reminders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists enterprise_workspace_select on public.enterprise_workspaces;
create policy enterprise_workspace_select on public.enterprise_workspaces
for select to authenticated using (private.enterprise_has_workspace_role(id, null));

drop policy if exists enterprise_workspace_update on public.enterprise_workspaces;
create policy enterprise_workspace_update on public.enterprise_workspaces
for update to authenticated using (private.enterprise_has_workspace_role(id, array['owner','admin']))
with check (private.enterprise_has_workspace_role(id, array['owner','admin']));

drop policy if exists enterprise_member_select on public.enterprise_workspace_members;
create policy enterprise_member_select on public.enterprise_workspace_members
for select to authenticated using (private.enterprise_has_workspace_role(workspace_id, null));

drop policy if exists enterprise_member_manage on public.enterprise_workspace_members;
create policy enterprise_member_manage on public.enterprise_workspace_members
for all to authenticated using (private.enterprise_has_workspace_role(workspace_id, array['owner','admin']))
with check (private.enterprise_has_workspace_role(workspace_id, array['owner','admin']));

do $$
declare t text;
begin
  foreach t in array array[
    'enterprise_clients','enterprise_leads','enterprise_quotes','enterprise_invoices',
    'enterprise_invoice_payments','enterprise_crew','enterprise_shoot_assignments',
    'enterprise_gear','enterprise_gear_checkouts','enterprise_shoot_expenses',
    'enterprise_data_logs','enterprise_pipeline_stages','enterprise_production_tasks',
    'enterprise_album_jobs','enterprise_portal_tokens','enterprise_reminders'
  ] loop
    execute format('drop policy if exists enterprise_workspace_member_all on public.%I', t);
    execute format(
      'create policy enterprise_workspace_member_all on public.%I for all to authenticated using (private.enterprise_has_workspace_role(workspace_id, null)) with check (private.enterprise_has_workspace_role(workspace_id, null))',
      t
    );
  end loop;
end $$;

grant select, insert, update, delete on
  public.enterprise_workspaces, public.enterprise_workspace_members, public.enterprise_clients,
  public.enterprise_leads, public.enterprise_quotes, public.enterprise_invoices,
  public.enterprise_invoice_payments, public.enterprise_crew, public.enterprise_shoot_assignments,
  public.enterprise_gear, public.enterprise_gear_checkouts, public.enterprise_shoot_expenses,
  public.enterprise_data_logs, public.enterprise_pipeline_stages, public.enterprise_production_tasks,
  public.enterprise_album_jobs, public.enterprise_portal_tokens, public.enterprise_reminders
to authenticated;
