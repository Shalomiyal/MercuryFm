import { useCallback, useEffect, useRef, useState } from 'react'

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function formatDateTimeStamp(date = new Date()) {
  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)
  return `${datePart} · ${timePart}`
}

function drawStampOnCanvas(ctx, width, height, dateTimeText, subLabel = '') {
  const fontSize = Math.max(13, Math.round(Math.min(width, height) * 0.03))
  const subSize = Math.max(11, Math.round(fontSize * 0.85))
  const padX = Math.round(fontSize * 0.75)
  const padY = Math.round(fontSize * 0.5)
  const margin = Math.round(fontSize * 0.75)
  const lineGap = subLabel ? Math.round(fontSize * 0.35) : 0

  ctx.save()
  ctx.font = `700 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const mainW = ctx.measureText(dateTimeText).width
  ctx.font = `600 ${subSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const subW = subLabel ? ctx.measureText(subLabel).width : 0

  const boxW = Math.min(Math.max(mainW, subW) + padX * 2, width - margin * 2)
  const boxH = fontSize + (subLabel ? subSize + lineGap : 0) + padY * 2
  const x = margin
  const y = height - margin - boxH
  const r = Math.min(8, boxH / 2)

  ctx.fillStyle = 'rgba(16, 18, 24, 0.76)'
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + boxW - r, y)
  ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r)
  ctx.lineTo(x + boxW, y + boxH - r)
  ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH)
  ctx.lineTo(x + r, y + boxH)
  ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'top'
  ctx.font = `700 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  ctx.fillText(dateTimeText, x + padX, y + padY, boxW - padX * 2)

  if (subLabel) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
    ctx.font = `600 ${subSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.fillText(subLabel, x + padX, y + padY + fontSize + lineGap, boxW - padX * 2)
  }
  ctx.restore()
}

export default function CameraCapture({
  mode = 'photo',
  maxSeconds = 60,
  stampLabel = '',
  onCapture,
  disabled = false,
}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const rafRef = useRef(null)
  const startedAtRef = useRef(0)

  const [facingMode, setFacingMode] = useState('environment')
  const [cameraReady, setCameraReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveStamp, setLiveStamp] = useState(() => formatDateTimeStamp())
  const [error, setError] = useState('')

  useEffect(() => {
    const id = setInterval(() => setLiveStamp(formatDateTimeStamp()), 1000)
    return () => clearInterval(id)
  }, [])

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current) {
      clearInterval(rafRef.current)
      rafRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    setCameraReady(false)
    setRecording(false)
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    setError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access requires HTTPS or a supported mobile/desktop browser.')
      return
    }

    const videoConstraints = {
      facingMode: { ideal: facingMode },
      width: { ideal: mode === 'photo' ? 1280 : 640 },
      height: { ideal: mode === 'photo' ? 720 : 480 },
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: mode === 'video',
      })
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        })
      } catch {
        setError('Camera permission was denied or no camera was found. Allow camera access to continue.')
        return
      }
    }

    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      try {
        await videoRef.current.play()
      } catch {
        /* autoplay handled by muted/playsInline */
      }
    }
    setCameraReady(true)
  }, [facingMode, mode, stopStream])

  useEffect(() => {
    startCamera()
    return () => stopStream()
  }, [startCamera, stopStream])

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    drawStampOnCanvas(ctx, canvas.width, canvas.height, formatDateTimeStamp(), stampLabel)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not capture photo. Try again.')
          return
        }
        const file = new File([blob], `start-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        stopStream()
        onCapture?.(file)
      },
      'image/jpeg',
      0.92,
    )
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current) {
      clearInterval(rafRef.current)
      rafRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  function startRecording() {
    const video = videoRef.current
    if (!streamRef.current || !video || typeof MediaRecorder === 'undefined') {
      setError('Video recording is not supported in this browser.')
      return
    }
    setError('')
    chunksRef.current = []

    // Burn live date & timestamp onto every video frame via canvas captureStream
    let recordStream = streamRef.current
    if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const drawNow = () => {
          if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            drawStampOnCanvas(ctx, canvas.width, canvas.height, formatDateTimeStamp(), stampLabel)
          }
        }
        drawNow()
        rafRef.current = setInterval(drawNow, Math.round(1000 / 24))

        const canvasStream = canvas.captureStream(24)
        const audioTracks = streamRef.current.getAudioTracks()
        for (const track of audioTracks) {
          canvasStream.addTrack(track)
        }
        recordStream = canvasStream
      }
    }

    const mimeType = pickRecorderMimeType()
    const options = {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 900_000,
    }
    let recorder
    try {
      recorder = new MediaRecorder(recordStream, options)
    } catch {
      recorder = new MediaRecorder(recordStream)
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
      const resolvedMime = recorder.mimeType || mimeType || 'video/webm'
      const ext = resolvedMime.includes('mp4') ? 'mp4' : 'webm'
      const blob = new Blob(chunksRef.current, { type: resolvedMime })
      chunksRef.current = []
      setRecording(false)
      if (!blob.size) {
        setError('Recorded video was empty. Try again.')
        return
      }
      const file = new File([blob], `finish-video-${Date.now()}.${ext}`, { type: resolvedMime })
      stopStream()
      onCapture?.(file, durationSec)
    }

    startedAtRef.current = Date.now()
    setElapsed(0)
    setRecording(true)
    recorderRef.current = recorder
    recorder.start(500)

    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsed(secs)
      if (secs >= maxSeconds) {
        stopRecording()
      }
    }, 250)
  }

  return (
    <div className="camera-capture">
      <div className="camera-stage">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-viewfinder"
        />
        {recording && (
          <div className="camera-rec-pill" role="status">
            <span className="camera-rec-dot" />
            <span>REC {formatClock(elapsed)} / {formatClock(maxSeconds)}</span>
          </div>
        )}
        <div className="camera-stamp-overlay" aria-hidden="true">
          <div>{liveStamp}</div>
          {stampLabel ? <small>{stampLabel}</small> : null}
        </div>
        <button
          type="button"
          className="camera-flip-btn"
          onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
          disabled={recording || disabled}
          aria-label="Switch camera"
          title="Switch camera"
        >
          ↺ Flip
        </button>
      </div>

      {error ? (
        <div className="form-error" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={startCamera}>
            Retry camera
          </button>
        </div>
      ) : null}

      <div className="camera-controls">
        {mode === 'photo' ? (
          <button
            type="button"
            className="primary-button camera-shutter-btn"
            onClick={takePhoto}
            disabled={!cameraReady || disabled}
          >
            Capture photo
          </button>
        ) : recording ? (
          <button
            type="button"
            className="primary-button camera-stop-btn"
            onClick={stopRecording}
            disabled={disabled}
          >
            Stop recording ({formatClock(elapsed)})
          </button>
        ) : (
          <button
            type="button"
            className="primary-button camera-shutter-btn"
            onClick={startRecording}
            disabled={!cameraReady || disabled}
          >
            Start recording
          </button>
        )}
      </div>
    </div>
  )
}
