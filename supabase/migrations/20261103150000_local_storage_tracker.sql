-- Local storage metadata only. No media files are uploaded to Supabase.
-- Solo Creator storage records are scoped to the authenticated Sakkhi user.

create table if not exists public.storage_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_key text not null,
  device_name text not null,
  platform text not null check (platform in ('macos','windows','linux')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_key),
  unique (id, user_id)
);

create table if not exists public.storage_drives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  drive_key text not null,
  volume_name text not null,
  mount_point text not null,
  filesystem text,
  total_bytes bigint,
  available_bytes bigint,
  is_removable boolean,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, drive_key),
  unique (id, user_id),
  unique (id, device_id, user_id),
  foreign key (device_id, user_id)
    references public.storage_devices(id, user_id) on delete cascade,
  check (total_bytes is null or total_bytes >= 0),
  check (available_bytes is null or available_bytes >= 0)
);

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shoot_id text not null references public.shoots(id) on delete cascade,
  device_id uuid not null,
  drive_id uuid not null,
  label text not null,
  category text not null default 'other'
    check (category in ('main','raw','video','edited','deliverables','backup','other')),
  relative_path text not null,
  is_primary boolean not null default false,
  is_available boolean,
  last_verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (device_id, user_id)
    references public.storage_devices(id, user_id) on delete cascade,
  foreign key (drive_id, device_id, user_id)
    references public.storage_drives(id, device_id, user_id) on delete cascade,
  check (length(trim(label)) > 0),
  check (relative_path !~ '(^/|^[A-Za-z]:[/\\\\])')
);

create index if not exists storage_devices_user_seen_idx
  on public.storage_devices(user_id, last_seen_at desc);
create index if not exists storage_drives_user_device_idx
  on public.storage_drives(user_id, device_id);
create index if not exists storage_locations_user_shoot_idx
  on public.storage_locations(user_id, shoot_id);
create index if not exists storage_locations_drive_idx
  on public.storage_locations(drive_id);

alter table public.storage_devices enable row level security;
alter table public.storage_drives enable row level security;
alter table public.storage_locations enable row level security;

revoke all on public.storage_devices, public.storage_drives, public.storage_locations from anon;
grant select, insert, update, delete on public.storage_devices, public.storage_drives, public.storage_locations to authenticated;

drop policy if exists "Users manage their own storage devices" on public.storage_devices;
create policy "Users manage their own storage devices"
  on public.storage_devices for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own storage drives" on public.storage_drives;
create policy "Users manage their own storage drives"
  on public.storage_drives for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.storage_devices d
      where d.id = storage_drives.device_id
        and d.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.storage_devices d
      where d.id = storage_drives.device_id
        and d.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users manage their own shoot storage locations" on public.storage_locations;
create policy "Users manage their own shoot storage locations"
  on public.storage_locations for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shoots s
      where s.id = storage_locations.shoot_id
        and s.user_id = (select auth.uid())::text
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shoots s
      where s.id = storage_locations.shoot_id
        and s.user_id = (select auth.uid())::text
    )
    and exists (
      select 1 from public.storage_drives d
      where d.id = storage_locations.drive_id
        and d.device_id = storage_locations.device_id
        and d.user_id = (select auth.uid())
    )
  );
