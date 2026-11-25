-- Room Status & Cleaning Management System: Supabase (Postgres) schema
-- Run in the Supabase SQL editor.

-- Types ---------------------------------------------------------------
create type user_role   as enum ('admin', 'cleaner');
create type room_status as enum ('check_in', 'check_out', 'clean_start', 'clean_finished', 'ready');
create type task_state  as enum ('in_progress', 'completed');

-- Users and roles (login itself is handled by Supabase Auth) -----------
create table profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role      user_role not null default 'cleaner'
);

-- Branch table: loaded once, locked --------------------------------------
create table branches (
  branch_id text primary key
);

-- MAIN ROOM TABLE: the current status lives here as columns ---------------
create table rooms (
  room_id        text primary key,
  branch_id      text not null references branches(branch_id),
  current_status room_status,          -- latest status (kept in sync by trigger below)
  status_time    timestamptz,          -- time the Admin entered for that status
  updated_at     timestamptz default now()
);

-- Every status change is also logged here, so the History button works --
create table room_status_history (
  id          bigint generated always as identity primary key,
  room_id     text not null references rooms(room_id),
  status      room_status not null,
  status_time timestamptz not null,                 -- time entered by the Admin
  created_at  timestamptz not null default now(),   -- date and time the entry was saved
  created_by  uuid references profiles(id)
);
create index on room_status_history (room_id, created_at desc);

-- The Admin only inserts into room_status_history; this copies the newest
-- entry into the main rooms table.
create function sync_room_status() returns trigger
language plpgsql security definer as $$
begin
  update rooms
     set current_status = new.status,
         status_time    = new.status_time,
         updated_at     = now()
   where room_id = new.room_id;
  return new;
end $$;

create trigger trg_sync_room_status
after insert on room_status_history
for each row execute function sync_room_status();

-- Tasks (Admin) ----------------------------------------------------------
create table tasks (
  id          bigint generated always as identity primary key,
  task_name   text not null,
  finish_by   time not null,                          -- finish-by time set by Admin
  is_default  boolean not null default true,          -- true = every day
  task_date   date,                                   -- only for add-on tasks (one date)
  assigned_to uuid references profiles(id),           -- cleaning staff
  created_at  timestamptz not null default now(),
  check ((is_default and task_date is null) or (not is_default and task_date is not null))
);

-- Cleaner work on a task (one row per task per day) -----------------------
create table task_runs (
  id               bigint generated always as identity primary key,
  task_id          bigint not null references tasks(id),
  run_date         date not null default current_date,
  cleaner_id       uuid not null references profiles(id),
  started_at       timestamptz,        -- start time
  start_photo_url  text,               -- Google Drive link (photo)
  finished_at      timestamptz,        -- finish time
  finish_video_url text,               -- video link
  state            task_state not null default 'in_progress',
  unique (task_id, run_date)
);

-- Row level security ------------------------------------------------------
create function is_admin() returns boolean
language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles             enable row level security;
alter table branches             enable row level security;
alter table rooms                enable row level security;
alter table room_status_history  enable row level security;
alter table tasks                enable row level security;
alter table task_runs            enable row level security;

create policy "read profiles"  on profiles  for select using (auth.uid() is not null);
create policy "read branches"  on branches  for select using (auth.uid() is not null);
create policy "read rooms"     on rooms     for select using (auth.uid() is not null);
-- No insert/update/delete policies on branches or rooms: they are locked
-- from the app. Changes are made by you in the SQL editor / service role.

create policy "admin reads history"   on room_status_history for select using (is_admin());
create policy "admin writes history"  on room_status_history for insert with check (is_admin());

create policy "admin manages tasks"   on tasks for all using (is_admin()) with check (is_admin());
create policy "cleaner reads own tasks" on tasks for select using (assigned_to = auth.uid());

create policy "admin reads runs"      on task_runs for select using (is_admin());
create policy "cleaner own runs"      on task_runs for all
  using (cleaner_id = auth.uid()) with check (cleaner_id = auth.uid());
