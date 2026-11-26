import { getAdminClient } from '../lib/serverSupabase.js'
import { verifyTenantCaller, json, poolForDb, pgIdent } from './media/_tenant.js'
import { writeAuditLog } from '../lib/audit.js'

const ALLOWED_ADMIN_STATUSES = ['ready', 'check_in', 'check_out']
const ALLOWED_CLEANER_STATUSES = ['clean_start', 'clean_finished']

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }

  let caller
  try {
    caller = await verifyTenantCaller(request)
  } catch (error) {
    return json(response, error.status || 401, { error: error.message })
  }

  const { userId, profile, organization } = caller
  const { roomId, status, statusTime } = request.body || {}

  if (!roomId || !status) {
    return json(response, 400, { error: 'Room ID and status are required' })
  }

  const isStaff = profile.role === 'org_admin' || profile.role === 'admin'
  const isCleaner = profile.role === 'cleaner'

  if (isCleaner && !ALLOWED_CLEANER_STATUSES.includes(status)) {
    return json(response, 403, {
      error: 'Cleaning staff can only update status to clean_start or clean_finished',
    })
  }

  if (isStaff && !ALLOWED_ADMIN_STATUSES.includes(status)) {
    const allValid = [...ALLOWED_ADMIN_STATUSES, ...ALLOWED_CLEANER_STATUSES]
    if (!allValid.includes(status)) {
      return json(response, 400, { error: `Invalid room status: ${status}` })
    }
  }

  const timestamp = statusTime ? new Date(statusTime).toISOString() : new Date().toISOString()
  const rawSchema = organization.schema_name

  // Prefer direct Postgres pool (bypasses PostgREST tenant-schema permission gaps)
  let updated = false
  if (process.env.SUPABASE_DB_URL) {
    const schema = pgIdent(rawSchema)
    const pool = poolForDb()
    const client = await pool.connect()
    try {
      try {
        await client.query(
          `insert into ${schema}.room_status_history (room_id, status, status_time, created_by)
           values ($1, $2::public.room_status, $3::timestamptz, $4)`,
          [roomId, status, timestamp, userId],
        )
        updated = true
      } catch (pgErr) {
        if (/foreign key|created_by/i.test(pgErr.message)) {
          await client.query(
            `insert into ${schema}.room_status_history (room_id, status, status_time, created_by)
             values ($1, $2::public.room_status, $3::timestamptz, null)`,
            [roomId, status, timestamp],
          )
          updated = true
        } else {
          throw pgErr
        }
      }
    } catch (pgError) {
      console.error('PG pool update-room-status failed:', pgError.message)
      return json(response, 400, { error: pgError.message })
    } finally {
      client.release()
    }
  }

  if (!updated) {
    const { client: serverClient, error: clientError } = getAdminClient()
    if (clientError || !serverClient) {
      return json(response, 500, { error: 'Database client unavailable' })
    }

    let { error: insertError } = await serverClient
      .schema(rawSchema)
      .from('room_status_history')
      .insert({
        room_id: roomId,
        status,
        status_time: timestamp,
        created_by: userId,
      })

    if (insertError && /foreign key|created_by/i.test(insertError.message)) {
      const retry = await serverClient
        .schema(rawSchema)
        .from('room_status_history')
        .insert({
          room_id: roomId,
          status,
          status_time: timestamp,
          created_by: null,
        })
      insertError = retry.error
    }

    if (insertError) {
      console.error('Failed to update room status:', insertError)
      return json(response, 400, { error: insertError.message })
    }
  }

  try {
    await writeAuditLog({
      orgId: organization.id,
      actorId: userId,
      action: 'update_room_status',
      targetId: roomId,
      metadata: { status, statusTime: timestamp },
    })
  } catch {
    /* ignore audit failures */
  }

  return json(response, 200, {
    success: true,
    roomId,
    status,
    statusTime: timestamp,
  })
}
