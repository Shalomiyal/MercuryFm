import {
  adminClient,
  contextClient,
  verifyUser,
} from './lib/serverSupabase.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }
  const { newPassword } = request.body || {}
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return json(response, 400, { error: 'Password must be at least 8 characters' })
  }

  // This is the only server flow allowed while must_change_password is true.
  const { auth, userId, error: authError } = await verifyUser(request, {
    allowPasswordChange: true,
  })
  if (authError) return json(response, authError.status, { error: authError.message })

  const { error: updateError } = await adminClient().auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (updateError) {
    console.error('change-password update failed', updateError)
    return json(response, 400, { error: 'Password could not be changed. Try a different password.' })
  }

  const { error: stateError } = await contextClient(auth).rpc('mark_password_changed')
  if (stateError) {
    console.error('change-password state update failed', stateError)
    return json(response, 400, { error: 'Password was changed but the account state could not be refreshed' })
  }

  return json(response, 200, { ok: true })
}
