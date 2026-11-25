// Legacy endpoint. Verification is handled by /api/send-code and
// /api/verify-code; no personal data is emailed or stored in auth metadata.
function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  return json(response, 410, { error: 'Gone' })
}
