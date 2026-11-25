import {
  verifyTenantCaller,
  poolForDb,
  pgIdent,
} from './_tenant.js'

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    response.status(405).send('Method not allowed')
    return
  }
  let caller
  try {
    caller = await verifyTenantCaller(request)
  } catch (error) {
    console.error('media auth failed', error)
    response.status(error.status || 500).json({ error: 'Authentication failed' })
    return
  }

  const mediaId = request.query.id
  if (!mediaId) {
    response.status(400).json({ error: 'Media ID is required' })
    return
  }
  const schema = pgIdent(caller.organization.schema_name)
  const pool = poolForDb()
  const client = await pool.connect()
  try {
    const mediaResult = await client.query(
      `select id, kind, mime_type, size_bytes, chunk_count, complete, created_by
         from ${schema}.media
        where id = $1`,
      [mediaId],
    )
    if (mediaResult.rowCount !== 1) {
      response.status(404).json({ error: 'Media not found' })
      return
    }
    const media = mediaResult.rows[0]
    const staff = ['org_admin', 'admin'].includes(caller.profile.role)
    if (!staff && media.created_by !== caller.userId) {
      response.status(403).json({ error: 'Media access denied' })
      return
    }
    if (!media.complete) {
      response.status(409).json({ error: 'Media upload is incomplete' })
      return
    }

    const chunkResult = await client.query(
      `select chunk_index, data
         from ${schema}.media_chunks
        where media_id = $1
        order by chunk_index`,
      [mediaId],
    )
    if (chunkResult.rowCount !== media.chunk_count) {
      response.status(409).json({ error: 'Media chunks are incomplete' })
      return
    }
    const body = Buffer.concat(chunkResult.rows.map((row) => row.data))
    response.setHeader('Content-Type', media.mime_type)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Content-Disposition', 'inline')

    const range = request.headers.range
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) {
        response.setHeader('Content-Range', `bytes */${body.length}`)
        response.status(416).send('Range Not Satisfiable')
        return
      }
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Number(match[2]) : body.length - 1
      if (start > end || start >= body.length) {
        response.setHeader('Content-Range', `bytes */${body.length}`)
        response.status(416).send('Range Not Satisfiable')
        return
      }
      const safeEnd = Math.min(end, body.length - 1)
      const part = body.subarray(start, safeEnd + 1)
      response.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${body.length}`)
      response.setHeader('Content-Length', String(part.length))
      response.status(206)
      if (request.method === 'HEAD') response.end()
      else response.end(part)
      return
    }

    response.setHeader('Content-Length', String(body.length))
    response.status(200)
    if (request.method === 'HEAD') response.end()
    else response.end(body)
  } catch (error) {
    console.error('media read failed', error)
    response.status(400).json({ error: 'Media could not be loaded' })
  } finally {
    client.release()
    await pool.end()
  }
}
