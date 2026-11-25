-- Run once in the Supabase SQL Editor before using 6-digit email verification.
-- Safe to re-run.

-- The "emailVerified" field on the public auth map.
alter table public.profiles
  add column if not exists email_verified boolean not null default false;

-- Existing accounts were verified through the old email link flow.
update public.profiles set email_verified = true where email_verified = false;

-- Only a SHA-256 hash of each code is stored. No plaintext code is persisted.
create table if not exists public.email_verification_codes (
  email         text primary key,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      integer not null default 0,
  last_sent_at  timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete cascade
);

alter table public.email_verification_codes enable row level security;

-- Server-only table: no anon/authenticated policies or grants.
revoke all on public.email_verification_codes from anon, authenticated;
grant select, insert, update, delete on public.email_verification_codes to service_role;

-- The server also updates email_verified on profiles with the service role.
grant select, update (email_verified) on public.profiles to service_role;

notify pgrst, 'reload schema';
