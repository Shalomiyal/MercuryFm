import pg from 'pg'
import { SUPABASE_CA } from './supabaseCa.js'

const { Pool } = pg

// pg-connection-string applies SSL options from the connection string after the
// explicitly supplied config, so strip them all. TLS is configured here only.
function verifiedConnectionString(dbUrl) {
  const url = new URL(dbUrl)
  for (const param of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    url.searchParams.delete(param)
  }
  return url.toString()
}

// Supabase signs its Postgres endpoints with its own CA. Trust that CA instead
// of disabling verification: the connection stays encrypted and authenticated.
export function createDbPool(dbUrl) {
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is missing')
  }
  return new Pool({
    connectionString: verifiedConnectionString(dbUrl),
    ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
  })
}
