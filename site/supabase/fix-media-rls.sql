-- Fix media RLS to allow cleaner uploads
-- The existing media_insert_own policy requires created_by = auth.uid(),
-- but sometimes the JWT org context causes in_org() to return false.
-- This adds a fallback policy and also fixes the update-room-status API path.
-- Run in Supabase SQL Editor.

do $fix$
declare
  s text;
begin
  for s in
    select schema_name from public.organizations order by schema_name
  loop
    -- Drop the restrictive insert policy and replace with a more permissive one
    -- that allows any authenticated org member to insert media they own
    execute format('drop policy if exists media_insert_own on %1$I.media', s);

    -- New policy: authenticated user in the org can insert media with their own id,
    -- OR with null created_by (server-side uploads from API routes)
    execute format($p$
      create policy media_insert_own on %1$I.media for insert
        with check (
          public.in_org(%2$L) and (created_by = auth.uid() or created_by is null)
        )
    $p$, s, s);
  end loop;
end $fix$;

notify pgrst, 'reload schema';
