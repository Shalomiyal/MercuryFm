-- Shared, serverless-safe rate limiting. No destructive statements.
create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from anon, authenticated;
grant select, insert, update on table public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_interval interval;
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or p_limit is null or p_limit < 1
     or p_window_ms is null or p_window_ms < 1 then
    return query select false, 1;
    return;
  end if;

  v_interval := (p_window_ms || ' milliseconds')::interval;

  insert into public.rate_limit_buckets as b (key, window_start, hits, updated_at)
  values (p_key, v_now, 1, v_now)
  on conflict (key) do update
     set window_start = case
           when b.window_start + v_interval <= v_now then v_now
           else b.window_start
         end,
         hits = case
           when b.window_start + v_interval <= v_now then 1
           else b.hits + 1
         end,
         updated_at = v_now
  returning b.window_start, b.hits into v_start, v_hits;

  if v_hits <= p_limit then
    return query select true, 0;
  else
    return query select false, greatest(
      1,
      ceil(extract(epoch from (v_start + v_interval - v_now)))::integer
    );
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
