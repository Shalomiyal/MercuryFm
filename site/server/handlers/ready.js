import { getAdminClient } from '../lib/serverSupabase.js'
import { logger } from '../lib/logger.js'

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    return response.status(405).send({ error: 'Method not allowed' })
  }

  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')

  const { client, error: configError } = getAdminClient()
  if (configError) {
    logger.error('readiness_config_missing', { message: configError.message })
    return response.status(503).send({ status: 'not_ready', reason: 'config_missing' })
  }

  try {
    const { error } = await client.from('organizations').select('id').limit(1)
    if (error) {
      logger.error('readiness_db_error', { code: error.code, message: error.message })
      return response.status(503).send({ status: 'not_ready', reason: 'database_unavailable' })
    }
    return response.status(200).send({
      status: 'ready',
      checks: { database: 'ok' },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('readiness_exception', { message: error?.message })
    return response.status(503).send({ status: 'not_ready', reason: 'database_unavailable' })
  }
}
