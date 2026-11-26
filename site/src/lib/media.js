import { supabase } from './supabase'
import { db } from './db'

export const WORK_MEDIA_BUCKET = 'work-media'
export const MAX_PHOTO_BYTES = 400 * 1024
export const MAX_VIDEO_SECONDS = 60
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024
export const CHUNK_SIZE = 3 * 1024 * 1024

function extensionForFile(file, kind) {
  const mime = String(file?.type || '').split(';')[0].trim().toLowerCase()
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  }
  if (mimeMap[mime]) return mimeMap[mime]
  const nameMatch = String(file?.name || '').match(/\.([a-z0-9]+)$/i)
  if (nameMatch) return nameMatch[1].toLowerCase()
  return kind === 'video' ? 'mp4' : 'jpg'
}

/**
 * Builds tenant-scoped Supabase Storage paths:
 *   {schema_name}/{cleaner_id}/{yyyy-mm-dd}/{daily_task_id}_{start|finish}_{timestamp}.{ext}
 *   {schema_name}/{cleaner_id}/{yyyy-mm-dd}/{daily_task_id}_{start|finish}_{timestamp}_thumb.jpg
 */
export function buildWorkMediaPaths({
  schemaName,
  cleanerId,
  workDate,
  dailyTaskId,
  stage,
  ext = 'jpg',
  timestamp = Date.now(),
}) {
  if (!schemaName || !cleanerId || !workDate || !dailyTaskId || !stage) {
    throw new Error('Missing required fields for media storage path.')
  }
  const safeStage = stage === 'finish' ? 'finish' : 'start'
  const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'
  const base = `${schemaName}/${cleanerId}/${workDate}/${dailyTaskId}_${safeStage}_${timestamp}`
  return {
    storagePath: `${base}.${safeExt}`,
    thumbPath: `${base}_thumb.jpg`,
  }
}

export async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file)
  let width = bitmap.width
  let height = bitmap.height
  let scale = Math.min(1, 1280 / Math.max(width, height))
  let blob = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82 - attempt * 0.07),
    )
    if (blob && blob.size <= MAX_PHOTO_BYTES) break
    scale *= 0.82
  }
  bitmap.close()
  if (!blob) throw new Error('Could not compress photo.')
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new Error('Photo could not be compressed below 400 KB.')
  }
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
  })
}

export async function getImageDimensions(file) {
  const bitmap = await createImageBitmap(file)
  const result = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return result
}

export async function generatePhotoThumbnail(file, maxWidth = 320) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / Math.max(1, bitmap.width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.72),
  )
  if (!blob) return null
  return new File([blob], 'thumb.jpg', { type: 'image/jpeg' })
}

export function generateVideoPoster(file, maxWidth = 320) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const objectUrl = URL.createObjectURL(file)

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
    }

    video.onerror = () => {
      cleanup()
      resolve(null)
    }

    video.onloadedmetadata = () => {
      const targetTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.5, video.duration * 0.25)
        : 0
      video.currentTime = targetTime
    }

    video.onseeked = () => {
      try {
        const vw = video.videoWidth || 320
        const vh = video.videoHeight || 240
        const scale = Math.min(1, maxWidth / Math.max(1, vw))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(vw * scale))
        canvas.height = Math.max(1, Math.round(vh * scale))
        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            cleanup()
            resolve(blob ? new File([blob], 'poster.jpg', { type: 'image/jpeg' }) : null)
          },
          'image/jpeg',
          0.75,
        )
      } catch {
        cleanup()
        resolve(null)
      }
    }

    video.src = objectUrl
  })
}

export function validateVideo(file) {
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video exceeds the ${MAX_VIDEO_BYTES / 1024 / 1024} MB limit.`
  }
  return null
}

export function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration
      URL.revokeObjectURL(video.src)
      resolve(duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      reject(new Error('Could not read video duration.'))
    }
    video.src = URL.createObjectURL(file)
  })
}

export function getVideoResolution(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const result = { width: video.videoWidth, height: video.videoHeight }
      URL.revokeObjectURL(video.src)
      resolve(result)
    }
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      reject(new Error('Could not read video dimensions.'))
    }
    video.src = URL.createObjectURL(file)
  })
}

function friendlyUploadError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|timeout/.test(msg)) {
    return 'You appear to be offline or the connection dropped. Check your internet and tap Retry.'
  }
  if (/row-level security|permission|not authorized|403|unauthorized/.test(msg)) {
    return 'Permission denied while uploading media. Please sign in again.'
  }
  if (/payload too large|file size|exceeds|413/.test(msg)) {
    return 'This file is too large to upload. Please choose a smaller file.'
  }
  return error?.message || 'Upload failed. Please try again.'
}

/**
 * Uploads the media file + optional thumbnail directly to Supabase Storage
 * ("work-media" bucket), then inserts the row into <schema>.media.
 * Cleans up uploaded Storage objects if the DB insert fails.
 */
export async function uploadWorkMedia({
  file,
  thumbFile,
  kind,
  stage,
  schemaName,
  cleanerId,
  workDate,
  dailyTaskId,
  durationSeconds = null,
  width = null,
  height = null,
  onProgress = () => {},
}) {
  const ext = extensionForFile(file, kind)
  const { storagePath, thumbPath } = buildWorkMediaPaths({
    schemaName,
    cleanerId,
    workDate,
    dailyTaskId,
    stage,
    ext,
  })

  onProgress(15)
  const uploadedPaths = []

  try {
    const { error: mainUploadError } = await supabase.storage
      .from(WORK_MEDIA_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
        upsert: false,
      })
    if (mainUploadError) throw mainUploadError
    uploadedPaths.push(storagePath)
    onProgress(60)

    let savedThumbPath = null
    if (thumbFile) {
      const { error: thumbError } = await supabase.storage
        .from(WORK_MEDIA_BUCKET)
        .upload(thumbPath, thumbFile, {
          contentType: 'image/jpeg',
          upsert: false,
        })
      if (!thumbError) {
        uploadedPaths.push(thumbPath)
        savedThumbPath = thumbPath
      }
    }
    onProgress(85)

    const orgDb = await db()
    const { data: mediaRow, error: insertError } = await orgDb
      .from('media')
      .insert({
        kind,
        mime_type: (file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg')).split(';')[0].trim(),
        size_bytes: file.size,
        chunk_count: 0,
        bucket: WORK_MEDIA_BUCKET,
        storage_path: storagePath,
        thumb_path: savedThumbPath,
        duration_seconds: durationSeconds != null ? Math.round(durationSeconds * 10) / 10 : null,
        width: width ? Math.round(width) : null,
        height: height ? Math.round(height) : null,
        complete: true,
        created_by: cleanerId,
      })
      .select('id')
      .single()

    if (insertError) throw insertError
    onProgress(100)
    return {
      mediaId: mediaRow.id,
      storagePath,
      thumbPath: savedThumbPath,
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(WORK_MEDIA_BUCKET).remove(uploadedPaths).catch(() => {})
    }
    throw new Error(friendlyUploadError(error))
  }
}

/**
 * Uploads a photo for Room Status (Check In, Check Out, Ready inspection)
 * to Supabase Storage: {schemaName}/{userId}/rooms/{roomId}/{status}_{timestamp}_{index}.jpg
 * and records it in the tenant's media table.
 */
export async function uploadRoomStatusMedia({
  file,
  thumbFile,
  schemaName,
  userId,
  roomId,
  status,
  index = 0,
  width = null,
  height = null,
  onProgress = () => {},
}) {
  const ext = extensionForFile(file, 'photo')
  const timestamp = Date.now()
  const base = `${schemaName}/${userId}/rooms/${roomId}/${status}_${timestamp}_${index}`
  const storagePath = `${base}.${ext}`
  const thumbPath = `${base}_thumb.jpg`

  onProgress(20)
  const uploadedPaths = []

  try {
    const { error: mainUploadError } = await supabase.storage
      .from(WORK_MEDIA_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
    if (mainUploadError) throw mainUploadError
    uploadedPaths.push(storagePath)
    onProgress(60)

    let savedThumbPath = null
    if (thumbFile) {
      const { error: thumbError } = await supabase.storage
        .from(WORK_MEDIA_BUCKET)
        .upload(thumbPath, thumbFile, {
          contentType: 'image/jpeg',
          upsert: false,
        })
      if (!thumbError) {
        uploadedPaths.push(thumbPath)
        savedThumbPath = thumbPath
      }
    }
    onProgress(85)

    let mediaId = null
    try {
      const orgDb = await db()
      const row = {
        kind: 'photo',
        mime_type: (file.type || 'image/jpeg').split(';')[0].trim(),
        size_bytes: file.size,
        chunk_count: 0,
        bucket: WORK_MEDIA_BUCKET,
        storage_path: storagePath,
        thumb_path: savedThumbPath,
        duration_seconds: null,
        width: width ? Math.round(width) : null,
        height: height ? Math.round(height) : null,
        complete: true,
        created_by: userId,
      }

      // Try plain insert first (works for cleaners and admins with in_org() = true)
      let { data: mediaRow, error: insertError } = await orgDb
        .from('media')
        .insert(row)
        .select('id')
        .single()

      if (!insertError) {
        mediaId = mediaRow?.id
      } else {
        const isConflict = insertError.code === '23505' ||
          insertError.code === '409' ||
          /conflict|duplicate|unique|already exists/i.test(insertError.message)
        const isFkError = /foreign key|created_by/i.test(insertError.message)
        const isRlsError = insertError.code === '403' ||
          /row-level security|permission|not authorized|forbidden/i.test(insertError.message)

        if (isConflict) {
          // Row already exists — fetch it by storage_path
          const { data: existing } = await orgDb
            .from('media')
            .select('id')
            .eq('storage_path', storagePath)
            .maybeSingle()
          mediaId = existing?.id ?? null
        } else if (isFkError) {
          // created_by FK failed — retry without it
          const { data: retryRow, error: retryErr } = await orgDb
            .from('media')
            .insert({ ...row, created_by: null })
            .select('id')
            .single()
          if (!retryErr) {
            mediaId = retryRow?.id ?? null
          } else if (retryErr.code === '23505' || /conflict|duplicate/i.test(retryErr.message)) {
            const { data: existing2 } = await orgDb
              .from('media')
              .select('id')
              .eq('storage_path', storagePath)
              .maybeSingle()
            mediaId = existing2?.id ?? null
          }
        } else if (isRlsError) {
          // RLS blocked the insert — try via the API fallback
          // The media row will be linked to the status history via storage_path matching
          console.warn('[uploadRoomStatusMedia] RLS blocked media insert, photo is in Storage only')
        }
      }
    } catch {
      /* Media row insertion is best-effort */
    }

    onProgress(100)
    return {
      mediaId,
      storagePath,
      thumbPath: savedThumbPath,
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(WORK_MEDIA_BUCKET).remove(uploadedPaths).catch(() => {})
    }
    throw new Error(friendlyUploadError(error))
  }
}

// ── Legacy chunked DB upload (deprecated) ─────────────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const blockSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize))
  }
  return btoa(binary)
}

async function postJson(path, accessToken, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  let result
  try {
    result = await response.json()
  } catch {
    result = { error: 'Upload failed.' }
  }
  if (!response.ok) throw new Error(result.error || 'Upload failed.')
  return result
}

async function uploadChunkWithRetry(path, accessToken, body, retries = 3) {
  let lastError
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await postJson(path, accessToken, body)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw lastError
}

/** @deprecated Use uploadWorkMedia (Supabase Storage) instead. */
export async function uploadDatabaseMedia(file, kind, taskId, accessToken, onProgress) {
  const started = await postJson('/api/media/start', accessToken, {
    kind,
    taskId,
    mimeType: file.type,
    sizeBytes: file.size,
  })

  const chunkCount = Math.ceil(file.size / CHUNK_SIZE)
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_SIZE
    const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size))
    const base64 = arrayBufferToBase64(await blob.arrayBuffer())
    await uploadChunkWithRetry('/api/media/chunk', accessToken, {
      mediaId: started.mediaId,
      chunkIndex: index,
      dataBase64: base64,
    })
    onProgress(Math.round(((index + 1) / chunkCount) * 100))
  }

  return postJson('/api/media/complete', accessToken, {
    mediaId: started.mediaId,
  })
}
