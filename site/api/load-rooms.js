import { getAdminClient, verifyUser } from './lib/serverSupabase.js'
import { writeAuditLog } from './lib/audit.js'

function json(response, status, body) {
  response.setHeader('Content-Type', 'application/json')
  response.status(status).send(body)
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  const rows = []
  function parseLine(line) {
    const values = []
    let value = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]
      if (character === '"' && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = !quoted
      } else if (character === ',' && !quoted) {
        values.push(value.trim())
        value = ''
      } else {
        value += character
      }
    }
    values.push(value.trim())
    return values
  }

  let headerFound = false
  let headerIndex = { branch_id: 0, room_id: 1 }
  for (const line of lines) {
    if (!line.trim()) continue
    const values = parseLine(line)
    if (!headerFound) {
      const branchIndex = values.findIndex((value) => value.toLowerCase() === 'branch_id')
      const roomIndex = values.findIndex((value) => value.toLowerCase() === 'room_id')
      if (branchIndex >= 0 && roomIndex >= 0) {
        headerIndex = { branch_id: branchIndex, room_id: roomIndex }
        headerFound = true
      } else if (values.length >= 2) {
        rows.push({ branch_id: values[0], room_id: values[1] })
      }
      continue
    }
    rows.push({
      branch_id: values[headerIndex.branch_id],
      room_id: values[headerIndex.room_id],
    })
  }
  return rows.filter((row) => row.branch_id && row.room_id)
}

// Room import uses a public security-definer RPC over REST. service_role does
// not need any privileges inside tenant schemas.
function friendlyDbError(error) {
  const message = error?.message || 'Database update failed'
  if (/foreign key|constraint|referenced/i.test(message)) {
    return 'That room has status history or is still referenced. Keep the same room ID, or clear its history first.'
  }
  return 'Rooms could not be saved. Check the IDs and try again.'
}

async function importViaRest(client, organization, rows) {
  const rooms = rows.map((row) => ({ room_id: row.room_id, branch_id: row.branch_id }))
  const { error } = await client.rpc('save_organization_rooms', {
    p_org_id: organization.id,
    p_rooms: rooms,
  })
  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, 405, { error: 'Method not allowed' })
  }
  const { client: serverClient, error: configError } = getAdminClient()
  if (configError) {
    return json(response, 500, { error: 'Server database configuration is missing' })
  }
  const { userId, error: authError } = await verifyUser(request)
  if (authError) return json(response, authError.status, { error: authError.message })
  const { data: callerProfile, error: profileError } = await serverClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileError || !callerProfile) {
    return json(response, 403, { error: 'Could not verify your profile' })
  }
  if (!['platform_admin', 'org_admin'].includes(callerProfile.role)) {
    return json(response, 403, { error: 'Platform admin or organization admin access required' })
  }

  const { csv, organizationId } = request.body || {}
  if (typeof csv !== 'string') {
    return json(response, 400, { error: 'CSV content is required' })
  }

  // Org admins can only save rooms for their own organization. A platform
  // admin must choose the target organization explicitly.
  let targetOrgId = callerProfile.org_id
  if (callerProfile.role === 'platform_admin') {
    targetOrgId = organizationId
    if (!targetOrgId) {
      return json(response, 400, { error: 'Choose an organization before saving rooms' })
    }
  } else if (organizationId && organizationId !== callerProfile.org_id) {
    return json(response, 403, { error: 'You can only save rooms for your own organization' })
  }

  if (csv.length > 5 * 1024 * 1024) {
    return json(response, 413, { error: 'CSV must be 5 MB or smaller' })
  }
  const { data: organization, error: orgError } = await serverClient
    .from('organizations')
    .select('id, schema_name, rooms_locked')
    .eq('id', targetOrgId)
    .maybeSingle()
  if (orgError) {
    console.error('load-rooms organization lookup failed', orgError)
    return json(response, 400, { error: 'Could not check the organization' })
  }
  if (!organization) return json(response, 404, { error: 'Organization not found' })
  // rooms_locked is informational: it records that rooms were imported at least
  // once. It does not prevent later edits by an organization admin.

  const rows = parseCsv(csv)
  if (rows.length === 0) {
    return json(response, 400, { error: 'CSV must contain branch_id and room_id columns' })
  }
  const invalid = rows.find((row) =>
    !/^[A-Za-z0-9_-]{1,100}$/.test(row.branch_id) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(row.room_id))
  if (invalid) {
    return json(response, 400, { error: 'Branch and room IDs may contain 1-100 letters, numbers, hyphens, or underscores' })
  }
  const roomIds = rows.map((row) => row.room_id.toLowerCase())
  if (new Set(roomIds).size !== roomIds.length) {
    return json(response, 400, { error: 'Room IDs must be unique' })
  }

  const result = await importViaRest(serverClient, organization, rows)
  if (!result.ok) {
    return json(response, 400, { error: result.error })
  }

  await writeAuditLog({
    actorId: userId,
    action: 'rooms_imported',
    orgId: organization.id,
    metadata: { imported: rows.length },
  })

  return json(response, 200, {
    imported: rows.length,
    roomsLocked: Boolean(organization.rooms_locked),
  })
}
