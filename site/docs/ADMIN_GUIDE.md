# Administrator guide

Applies to `org_admin` and `admin` accounts. `org_admin` can also manage users
and the room list.

## First sign-in

1. Sign in at `/login` with the organization code, your email, and the temporary
   password supplied by your administrator. The temporary password is shown
   only once when the account is created; store it securely before refreshing
   the page.
2. If prompted, enter the 6-digit verification code sent to your email. Codes
   expire after 10 minutes, allow 5 attempts, and can be resent once every
   60 seconds.
3. You will be required to set a new password. Use a unique password; NIC
   numbers are identity data only and are never used as passwords.
4. The **Last updated** bar in the top-right shows when data was last refreshed.
   Use **Refresh** at any time. The moon/sun button switches light and dark mode.

## Dashboard (`/admin`)

- Room counters and today's task counters are aggregated in the database.
- Use the branch filter to narrow the room grid and activity list.
- Long lists show a **Show more** button instead of loading every row at once.
- Dates and times use 12-hour formatting in your local timezone.

## Room status (`/admin/rooms`)

- Select a status for a room from the status control. Each change is written to
  room status history with a timestamp.
- The list and history both support branch filtering and **Show more**.

## Rooms setup (`/admin/rooms-setup`, org_admin only)

- Upload an Excel workbook (`.xlsx`) or paste CSV with `branch_id` and `room_id`
  columns. Download the sample file to see the expected shape.
- Rows are stored as a draft in your browser until you choose **Save**. The
  status line tells you whether the draft differs from the saved list.
- Add, edit, and remove rows in the table. Search filters the draft without
  changing it. You can save again at any time.
- `rooms_locked=true` only means rooms have been loaded at least once; it does
  not prevent later edits.

## Templates (`/admin/templates`)

- Create a template manually, or use **Sample Excel** / **Import Excel**.
- Task sheets require `Task name` and `Finish time`; `Start time` is optional.
  Any other header becomes a named custom field, and the cell value becomes
  that field's default.
- Deletions ask for confirmation in the app instead of a browser dialog.

## Daily tasks (`/admin/tasks`)

- Pick a work date, choose a template and cleaner, then create an assignment.
- Open an assignment to review tasks, start/finish times, and cleaner-entered
  custom field values.
- Removing a task asks for confirmation and cannot be undone.

## Users (`/admin/users`, org_admin only)

- Create an invite for an `admin` or `cleaner` account. Choose an optional email
  to restrict who can redeem it, and an expiry up to 30 days.
- Send the invite code to the user over a trusted channel. Codes are single-use
  and stored only as hashes.
- Signup requires the organization slug, invite code, full name, NIC, optional
  phone, and email. The signup response displays a randomly generated temporary
  password once.
- Use **Create user** when you need to create an account directly; the temporary
  password is also shown once there.
- Role changes, deactivation, password resets, and deletions are audited and
  ask for confirmation where appropriate.
- NIC is visible to staff through the protected `tenant_users()` RPC. It is
  never a password and is never exposed to cleaners.

## If something looks wrong

- Use **Refresh** in the top bar; Realtime normally updates pages automatically.
- Friendly error messages replace raw database errors. If a message says you do
  not have access, sign out and back in so your role is reloaded from the server.
- See `docs/RUNBOOK.md` for common incidents.
