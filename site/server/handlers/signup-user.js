// Legacy endpoint. Account creation now runs through /api/start-signup with a
// one-time invite code, a random temporary password, and email verification.
function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  return json(response, 410, { error: 'Gone' })
}
