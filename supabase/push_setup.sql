-- Sakkhi push notifications. Safe to run repeatedly. Contains no secrets
-- (the key below is the public anon key already in app.html).

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Locked down on purpose: nobody reads or writes this table directly.
-- Devices register through the two functions below; the server-side sender
-- (service role) is the only thing that reads it.
alter table public.push_subscriptions enable row level security;

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_ua text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, last_seen)
  values (p_endpoint, auth.uid()::text, p_p256dh, p_auth, p_ua, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen = now();
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid()::text;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Fire a push whenever the server adds a notification (new booking via your
-- link, admin announcements, ...). pg_net sends it after the insert commits;
-- a failure here is only logged and can never block the notification itself.
create extension if not exists pg_net;

create or replace function public.push_on_new_notification()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url := 'https://smyupcjfusgduaoxqfvu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNteXVwY2pmdXNnZHVhb3hxZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NjA3MzIsImV4cCI6MjA5NTQzNjczMn0.pGg9ZIYWpZ70R_HNtRl7FHrzeUNA5vlZT6hNkjDzhqo',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNteXVwY2pmdXNnZHVhb3hxZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NjA3MzIsImV4cCI6MjA5NTQzNjczMn0.pGg9ZIYWpZ70R_HNtRl7FHrzeUNA5vlZT6hNkjDzhqo'
      ),
      body := jsonb_build_object('type', 'INSERT', 'record', jsonb_build_object('id', new.id))
    );
  exception when others then
    raise warning 'push trigger failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists push_on_new_notification on public.notifications;
create trigger push_on_new_notification
  after insert on public.notifications
  for each row execute function public.push_on_new_notification();
