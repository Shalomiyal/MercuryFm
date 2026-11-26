/**
 * Optional one-time migration script: copies legacy bytea media from
 * <schema>.media + <schema>.media_chunks into Supabase Storage ("work-media")
 * and fills storage_path.
 *
 * DRY-RUN BY DEFAULT. Pass --execute to perform writes.
 * Requires environment variables: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL.
 */
import 'dotenv/config'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const execute = process.argv.includes('--execute')
const supabaseUrl = process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const dbUrl = process.env.SUPABASE_DB_URL

if (!supabaseUrl || !secretKey || !dbUrl) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, secretKey)
const pool = new pg.Pool({ connectionString: dbUrl })

const EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function safeIdent(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid schema name: ${name}`)
  return `"${name}"`
}

async function run() {
  const client = await pool.connect()
  try {
    const { rows: orgs } = await client.query(
      'select schema_name from public.organizations order by schema_name',
    )

    console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`)
    for (const org of orgs) {
      const schema = safeIdent(org.schema_name)
      const { rows: legacyMedia } = await client.query(`
        select m.id, m.kind, m.mime_type, m.created_by, m.created_at,
               tr.daily_task_id, tr.run_date,
               case when tr.start_photo_id = m.id then 'start' else 'finish' end as stage
          from ${schema}.media m
          left join ${schema}.task_runs tr
            on tr.start_photo_id = m.id or tr.finish_video_id = m.id
         where m.storage_path is null
           and m.complete = true
      `)

      console.log(`[${org.schema_name}] Found ${legacyMedia.length} legacy media row(s)`)
      for (const row of legacyMedia) {
        const ext = EXT_MAP[row.mime_type] || (row.kind === 'video' ? 'mp4' : 'jpg')
        const cleaner = row.created_by || 'unknown'
        const workDate = (row.run_date ? new Date(row.run_date) : new Date(row.created_at))
          .toISOString()
          .slice(0, 10)
        const taskId = row.daily_task_id || row.id
        const ts = new Date(row.created_at).getTime()
        const storagePath = `${org.schema_name}/${cleaner}/${workDate}/${taskId}_${row.stage}_${ts}.${ext}`

        if (!execute) {
          console.log(`  [dry-run] would migrate ${row.id} -> ${storagePath}`)
          continue
        }

        const { rows: chunks } = await client.query(
          `select data from ${schema}.media_chunks where media_id = $1 order by chunk_index`,
          [row.id],
        )
        const buffer = Buffer.concat(chunks.map((c) => c.data))
        const { error: uploadError } = await supabase.storage
          .from('work-media')
          .upload(storagePath, buffer, { contentType: row.mime_type, upsert: false })
        if (uploadError) {
          console.error(`  [error] ${row.id}: ${uploadError.message}`)
          continue
        }

        await client.query(
          `update ${schema}.media set bucket = 'work-media', storage_path = $1 where id = $2`,
          [storagePath, row.id],
        )
        console.log(`  [migrated] ${row.id} -> ${storagePath}`)
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
