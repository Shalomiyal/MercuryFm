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
    console.error('media chunk auth failed', error)
    return json(response, error.status || 500, { error: 'Authentication failed' })
  }
  if (caller.profile.role !== 'cleaner') {
    return json(response, 403, { error: 'Cleaner access required' })
  }
  const { mediaId, chunkIndex, dataBase64 } = request.body || {}
  if (!mediaId ||
      !Number.isInteger(Number(chunkIndex)) ||
      typeof dataBase64 !== 'string') {
    return json(response, 400, { error: 'Media ID, chunk index, and data are required' })
  }
  let data
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
      return json(response, 400, { error: 'Invalid base64 chunk' })
    }
    data = Buffer.from(dataBase64, 'base64')
  } catch {
    return json(response, 400, { error: 'Invalid base64 chunk' })
  }
  if (data.length < 1 || data.length > 3 * 1024 * 1024) {
    return json(response, 400, { error: 'Chunk must be 1 byte to 3 MB' })
  }

  const schema = pgIdent(caller.organization.schema_name)
  const pool = poolForDb()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const media = await client.query(
      `select id, chunk_count, complete
         from ${schema}.media
        where id = $1 and created_by = $2
        for update`,
      [mediaId, caller.userId],
    )
    if (media.rowCount !== 1) {
      await client.query('rollback')
      return json(response, 403, { error: 'Media is not owned by this user' })
    }
    if (media.rows[0].complete) {
      await client.query('rollback')
      return json(response, 409, { error: 'Media is already complete' })
    }
    const index = Number(chunkIndex)
    if (index < 0 || index >= media.rows[0].chunk_count) {
      await client.query('rollback')
      return json(response, 400, { error: 'Invalid chunk index' })
    }
    await client.query(
      `insert into ${schema}.media_chunks(media_id, chunk_index, data)
       values ($1, $2, $3)
       on conflict (media_id, chunk_index) do update set data = excluded.data`,
      [mediaId, index, data],
    )
    await client.query('commit')
    return json(response, 200, { mediaId, chunkIndex: index })
  } catch (error) {
    await client.query('rollback').catch(() => {})
    console.error('media chunk upload failed', error)
    return json(response, 400, { error: 'Chunk could not be saved' })
  } finally {
    client.release()
    await pool.end()
  }
}
