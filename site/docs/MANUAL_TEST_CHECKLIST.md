# Manual Test Checklist

## Admin

- [ ] Sign in with the first admin account.
- [ ] Confirm dashboard and admin-only navigation are visible.
- [ ] Confirm a cleaner account cannot open admin routes.
- [ ] Filter dashboard and room status by each branch.
- [ ] Update a room status with date and time.
- [ ] Confirm `rooms.current_status` and `rooms.status_time` update.
- [ ] Open History and confirm entered time and saved time are shown.
- [ ] Create a template and at least two tasks with both start and finish times.
- [ ] Add a named custom field with a default value to a template task.
- [ ] Download the sample task workbook, fill it in, and import it as a new template.
- [ ] Confirm every extra Excel header becomes a named custom field on that task.
- [ ] Edit a template without changing previously assigned daily tasks.
- [ ] Delete a template.
- [ ] Create an assigned daily task for today using a template.
- [ ] Confirm `load_template_tasks` copies task names, start/finish times, and field defaults into `daily_tasks` / `daily_task_field_values`.
- [ ] Add, edit, and remove a day-only task, including start time and custom field values.
- [ ] Confirm day-only edits do not change the template.
- [ ] Import a `.xlsx` room list on Branches and rooms; confirm unsaved state, search, discard, and save.
- [ ] Create admins and cleaners through the Users page as an org admin.
- [ ] Sign out and confirm protected routes return to login.

## Cleaning staff

- [ ] Sign in with a cleaner account.
- [ ] Confirm cleaner navigation and task list are visible.
- [ ] Confirm a cleaner cannot open admin routes.
- [ ] Confirm today's tasks are sorted by start time, then finish time.
- [ ] Confirm custom field values from the assignment are visible on the task card.
- [ ] Open Details, change a custom field value, save, and confirm it persists after reload.
- [ ] Filter Not started, In progress, and Completed tasks.
- [ ] Start a task and confirm a photo is required.
- [ ] Confirm the photo is compressed before upload.
- [ ] Confirm upload progress reaches 100%.
- [ ] Confirm the task becomes In progress with a start timestamp and database media ID.
- [ ] Reject a video over 15 MB.
- [ ] Reject a video over 60 seconds.
- [ ] Reject a video taller or wider than 480p limits.
- [ ] Finish an in-progress task with a valid video.
- [ ] Confirm the task becomes Completed with a finish timestamp and database media ID.
- [ ] Open History, choose dates, and confirm task and media details.
- [ ] Confirm a cleaner cannot view or update another cleaner's task.
- [ ] Sign out and confirm protected routes return to login.

## Security and setup verification

- [ ] Service role/secret and `SUPABASE_DB_URL` are absent from browser code.
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` is used only for browser requests.
- [ ] A user without a matching `profiles.role` cannot access protected pages.
- [ ] Direct database writes still fail when RLS denies the caller.
- [ ] The cleaner upload API rejects a task not assigned to the signed-in cleaner.
- [ ] Create two active organizations and one user in each.
- [ ] Sign in to organization A and confirm organization B rooms, tasks, history, and media are hidden.
- [ ] Attempt to call organization B's schema directly from organization A's browser session and confirm RLS denies access.
- [ ] Confirm `media_chunks` is not readable by the browser and media can only be retrieved through `/api/media/[id]`.
- [ ] Confirm a cleaner cannot retrieve another user's media.
- [ ] Confirm an org admin/admin can only retrieve media inside their organization.
- [ ] Verify deactivated organizations return no active `my_schema()` and refresh exposed schemas.
- [ ] Platform owner logs in only through `/platform-login`.
- [ ] Organization users sign in with Organization ID, email, and password.
- [ ] A wrong Organization ID or mismatched profile returns the generic login error.
- [ ] A newly created org admin/admin/cleaner is forced to change the temporary password.
- [ ] Password reset email opens `/auth/callback` and then `/reset-password`, where the password changes.
- [ ] Platform owner and org admin sign in with email and password on their own pages.
- [ ] Organization login requires Organization ID, email, and password.
- [ ] Entering another organization's ID signs the user out with the generic login error.
- [ ] First-login users are sent to forced password change or email verification.
- [ ] Forgot password never switches SMS/phone; it sends a single-use email link.
- [ ] Signup link creates the profile and shows the NIC initial password.
