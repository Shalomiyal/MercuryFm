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

function headerMatches(mimeType, buffer) {
  const starts = (bytes) => bytes.every((byte, index) => buffer[index] === byte)
  switch (mimeType) {
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff])
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) &&
        String(buffer.subarray(8, 12)) === 'WEBP'
    case 'image/gif':
      return starts([0x47, 0x49, 0x46, 0x38])
    case 'video/mp4':
    case 'video/quicktime':
    case 'video/x-m4v':
    case 'video/3gpp':
      return String(buffer.subarray(4, 8)) === 'ftyp'
    case 'video/webm':
      return starts([0x1a, 0x45, 0xdf, 0xa3])
    default:
      return false
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' })
  let caller
  try {
    caller = await verifyTenantCaller(request)
  } catch (error) {
    console.error('media complete auth failed', error)
    return json(response, error.status || 500, { error: 'Authentication failed' })
  }
  if (caller.profile.role !== 'cleaner') {
    return json(response, 403, { error: 'Cleaner access required' })
  }
  const { mediaId } = request.body || {}
  if (!mediaId) return json(response, 400, { error: 'Media ID is required' })

  const schema = pgIdent(caller.organization.schema_name)
  const pool = poolForDb()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const media = await client.query(
      `select id, chunk_count, size_bytes, mime_type
         from ${schema}.media
        where id = $1 and created_by = $2
        for update`,
      [mediaId, caller.userId],
    )
    if (media.rowCount !== 1) {
      await client.query('rollback')
      return json(response, 403, { error: 'Media is not owned by this user' })
    }
    const countResult = await client.query(
      `select count(*)::int as uploaded_count,
              coalesce(sum(octet_length(data)), 0)::bigint as uploaded_bytes,
              count(*) filter (where chunk_index < 0
                or chunk_index >= $2)::int as invalid_indexes
         from ${schema}.media_chunks
        where media_id = $1`,
      [mediaId, media.rows[0].chunk_count],
    )
    const uploadedCount = countResult.rows[0].uploaded_count
    const uploadedBytes = Number(countResult.rows[0].uploaded_bytes)
    const invalidIndexes = countResult.rows[0].invalid_indexes
    if (uploadedCount !== media.rows[0].chunk_count) {
      await client.query('rollback')
      return json(response, 409, {
        error: `Incomplete upload: ${uploadedCount}/${media.rows[0].chunk_count} chunks`,
      })
    }
    if (invalidIndexes > 0 || uploadedBytes !== media.rows[0].size_bytes) {
      await client.query('rollback')
      return json(response, 409, {
        error: 'Upload chunk data does not match the declared file size',
      })
    }
    const chunkRows = await client.query(
      `select data
         from ${schema}.media_chunks
        where media_id = $1
        order by chunk_index`,
      [mediaId],
    )
    const assembled = Buffer.concat(chunkRows.rows.map((row) => row.data))
    if (!headerMatches(media.rows[0].mime_type, assembled)) {
      await client.query('rollback')
      return json(response, 400, { error: 'File content does not match its declared type' })
    }
    await client.query(
      `update ${schema}.media set complete = true where id = $1`,
      [mediaId],
    )
    await client.query('commit')
    return json(response, 200, { mediaId, complete: true })
  } catch (error) {
    await client.query('rollback').catch(() => {})
    console.error('media complete failed', error)
    return json(response, 400, { error: 'Upload could not be completed' })
  } finally {
    client.release()
    await pool.end()
  }
}
