-- Ensure authenticated policy evaluation can resolve the private authorization helpers.
grant usage on schema private to authenticated;

-- Ensure every authenticated account can receive an owner membership, even if the Auth account has no email.
create or replace function public.enterprise_create_workspace(workspace_name text default 'My Studio')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
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
  select v_workspace_id,v_user_id,coalesce(u.email,v_user_id||'@no-email.invalid'),
         coalesce(u.raw_user_meta_data->>'full_name',nullif(split_part(coalesce(u.email,''),'@',1),''),'Studio Owner'),
         'owner','active'
  from auth.users u where u.id = (select auth.uid())
  on conflict (workspace_id,email) do nothing;
  return v_workspace_id;
end;
$func$;
revoke all on function public.enterprise_create_workspace(text) from public, anon;
grant execute on function public.enterprise_create_workspace(text) to authenticated;
