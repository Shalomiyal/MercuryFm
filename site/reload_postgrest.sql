select public.refresh_exposed_schemas();
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
