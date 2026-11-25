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

-- Templates (Admin): reusable task lists such as Morning shift / Night shift
create table task_templates (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
create table template_tasks (
  id          bigint generated always as identity primary key,
  template_id bigint not null references task_templates(id) on delete cascade,
  task_name   text not null,
  finish_by   time not null,
  sort_order  int not null default 0
);

-- Daily assignment: the Admin picks a date, a template and a cleaner.
create table daily_assignments (
  id          bigint generated always as identity primary key,
  work_date   date not null,
  template_id bigint references task_templates(id) on delete set null,
  cleaner_id  uuid not null references profiles(id),
  unique (work_date, cleaner_id, template_id)
);

-- The template's tasks are COPIED here when loaded. Add / edit / remove on a
-- day changes only these rows, never the template.
create table daily_tasks (
  id            bigint generated always as identity primary key,
  assignment_id bigint not null references daily_assignments(id) on delete cascade,
  task_name     text not null,
  finish_by     time not null
);

create function load_template_tasks(p_assignment bigint) returns void
language sql security definer as $$
  insert into daily_tasks (assignment_id, task_name, finish_by)
  select a.id, t.task_name, t.finish_by
    from daily_assignments a
    join template_tasks t on t.template_id = a.template_id
   where a.id = p_assignment
   order by t.sort_order;
$$;

-- Cleaner work on a daily task (history screen reads this by run_date)
create table task_runs (
  id               bigint generated always as identity primary key,
  daily_task_id    bigint not null references daily_tasks(id) on delete cascade,
  run_date         date not null default current_date,
  cleaner_id       uuid not null references profiles(id),
  started_at       timestamptz,
  start_photo_url  text,
  finished_at      timestamptz,
  finish_video_url text,
  state            task_state not null default 'in_progress',
  unique (daily_task_id)
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
alter table task_templates       enable row level security;
alter table template_tasks       enable row level security;
alter table daily_assignments    enable row level security;
alter table daily_tasks          enable row level security;
alter table task_runs            enable row level security;

create policy "read profiles"  on profiles  for select using (auth.uid() is not null);
create policy "read branches"  on branches  for select using (auth.uid() is not null);
create policy "read rooms"     on rooms     for select using (auth.uid() is not null);
-- No insert/update/delete policies on branches or rooms: they are locked
-- from the app. Changes are made by you in the SQL editor / service role.

create policy "admin reads history"   on room_status_history for select using (is_admin());
create policy "admin writes history"  on room_status_history for insert with check (is_admin());

create policy "admin manages templates" on task_templates    for all using (is_admin()) with check (is_admin());
create policy "admin manages tpl tasks" on template_tasks    for all using (is_admin()) with check (is_admin());
create policy "admin manages assignments" on daily_assignments for all using (is_admin()) with check (is_admin());
create policy "admin manages daily tasks" on daily_tasks      for all using (is_admin()) with check (is_admin());
create policy "cleaner reads own assignments" on daily_assignments for select using (cleaner_id = auth.uid());
create policy "cleaner reads own daily tasks" on daily_tasks for select using (
  exists (select 1 from daily_assignments a where a.id = assignment_id and a.cleaner_id = auth.uid()));

create policy "admin reads runs"      on task_runs for select using (is_admin());
create policy "cleaner own runs"      on task_runs for all
  using (cleaner_id = auth.uid()) with check (cleaner_id = auth.uid());
