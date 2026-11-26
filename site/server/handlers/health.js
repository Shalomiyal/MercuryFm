export default function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    return response.status(405).send({ error: 'Method not allowed' })
  }
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
  return response.status(200).send({
    status: 'ok',
    service: 'mercury-fm',
    timestamp: new Date().toISOString(),
  })
}
