export const MAX_PHOTO_BYTES = 400 * 1024
export const MAX_VIDEO_SECONDS = 60
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024
export const CHUNK_SIZE = 3 * 1024 * 1024

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
