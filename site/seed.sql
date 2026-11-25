insert into branches (branch_id)
values ('Downtown'), ('Uptown'), ('Airport')
on conflict (branch_id) do nothing;

insert into rooms (room_id, branch_id, current_status)
values
  ('101', 'Downtown', null),
  ('102', 'Downtown', null),
  ('103', 'Downtown', null),
  ('104', 'Airport', null),
  ('105', 'Airport', null),
  ('106', 'Uptown', null)
on conflict (room_id) do nothing;
