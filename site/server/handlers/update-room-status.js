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
  const { roomId, status, statusTime, mediaId } = request.body || {}

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

  // Try service-role Supabase client (needs grant-service-role-tenant.sql to be run once)
  let updated = false
  const { client: serverClient, error: clientError } = getAdminClient()

  if (!clientError && serverClient) {
    const tryRow = async (row) => {
      const { error } = await serverClient
        .schema(rawSchema)
        .from('room_status_history')
        .upsert(row, { ignoreDuplicates: true })
      return error
    }

    let insertError = await tryRow({
      room_id: roomId, status, status_time: timestamp, created_by: userId,
      ...(mediaId ? { media_id: mediaId } : {}),
    })

    // media_id column missing — retry without it
    if (insertError && /media_id/i.test(insertError.message)) {
      insertError = await tryRow({ room_id: roomId, status, status_time: timestamp, created_by: userId })
    }

    // created_by FK failed — retry with null
    if (insertError && /foreign key|created_by/i.test(insertError.message)) {
      insertError = await tryRow({ room_id: roomId, status, status_time: timestamp, created_by: null })
    }

    // Already exists — treat as success
    if (insertError && (insertError.code === '23505' || /conflict|duplicate/i.test(insertError.message))) {
      insertError = null
    }

    if (!insertError) {
      updated = true
    } else {
      console.warn('Service-role insert failed:', insertError.message)
    }
  }

  // Fallback: direct Postgres pool
  if (!updated && process.env.SUPABASE_DB_URL) {
    let pool
    try { pool = poolForDb() } catch { /* missing URL */ }
    if (pool) {
      let pgClient
      try { pgClient = await pool.connect() } catch (e) {
        console.warn('PG pool connect failed:', e.message)
      }
      if (pgClient) {
        const schema = pgIdent(rawSchema)
        try {
          await pgClient.query(
            `insert into ${schema}.room_status_history (room_id, status, status_time, created_by)
             values ($1, $2::public.room_status, $3::timestamptz, $4)
             on conflict do nothing`,
            [roomId, status, timestamp, userId],
          )
          updated = true
        } catch (pgErr) {
          if (/foreign key|created_by/i.test(pgErr.message)) {
            try {
              await pgClient.query(
                `insert into ${schema}.room_status_history (room_id, status, status_time, created_by)
                 values ($1, $2::public.room_status, $3::timestamptz, null)
                 on conflict do nothing`,
                [roomId, status, timestamp],
              )
              updated = true
            } catch { /* ignore */ }
          }
        } finally {
          pgClient.release()
        }
      }
    }
  }

  if (!updated) {
    return json(response, 500, {
      error: 'Could not save room status. Run site/supabase/grant-service-role-tenant.sql in Supabase SQL Editor.',
    })
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
