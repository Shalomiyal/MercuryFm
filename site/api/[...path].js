import changePassword from '../server/handlers/change-password.js'
import createInvite from '../server/handlers/create-invite.js'
import createOrganization from '../server/handlers/create-organization.js'
import createUser from '../server/handlers/create-user.js'
import health from '../server/handlers/health.js'
import listRooms from '../server/handlers/list-rooms.js'
import loadRooms from '../server/handlers/load-rooms.js'
import loginOptions from '../server/handlers/login-options.js'
import manageUser from '../server/handlers/manage-user.js'
import organizationDetails from '../server/handlers/organization-details.js'
import platformUsers from '../server/handlers/platform-users.js'
import ready from '../server/handlers/ready.js'
import sendCode from '../server/handlers/send-code.js'
import sendSignupLink from '../server/handlers/send-signup-link.js'
import setOrganizationActive from '../server/handlers/set-organization-active.js'
import signupUser from '../server/handlers/signup-user.js'
import startSignup from '../server/handlers/start-signup.js'
import verifyCode from '../server/handlers/verify-code.js'
import mediaStart from '../server/handlers/media/start.js'
import mediaChunk from '../server/handlers/media/chunk.js'
import mediaComplete from '../server/handlers/media/complete.js'
import mediaById from '../server/handlers/media/[id].js'

const ROUTES = {
  'change-password': changePassword,
  'create-invite': createInvite,
  'create-organization': createOrganization,
  'create-user': createUser,
  health,
  'list-rooms': listRooms,
  'load-rooms': loadRooms,
  'login-options': loginOptions,
  'manage-user': manageUser,
  'organization-details': organizationDetails,
  'platform-users': platformUsers,
  ready,
  'send-code': sendCode,
  'send-signup-link': sendSignupLink,
  'set-organization-active': setOrganizationActive,
  'signup-user': signupUser,
  'start-signup': startSignup,
  'verify-code': verifyCode,
  'media/start': mediaStart,
  'media/chunk': mediaChunk,
  'media/complete': mediaComplete,
}

function extractSegments(request) {
  const fromQuery = request.query?.path
  if (Array.isArray(fromQuery) && fromQuery.length) {
    return fromQuery.filter(Boolean)
  }
  if (typeof fromQuery === 'string' && fromQuery) {
    return fromQuery.split('/').filter(Boolean)
  }
  const pathname = String(request.url || '').split('?')[0]
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
}

export default async function handler(request, response) {
  const segments = extractSegments(request)
  const key = segments.join('/')

  if (ROUTES[key]) {
    return ROUTES[key](request, response)
  }

  if (segments.length === 2 && segments[0] === 'media' && segments[1]) {
    request.query = { ...(request.query || {}), id: segments[1] }
    return mediaById(request, response)
  }

  response.setHeader('Content-Type', 'application/json')
  return response.status(404).send({ error: 'API route not found' })
}
