import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  compressPhoto,
  generatePhotoThumbnail,
  generateVideoPoster,
  getImageDimensions,
  getVideoDuration,
  getVideoResolution,
  uploadWorkMedia,
  validateVideo,
} from '../lib/media'
import { db } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import CameraCapture from '../components/ui/CameraCapture'
import CleanerMediaPreview from '../components/ui/CleanerMediaPreview'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { formatTime, friendlyError } from '../lib/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function taskRunOf(task) {
  if (!task?.task_runs) return undefined
  return Array.isArray(task.task_runs) ? task.task_runs[0] : task.task_runs
}

function taskState(task) {
  const run = taskRunOf(task)
  if (!run) return 'not_started'
  return run.state === 'completed' ? 'completed' : 'in_progress'
}

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('start_by') ||
    message.includes('daily_task_field_values') ||
    message.includes('branch_id') ||
    message.includes('room_id')
  )
}

export default function CleanerTasksPage() {
  const { schemaName } = useAuth()
  const { revision } = useDataRefresh()
  const [tasks, setTasks] = useState([])
  const [branches, setBranches] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTask, setSelectedTask] = useState(null)
  const [action, setAction] = useState(null)
  const [actionFieldDrafts, setActionFieldDrafts] = useState([])
  const [mediaFile, setMediaFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [thumbFile, setThumbFile] = useState(null)

  useEffect(() => {
    if (!mediaFile) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(mediaFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [mediaFile])
  const [mediaMeta, setMediaMeta] = useState({ durationSeconds: null, width: null, height: null })
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [progress, setProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [detailsTask, setDetailsTask] = useState(null)
  const [fieldDrafts, setFieldDrafts] = useState([])
  const [detailsError, setDetailsError] = useState('')
  const [detailsSaving, setDetailsSaving] = useState(false)

  async function loadTasks() {
    setLoading(true)
    setError('')
    const { data: sessionData } = await supabase.auth.getSession()
    const cleanerId = sessionData.session?.user.id
    if (!cleanerId) {
      setError('Could not identify the signed-in cleaner.')
      setLoading(false)
      return
    }
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setError(tenantError.message)
      setLoading(false)
      return
    }
    const [branchResult, roomResult] = await Promise.all([
      orgDb.from('branches').select('branch_id').order('branch_id'),
      orgDb.from('rooms').select('room_id, branch_id').order('branch_id').order('room_id'),
    ])
    if (!branchResult.error) setBranches(branchResult.data || [])
    if (!roomResult.error) setRooms(roomResult.data || [])

    let result = await orgDb
      .from('daily_assignments')
      .select('id, work_date, daily_tasks(id, task_name, start_by, finish_by, branch_id, room_id, daily_task_field_values(id, field_name, field_value, sort_order), task_runs(id, run_date, cleaner_id, branch_id, room_id, started_at, start_photo_id, finished_at, finish_video_id, state, start_photo:media!start_photo_id(storage_path, thumb_path), finish_video:media!finish_video_id(storage_path, thumb_path))))')
      .eq('cleaner_id', cleanerId)
      .eq('work_date', today())
      .order('work_date')
    if (result.error && isSchemaError(result.error)) {
      result = await orgDb
        .from('daily_assignments')
        .select('id, work_date, daily_tasks(id, task_name, finish_by, task_runs(id, run_date, cleaner_id, started_at, start_photo_id, finished_at, finish_video_id, state))')
        .eq('cleaner_id', cleanerId)
        .eq('work_date', today())
        .order('work_date')
    }
    if (result.error) {
      setError(friendlyError(result.error))
      setTasks([])
    } else {
      const allTasks = (result.data || []).flatMap((assignment) =>
        (assignment.daily_tasks || []).map((task) => ({
          ...task,
          assignmentId: assignment.id,
          workDate: assignment.work_date,
          fields: [...(task.daily_task_field_values || [])].sort(
            (left, right) => (left.sort_order || 0) - (right.sort_order || 0),
          ),
        })),
      )
      setTasks(
        allTasks.sort((left, right) =>
          String(left.start_by || '99:99').localeCompare(String(right.start_by || '99:99')) ||
          String(left.finish_by).localeCompare(String(right.finish_by)),
        ),
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    loadTasks()
  }, [revision])

  const visibleTasks = useMemo(
    () => filter === 'all' ? tasks : tasks.filter((task) => taskState(task) === filter),
    [tasks, filter],
  )
  const taskPagination = usePagination(visibleTasks.length, 12, 12)

  function openAction(task, nextAction) {
    setDetailsTask(null)
    setSelectedTask(task)
    setAction(nextAction)
    setMediaFile(null)
    setThumbFile(null)
    setMediaMeta({ durationSeconds: null, width: null, height: null })
    setSelectedBranchId(task.branch_id || '')
    setSelectedRoomId(task.room_id || '')
    setActionFieldDrafts((task.fields || []).map((field) => ({ ...field })))
    setProgress(0)
    setFormError('')
  }

  function openDetails(task) {
    setSelectedTask(null)
    setDetailsTask(task)
    setFieldDrafts((task.fields || []).map((field) => ({ ...field })))
    setDetailsError('')
  }

  async function saveDetails(event) {
    event.preventDefault()
    setDetailsError('')
    const names = fieldDrafts.map((field) => field.field_name.trim())
    if (names.some((name) => !name)) {
      setDetailsError('Every field needs a name.')
      return
    }
    setDetailsSaving(true)
    try {
      const orgDb = await db()
      for (const field of fieldDrafts) {
        if (!field.id) continue
        const { error: updateError } = await orgDb
          .from('daily_task_field_values')
          .update({ field_value: field.field_value || '' })
          .eq('id', field.id)
        if (updateError) throw updateError
      }
      setDetailsTask(null)
      await loadTasks()
    } catch (saveError) {
      setDetailsError(saveError.message)
    } finally {
      setDetailsSaving(false)
    }
  }

  async function handleFile(file, knownDurationSeconds = null) {
    setFormError('')
    setThumbFile(null)
    setMediaMeta({ durationSeconds: null, width: null, height: null })
    if (!file) return
    try {
      if (action === 'start') {
        if (!file.type.startsWith('image/')) {
          setFormError('Capture an image photo with your camera.')
          return
        }
        setSaving(true)
        const compressed = await compressPhoto(file)
        const [dims, thumb] = await Promise.all([
          getImageDimensions(compressed),
          generatePhotoThumbnail(compressed),
        ])
        setMediaFile(compressed)
        setThumbFile(thumb)
        setMediaMeta({ durationSeconds: null, width: dims.width, height: dims.height })
        setSaving(false)
      } else {
        if (!file.type.startsWith('video/')) {
          setFormError('Record a video with your camera.')
          return
        }
        const limitError = validateVideo(file)
        if (limitError) {
          setFormError(limitError)
          return
        }
        setSaving(true)
        let duration = knownDurationSeconds
        if (!duration || !Number.isFinite(duration)) {
          try {
            const probed = await getVideoDuration(file)
            if (Number.isFinite(probed)) duration = probed
          } catch {
            duration = knownDurationSeconds
          }
        }
        const resolution = await getVideoResolution(file)
        if (duration && duration > MAX_VIDEO_SECONDS) {
          setSaving(false)
          setFormError(`Video exceeds the ${MAX_VIDEO_SECONDS}-second limit.`)
          return
        }
        if (
          Math.max(resolution.width, resolution.height) > 854 ||
          Math.min(resolution.width, resolution.height) > 480
        ) {
          setSaving(false)
          setFormError('Video resolution must be 480p or lower.')
          return
        }
        const poster = await generateVideoPoster(file)
        setMediaFile(file)
        setThumbFile(poster)
        setMediaMeta({
          durationSeconds: duration,
          width: resolution.width,
          height: resolution.height,
        })
        setSaving(false)
      }
    } catch (validationError) {
      setSaving(false)
      setFormError(validationError.message)
    }
  }

  async function saveAction(event) {
    if (event?.preventDefault) event.preventDefault()
    if (saving) return
    if (!mediaFile) {
      setFormError(action === 'start' ? 'Upload a start photo.' : 'Upload a finish video.')
      return
    }
    setSaving(true)
    setFormError('')
    setProgress(5)
    const { data: sessionData } = await supabase.auth.getSession()
    const cleanerId = sessionData.session?.user.id
    if (!cleanerId || !schemaName) {
      setFormError('Your session expired. Sign in again.')
      setSaving(false)
      return
    }

    try {
      const uploaded = await uploadWorkMedia({
        file: mediaFile,
        thumbFile,
        kind: action === 'start' ? 'photo' : 'video',
        stage: action === 'start' ? 'start' : 'finish',
        schemaName,
        cleanerId,
        workDate: selectedTask.workDate || today(),
        dailyTaskId: selectedTask.id,
        durationSeconds: mediaMeta.durationSeconds,
        width: mediaMeta.width,
        height: mediaMeta.height,
        onProgress: setProgress,
      })

      const orgDb = await db()
      if (action === 'start') {
        const insertPayload = {
          daily_task_id: selectedTask.id,
          run_date: today(),
          cleaner_id: cleanerId,
          started_at: new Date().toISOString(),
          start_photo_id: uploaded.mediaId,
          state: 'in_progress',
          ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
          ...(selectedRoomId ? { room_id: selectedRoomId } : {}),
        }
        const { error: insertError } = await orgDb.from('task_runs').insert(insertPayload)
        if (insertError) throw insertError
      } else {
        const run = taskRunOf(selectedTask)
        if (!run) throw new Error('Start this task before finishing it.')
        const { error: updateError } = await orgDb
          .from('task_runs')
          .update({
            finished_at: new Date().toISOString(),
            finish_video_id: uploaded.mediaId,
            state: 'completed',
          })
          .eq('id', run.id)
          .eq('cleaner_id', cleanerId)
        if (updateError) throw updateError
      }
      if (action === 'finish') {
        for (const field of actionFieldDrafts) {
          if (!field.id) continue
          const { error: fieldUpdateError } = await orgDb
            .from('daily_task_field_values')
            .update({ field_value: field.field_value || '' })
            .eq('id', field.id)
          if (fieldUpdateError) throw fieldUpdateError
        }
      }
      setSelectedTask(null)
      setAction(null)
      await loadTasks()
    } catch (saveError) {
      setFormError(friendlyError(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="content-page cleaner-page">
      <div className="page-heading cleaner-heading">
        <div>
          <p className="eyebrow">Today</p>
          <h2>My tasks</h2>
        </div>
      </div>
      <div className="task-filter" role="group" aria-label="Filter tasks">
        {[
          ['all', 'All'],
          ['not_started', 'Not started'],
          ['in_progress', 'In progress'],
          ['completed', 'Completed'],
        ].map(([value, label]) => (
          <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="page-state-inline">Loading today's tasks...</div>
      ) : error ? (
        <div className="empty-state error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={loadTasks}>Retry</button></div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state"><p>No tasks match this filter.</p></div>
      ) : (
        <div className="cleaner-task-grid">
          {taskPagination.visible(visibleTasks).map((task) => {
            const state = taskState(task)
            const run = taskRunOf(task)
            return (
              <article className="cleaner-task-card" key={task.id}>
                <div className="cleaner-task-heading">
                  <div>
                    <p className="eyebrow">
                      {task.start_by ? `${task.start_by} – ${task.finish_by}` : `Finish by ${task.finish_by}`}
                    </p>
                    <h3>{task.task_name}</h3>
                  </div>
                  <span className={`task-state state-${state}`}>
                    {state === 'not_started' ? 'Not started' : state === 'in_progress' ? 'In progress' : 'Completed'}
                  </span>
                </div>
                {run?.started_at && <p className="task-meta">Started {formatTime(run.started_at)}</p>}
                {run?.finished_at && <p className="task-meta">Finished {formatTime(run.finished_at)}</p>}
                {(run?.start_photo_id || run?.finish_video_id) && (
                  <div className="cleaner-media-grid">
                    {run?.start_photo_id && (
                      <CleanerMediaPreview
                        mediaId={run.start_photo_id}
                        storagePath={run.start_photo?.storage_path}
                        thumbPath={run.start_photo?.thumb_path}
                        kind="photo"
                        label="Start photo"
                        timestamp={run.started_at}
                      />
                    )}
                    {run?.finish_video_id && (
                      <CleanerMediaPreview
                        mediaId={run.finish_video_id}
                        storagePath={run.finish_video?.storage_path}
                        thumbPath={run.finish_video?.thumb_path}
                        kind="video"
                        label="Finish video"
                        timestamp={run.finished_at}
                      />
                    )}
                  </div>
                )}
                {task.fields?.length > 0 && (
                  <div className="daily-task-fields compact-fields">
                    {task.fields.map((field) => (
                      <div className="daily-task-field" key={field.id}>
                        <span>{field.field_name}</span>
                        <strong>{field.field_value || '—'}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="card-actions">
                  {state === 'not_started' && (
                    <button type="button" className="primary-button task-action" onClick={() => openAction(task, 'start')}>Start task</button>
                  )}
                  {state === 'in_progress' && (
                    <button type="button" className="primary-button task-action" onClick={() => openAction(task, 'finish')}>Finish task</button>
                  )}
                  {state === 'completed' && <button type="button" className="secondary-button task-action" disabled>Completed</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <LoadMoreButton
        remaining={taskPagination.remaining}
        onClick={taskPagination.showMore}
      />

      {selectedTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedTask(null)}>
          <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="media-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{action === 'start' ? 'Start task' : 'Finish task'}</p>
                <h2 id="media-title">{selectedTask.task_name}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedTask(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={saveAction} noValidate>
              {action === 'start' && !selectedTask.room_id && (branches.length > 0 || rooms.length > 0) && (
                <div className="field-grid two">
                  <label>
                    <span className="field-label">Work Track <small className="optional-label">(optional)</small></span>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => {
                        setSelectedBranchId(e.target.value)
                        setSelectedRoomId('')
                      }}
                    >
                      <option value="">Select work track</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>{b.branch_id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-label">Location / Unit <small className="optional-label">(optional)</small></span>
                    <select
                      value={selectedRoomId}
                      onChange={(e) => {
                        const roomVal = e.target.value
                        setSelectedRoomId(roomVal)
                        const matched = rooms.find((r) => r.room_id === roomVal && (!selectedBranchId || r.branch_id === selectedBranchId))
                        if (matched && !selectedBranchId) setSelectedBranchId(matched.branch_id)
                      }}
                    >
                      <option value="">Select location / unit</option>
                      {rooms
                        .filter((r) => !selectedBranchId || r.branch_id === selectedBranchId)
                        .map((r) => (
                          <option key={`${r.branch_id}:${r.room_id}`} value={r.room_id}>
                            {r.room_id} ({r.branch_id})
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              <span className="field-label">
                {action === 'start' ? 'Start photo (camera only)' : 'Finish video (camera only)'}
              </span>
              {!mediaFile ? (
                <>
                  <CameraCapture
                    mode={action === 'start' ? 'photo' : 'video'}
                    maxSeconds={MAX_VIDEO_SECONDS}
                    stampLabel={[
                      selectedTask.task_name,
                      selectedRoomId || selectedTask.room_id ? `Room ${selectedRoomId || selectedTask.room_id}` : '',
                      selectedBranchId || selectedTask.branch_id || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    disabled={saving}
                    onCapture={(capturedFile, secs) => handleFile(capturedFile, secs)}
                  />
                  {action === 'start' ? (
                    <p className="upload-help">Take a live photo using your camera. Gallery uploads are disabled.</p>
                  ) : (
                    <p className="upload-help">
                      Record a live video up to {MAX_VIDEO_SECONDS} seconds ({MAX_VIDEO_BYTES / 1024 / 1024} MB max). Gallery uploads are disabled.
                    </p>
                  )}
                </>
              ) : (
                <div className="upload-preview-box">
                  <div className="upload-preview-header">
                    <span className="upload-ready">Captured and ready to submit</span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() => {
                        setMediaFile(null)
                        setThumbFile(null)
                        setMediaMeta({ durationSeconds: null, width: null, height: null })
                        setFormError('')
                      }}
                    >
                      Retake
                    </button>
                  </div>
                  {previewUrl && (
                    action === 'start' ? (
                      <img src={previewUrl} alt="Captured start preview" className="cleaner-media-img" />
                    ) : (
                      <video src={previewUrl} controls playsInline preload="metadata" className="cleaner-media-video" />
                    )
                  )}
                </div>
              )}
              {action === 'finish' && actionFieldDrafts.length > 0 && (
                <div className="task-custom-fields">
                  <span className="field-label">Task details</span>
                  <div className="field-grid two">
                    {actionFieldDrafts.map((field, index) => (
                      <label key={field.id || `action-field-${index}`}>
                        <span className="field-label">{field.field_name}</span>
                        <input
                          placeholder={`Enter ${field.field_name}`}
                          value={field.field_value || ''}
                          onChange={(event) =>
                            setActionFieldDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, field_value: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {progress > 0 && (
                <div className="progress-wrap">
                  <div
                    className="progress-bar"
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <small>Uploading... {progress}%</small>
                </div>
              )}
              {formError && (
                <div className="form-error" role="alert">
                  <span>{formError}</span>
                  {mediaFile && !saving && (
                    <button type="button" className="text-button" onClick={saveAction}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setSelectedTask(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving || !mediaFile}>
                  {saving ? 'Uploading...' : action === 'start' ? 'Start & save' : 'Finish & save'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {detailsTask && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDetailsTask(null)}>
          <section
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="details-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Task details</p>
                <h2 id="details-title">{detailsTask.task_name}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDetailsTask(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={saveDetails} noValidate>
              {fieldDrafts.length === 0 ? (
                <p className="field-hint">This task has no extra fields.</p>
              ) : fieldDrafts.map((field, index) => (
                <label key={field.id || `new-${index}`}>
                  <span className="field-label">{field.field_name}</span>
                  <input
                    value={field.field_value || ''}
                    onChange={(event) =>
                      setFieldDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, field_value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              {detailsError && <p className="form-error" role="alert">{detailsError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setDetailsTask(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={detailsSaving || !fieldDrafts.length}>
                  {detailsSaving ? 'Saving...' : 'Save details'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
