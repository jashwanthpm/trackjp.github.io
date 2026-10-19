-- Role-specific policies for Sakkhi Enterprise. Crew and editors do not receive finance access.
create or replace function private.enterprise_is_assigned_to_shoot(p_workspace_id uuid, p_shoot_id text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $
  select exists (
    select 1
    from public.enterprise_shoot_assignments a
    join public.enterprise_crew c on c.id = a.crew_id
    where a.workspace_id = p_workspace_id
      and a.shoot_id = p_shoot_id
      and c.user_id = (select auth.uid())::text
  );
$;
revoke all on function private.enterprise_is_assigned_to_shoot(uuid,text) from public, anon;
grant execute on function private.enterprise_is_assigned_to_shoot(uuid,text) to authenticated;

drop policy if exists enterprise_workspace_member_all on public.enterprise_clients;
drop policy if exists enterprise_workspace_member_all on public.enterprise_leads;
drop policy if exists enterprise_workspace_member_all on public.enterprise_quotes;
drop policy if exists enterprise_workspace_member_all on public.enterprise_invoices;
drop policy if exists enterprise_workspace_member_all on public.enterprise_invoice_payments;
drop policy if exists enterprise_workspace_member_all on public.enterprise_crew;
drop policy if exists enterprise_workspace_member_all on public.enterprise_shoot_assignments;
drop policy if exists enterprise_workspace_member_all on public.enterprise_gear;
drop policy if exists enterprise_workspace_member_all on public.enterprise_gear_checkouts;
drop policy if exists enterprise_workspace_member_all on public.enterprise_shoot_expenses;
drop policy if exists enterprise_workspace_member_all on public.enterprise_data_logs;
drop policy if exists enterprise_workspace_member_all on public.enterprise_pipeline_stages;
drop policy if exists enterprise_workspace_member_all on public.enterprise_production_tasks;
drop policy if exists enterprise_workspace_member_all on public.enterprise_album_jobs;
drop policy if exists enterprise_workspace_member_all on public.enterprise_portal_tokens;
drop policy if exists enterprise_workspace_member_all on public.enterprise_reminders;

-- CRM and money are restricted to studio leadership / finance.
do $$ declare t text; begin
  foreach t in array array['enterprise_clients','enterprise_leads','enterprise_quotes','enterprise_invoices','enterprise_invoice_payments','enterprise_reminders']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'',''finance'']))',t||'_finance_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'',''finance'']))',t||'_finance_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'',''finance''])) with check (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'',''finance'']))',t||'_finance_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'']))',t||'_leadership_delete',t);
  end loop;
end $$;

-- Crew roster and gear inventory are managed by leadership only.
do $$ declare t text; begin
  foreach t in array array['enterprise_crew','enterprise_gear','enterprise_pipeline_stages']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'']))',t||'_manager_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'']))',t||'_manager_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager''])) with check (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'',''manager'']))',t||'_manager_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.enterprise_has_workspace_role(workspace_id,array[''owner'',''admin'']))',t||'_manager_delete',t);
  end loop;
end $$;

-- Assignment rows are visible to leadership and to the crew member assigned to that event.
create policy enterprise_assignments_manager_all on public.enterprise_shoot_assignments
for all to authenticated
using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']));
create policy enterprise_assignments_assigned_read on public.enterprise_shoot_assignments
for select to authenticated using (
  private.enterprise_has_workspace_role(workspace_id,array['shooter','crew'])
  and private.enterprise_is_assigned_to_shoot(workspace_id,shoot_id)
);

-- Crew can check out gear only to themselves and view their own checkout history.
create policy enterprise_gear_team_read on public.enterprise_gear
for select to authenticated using (
  status <> 'retired' and private.enterprise_has_workspace_role(workspace_id,array['shooter','crew'])
);
create policy enterprise_checkouts_manager_all on public.enterprise_gear_checkouts
for all to authenticated
using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']));
create policy enterprise_checkouts_self_read on public.enterprise_gear_checkouts
for select to authenticated using (
  private.enterprise_has_workspace_role(workspace_id,array['shooter','crew'])
  and checked_out_to=(select auth.uid())::text
);
create policy enterprise_checkouts_self_insert on public.enterprise_gear_checkouts
for insert to authenticated with check (
  private.enterprise_has_workspace_role(workspace_id,array['shooter','crew'])
  and checked_out_to=(select auth.uid())::text
  and checked_out_by=(select auth.uid())::text
);

-- Crew submit expenses; only finance/leadership can review the whole ledger.
create policy enterprise_expenses_finance_read on public.enterprise_shoot_expenses
for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','finance']));
create policy enterprise_expenses_self_read on public.enterprise_shoot_expenses
for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['shooter','crew']) and submitted_by=(select auth.uid())::text);
create policy enterprise_expenses_self_insert on public.enterprise_shoot_expenses
for insert to authenticated with check (private.enterprise_has_workspace_role(workspace_id,array['shooter','crew','owner','admin','manager','finance']) and submitted_by=(select auth.uid())::text);
create policy enterprise_expenses_review on public.enterprise_shoot_expenses
for update to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','finance']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','finance']));
create policy enterprise_expenses_delete on public.enterprise_shoot_expenses
for delete to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin']));

-- Data logs are available to leadership, editors and assigned production crew, never to finance-only roles by default.
create policy enterprise_data_logs_read on public.enterprise_data_logs
for select to authenticated using (
  private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','editor'])
  or (private.enterprise_has_workspace_role(workspace_id,array['shooter','crew'])
      and private.enterprise_is_assigned_to_shoot(workspace_id,shoot_id))
);
create policy enterprise_data_logs_write on public.enterprise_data_logs
for all to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','editor']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','editor']));

-- Editors work on post-production tasks and albums, not invoices or client ledgers.
create policy enterprise_tasks_read on public.enterprise_production_tasks
for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','editor']));
create policy enterprise_tasks_manage on public.enterprise_production_tasks
for all to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']));
create policy enterprise_tasks_editor_update on public.enterprise_production_tasks
for update to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['editor']) and (assigned_to=(select auth.uid())::text or assigned_to is null))
with check (private.enterprise_has_workspace_role(workspace_id,array['editor']) and (assigned_to=(select auth.uid())::text or assigned_to is null));

create policy enterprise_albums_read on public.enterprise_album_jobs
for select to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager','editor']));
create policy enterprise_albums_leadership_all on public.enterprise_album_jobs
for all to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']));
create policy enterprise_albums_editor_update on public.enterprise_album_jobs
for update to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['editor']))
with check (private.enterprise_has_workspace_role(workspace_id,array['editor']));

-- Portal tokens are never available to anonymous clients via the Data API. A server-side portal function
-- must validate the token hash and return a deliberately limited status payload.
create policy enterprise_portal_tokens_manager_all on public.enterprise_portal_tokens
for all to authenticated using (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']))
with check (private.enterprise_has_workspace_role(workspace_id,array['owner','admin','manager']));

-- Useful indexes for workspace scoping and related lookups.
create index if not exists enterprise_clients_workspace_idx on public.enterprise_clients(workspace_id);
create index if not exists enterprise_crew_workspace_idx on public.enterprise_crew(workspace_id);
create index if not exists enterprise_gear_workspace_idx on public.enterprise_gear(workspace_id);
create index if not exists enterprise_album_jobs_workspace_idx on public.enterprise_album_jobs(workspace_id);
create index if not exists enterprise_portal_tokens_workspace_idx on public.enterprise_portal_tokens(workspace_id);
create index if not exists enterprise_invoice_payments_invoice_idx on public.enterprise_invoice_payments(invoice_id);
create index if not exists enterprise_quotes_client_idx on public.enterprise_quotes(client_id);
create index if not exists enterprise_invoices_client_idx on public.enterprise_invoices(client_id);
create index if not exists enterprise_invoices_quote_idx on public.enterprise_invoices(quote_id);
create index if not exists enterprise_leads_client_idx on public.enterprise_leads(client_id);
create index if not exists enterprise_production_tasks_stage_idx on public.enterprise_production_tasks(stage_id);
create index if not exists enterprise_gear_checkouts_gear_idx on public.enterprise_gear_checkouts(gear_id);
create index if not exists enterprise_shoot_assignments_crew_idx on public.enterprise_shoot_assignments(crew_id);
