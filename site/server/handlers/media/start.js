/**
 * @deprecated Legacy chunked DB upload endpoint. New uploads go directly to
 * Supabase Storage ("work-media" bucket) from src/lib/media.js.
 */
import {
  json,
  verifyTenantCaller,
  poolForDb,
  pgIdent,
} from './_tenant.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' })
  let caller
  try {
    caller = await verifyTenantCaller(request)
  } catch (error) {
    console.error('media start auth failed', error)
    return json(response, error.status || 500, { error: 'Authentication failed' })
  }
  if (caller.profile.role !== 'cleaner') {
    return json(response, 403, { error: 'Cleaner access required' })
  }

  const { kind, taskId, mimeType, sizeBytes } = request.body || {}
  if (!['photo', 'video'].includes(kind) ||
      !Number.isInteger(Number(taskId)) ||
      typeof mimeType !== 'string') {
    return json(response, 400, { error: 'Valid media kind, task ID, and MIME type are required' })
  }
  const numericSize = Number(sizeBytes)
  if (!Number.isInteger(numericSize) || numericSize < 1) {
    return json(response, 400, { error: 'Valid file size is required' })
  }

  // Only allow formats that browsers render as passive media. image/svg+xml
  // and other script-capable types must never be served from the app origin.
  const normalizedMimeType = mimeType.split(';')[0].trim().toLowerCase()
  const photoTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/3gpp']
  if (kind === 'photo' &&
      (!photoTypes.includes(normalizedMimeType) || numericSize > 400 * 1024)) {
    return json(response, 400, { error: 'Photo must be a JPEG, PNG, WebP, or GIF no larger than 400 KB' })
  }
  if (kind === 'video' &&
      (!videoTypes.includes(normalizedMimeType) || numericSize > 15 * 1024 * 1024)) {
    return json(response, 400, { error: 'Video must be MP4, WebM, MOV, M4V, or 3GP no larger than 15 MB' })
  }

  const schema = pgIdent(caller.organization.schema_name)
  const pool = poolForDb()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const today = new Date().toISOString().slice(0, 10)
    const taskResult = await client.query(
      `select dt.id
         from ${schema}.daily_tasks dt
         join ${schema}.daily_assignments da on da.id = dt.assignment_id
        where dt.id = $1 and da.cleaner_id = $2 and da.work_date = $3
        for update`,
      [Number(taskId), caller.userId, today],
    )
    if (taskResult.rowCount !== 1) {
      await client.query('rollback')
      return json(response, 403, { error: 'Task is not assigned to this cleaner for today' })
    }

    const runResult = await client.query(
      `select id, state, start_photo_id, finish_video_id
         from ${schema}.task_runs
        where daily_task_id = $1`,
      [Number(taskId)],
    )
    if (kind === 'photo' && runResult.rowCount > 0) {
      await client.query('rollback')
      return json(response, 409, { error: 'Task has already been started' })
    }
    if (kind === 'video') {
      if (runResult.rowCount !== 1 ||
          runResult.rows[0].state !== 'in_progress' ||
          !runResult.rows[0].start_photo_id) {
        await client.query('rollback')
        return json(response, 409, { error: 'Start photo is required before finishing' })
      }
    }

    const chunkCount = Math.ceil(numericSize / (3 * 1024 * 1024))
    const mediaResult = await client.query(
      `insert into ${schema}.media
       (kind, mime_type, size_bytes, chunk_count, complete, created_by)
       values ($1, $2, $3, $4, false, $5)
       returning id`,
      [kind, normalizedMimeType, numericSize, chunkCount, caller.userId],
    )
    await client.query('commit')
    return json(response, 201, {
      mediaId: mediaResult.rows[0].id,
      chunkCount,
      chunkSize: 3 * 1024 * 1024,
    })
  } catch (error) {
    await client.query('rollback').catch(() => {})
    console.error('media start failed', error)
    return json(response, 400, { error: 'Upload could not be started' })
  } finally {
    client.release()
    await pool.end()
  }
}
