import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  compressPhoto,
  getVideoDuration,
  getVideoResolution,
  uploadDatabaseMedia,
  validateVideo,
} from '../lib/media'
import { db } from '../lib/db'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { formatTime, friendlyError } from '../lib/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function taskState(task) {
  const run = task.task_runs?.[0]
  if (!run) return 'not_started'
  return run.state === 'completed' ? 'completed' : 'in_progress'
}

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('start_by') || message.includes('daily_task_field_values')
}

export default function CleanerTasksPage() {
  const { revision } = useDataRefresh()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTask, setSelectedTask] = useState(null)
  const [action, setAction] = useState(null)
  const [mediaFile, setMediaFile] = useState(null)
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
    let result = await orgDb
      .from('daily_assignments')
      .select('id, work_date, daily_tasks(id, task_name, start_by, finish_by, daily_task_field_values(id, field_name, field_value, sort_order), task_runs(id, run_date, cleaner_id, started_at, start_photo_id, finished_at, finish_video_id, state))')
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

  async function handleFile(file) {
    setFormError('')
    if (!file) return
    try {
      if (action === 'start') {
        if (!file.type.startsWith('image/')) {
          setFormError('Choose an image photo.')
          return
        }
        setSaving(true)
        const compressed = await compressPhoto(file)
        setMediaFile(compressed)
        setSaving(false)
      } else {
        if (!file.type.startsWith('video/')) {
          setFormError('Choose a video file.')
          return
        }
        const limitError = validateVideo(file)
        if (limitError) {
          setFormError(limitError)
          return
        }
        setSaving(true)
        const duration = await getVideoDuration(file)
        const resolution = await getVideoResolution(file)
        setSaving(false)
        if (duration > MAX_VIDEO_SECONDS) {
          setFormError(`Video exceeds the ${MAX_VIDEO_SECONDS}-second limit.`)
          return
        }
        if (resolution.width > 854 || resolution.height > 480) {
          setFormError('Video resolution must be 480p or lower.')
          return
        }
        setMediaFile(file)
      }
    } catch (validationError) {
      setSaving(false)
      setFormError(validationError.message)
    }
  }

  async function saveAction(event) {
    event.preventDefault()
    if (!mediaFile) {
      setFormError(action === 'start' ? 'Upload a start photo.' : 'Upload a finish video.')
      return
    }
    setSaving(true)
    setFormError('')
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) {
      setFormError('Your session expired. Sign in again.')
      setSaving(false)
      return
    }

    try {
      const uploaded = await uploadDatabaseMedia(
        mediaFile,
        action === 'start' ? 'photo' : 'video',
        selectedTask.id,
        accessToken,
        setProgress,
      )
      if (action === 'start') {
        const orgDb = await db()
        const { error: insertError } = await orgDb
          .from('task_runs')
          .insert({
            daily_task_id: selectedTask.id,
            run_date: today(),
            cleaner_id: sessionData.session.user.id,
            started_at: new Date().toISOString(),
            start_photo_id: uploaded.mediaId,
            state: 'in_progress',
          })
        if (insertError) throw insertError
      } else {
        const run = selectedTask.task_runs?.[0]
        if (!run) throw new Error('Start this task before finishing it.')
        const orgDb = await db()
        const { error: updateError } = await orgDb
          .from('task_runs')
          .update({
            finished_at: new Date().toISOString(),
            finish_video_id: uploaded.mediaId,
            state: 'completed',
          })
          .eq('id', run.id)
          .eq('cleaner_id', sessionData.session.user.id)
        if (updateError) throw updateError
      }
      setSelectedTask(null)
      setAction(null)
      await loadTasks()
    } catch (saveError) {
      setFormError(saveError.message)
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
            const run = task.task_runs?.[0]
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
                  {task.fields?.length > 0 && (
                    <button type="button" className="secondary-button task-action" onClick={() => openDetails(task)}>Details</button>
                  )}
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
              <label htmlFor="media-file">{action === 'start' ? 'Start photo' : 'Finish video'}</label>
              <input
                id="media-file"
                type="file"
                accept={action === 'start' ? 'image/*' : 'video/*'}
                capture={action === 'start' ? 'environment' : undefined}
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              {action === 'start' && <p className="upload-help">Photo is compressed on this device before upload.</p>}
              {action === 'finish' && <p className="upload-help">Maximum {MAX_VIDEO_SECONDS} seconds, {MAX_VIDEO_BYTES / 1024 / 1024} MB, 480p.</p>}
              {mediaFile && <p className="upload-ready">Selected: {mediaFile.name}</p>}
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
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setSelectedTask(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving || !mediaFile}>
                  {saving ? 'Preparing...' : action === 'start' ? 'Start & save' : 'Finish & save'}
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
