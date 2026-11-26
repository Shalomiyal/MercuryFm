import { db } from './db'
import { supabase } from './supabase'
import { apiPostAuthed } from './api'

export const ROOM_STATUSES = [
  ['ready', 'Ready'],
  ['check_in', 'Check in'],
  ['check_out', 'Check out'],
  ['clean_start', 'Clean start'],
  ['clean_finished', 'Clean finished'],
]

export function statusLabel(status) {
  return ROOM_STATUSES.find(([val]) => val === status)?.[1] || status || 'No status'
}

/**
 * Updates room status by inserting into room_status_history.
 * Tries direct tenant DB insert first; if blocked by RLS (e.g. cleaner role),
 * falls back to authed API endpoint /api/update-room-status.
 */
export async function setRoomStatus({ roomId, status, statusTime, profileId, mediaId = null }) {
  if (!roomId || !status) {
    throw new Error('Room ID and status are required.')
  }
  const isoTime = statusTime ? new Date(statusTime).toISOString() : new Date().toISOString()

  const buildRow = (withCreatedBy, withMedia) => ({
    room_id: roomId,
    status,
    status_time: isoTime,
    created_by: withCreatedBy ? (profileId || null) : null,
    ...(withMedia && mediaId ? { media_id: mediaId } : {}),
  })

  // Helper: attempt one insert, return true on success or if row already exists
  async function tryInsert(client, row) {
    // upsert with ignoreDuplicates silently skips conflicts
    const { error } = await client
      .from('room_status_history')
      .upsert(row, { ignoreDuplicates: true })
    if (!error) return true
    // media_id column missing — retry without it
    if (/media_id/i.test(error.message)) {
      const { media_id: _dropped, ...rowWithoutMedia } = row
      const { error: e2 } = await client
        .from('room_status_history')
        .upsert(rowWithoutMedia, { ignoreDuplicates: true })
      if (!e2) return true
    }
    // Any remaining conflict = already saved
    if (error.code === '23505' || /conflict|duplicate|unique/i.test(error.message)) return true
    return false
  }

  // 1. Try with orgDb (tenant schema client, user JWT)
  try {
    const orgDb = await db()
    if (await tryInsert(orgDb, buildRow(true, true))) {
      return { success: true, roomId, status, statusTime: isoTime }
    }
  } catch { /* fall through */ }

  // 2. Try with raw supabase.schema() — sometimes resolves RLS differently
  try {
    const { data: schemaData } = await supabase.rpc('my_schema')
    if (schemaData) {
      const schemaClient = supabase.schema(schemaData)
      if (await tryInsert(schemaClient, buildRow(true, true))) {
        return { success: true, roomId, status, statusTime: isoTime }
      }
      // Retry without created_by if FK error
      if (await tryInsert(schemaClient, buildRow(false, true))) {
        return { success: true, roomId, status, statusTime: isoTime }
      }
    }
  } catch { /* fall through */ }

  // 3. Fall back to /api/update-room-status (server uses service role key)
  const res = await apiPostAuthed('/update-room-status', { roomId, status, statusTime: isoTime, mediaId })
  return res
}
