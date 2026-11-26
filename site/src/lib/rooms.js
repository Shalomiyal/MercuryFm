import { db } from './db'
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

  // 1. Try direct DB insert
  try {
    const orgDb = await db()
    const row = {
      room_id: roomId,
      status,
      status_time: isoTime,
      created_by: profileId || null,
      ...(mediaId ? { media_id: mediaId } : {}),
    }
    const { error: insertError } = await orgDb.from('room_status_history').insert(row)

    if (!insertError) {
      return { success: true, roomId, status, statusTime: isoTime }
    }

    // If media_id column doesn't exist yet, retry without it
    if (/media_id/i.test(insertError.message)) {
      const { error: noMediaError } = await orgDb.from('room_status_history').insert({
        room_id: roomId, status, status_time: isoTime, created_by: profileId || null,
      })
      if (!noMediaError) return { success: true, roomId, status, statusTime: isoTime }
    }

    // If FK constraint on created_by failed, retry with created_by: null
    if (/foreign key|created_by/i.test(insertError.message)) {
      const { error: retryError } = await orgDb.from('room_status_history').insert({
        room_id: roomId, status, status_time: isoTime, created_by: null,
        ...(mediaId ? { media_id: mediaId } : {}),
      })
      if (!retryError) return { success: true, roomId, status, statusTime: isoTime }
    }

    // If RLS blocked, fall through to API
    console.warn('Direct DB insert failed, falling back to API:', insertError.message)
  } catch (dbError) {
    console.warn('DB client error, falling back to API:', dbError)
  }

  // 2. Fall back to /api/update-room-status
  const res = await apiPostAuthed('/update-room-status', { roomId, status, statusTime: isoTime })
  return res
}
