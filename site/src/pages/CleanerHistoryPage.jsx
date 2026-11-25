import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { formatDateTime, friendlyError } from '../lib/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function MediaLink({ mediaId, label }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function openMedia() {
    setLoading(true)
    setError('')
    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) {
      setError('Session expired.')
      setLoading(false)
      return
    }
    const response = await fetch(`/api/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      setError('Could not open media.')
      setLoading(false)
      return
    }
    const blob = await response.blob()
    const nextUrl = URL.createObjectURL(blob)
    setUrl(nextUrl)
    setLoading(false)
  }

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  if (url) {
    return <a href={url} target="_blank" rel="noreferrer">{label}</a>
  }
  return (
    <>
      <button type="button" className="text-button" onClick={openMedia} disabled={loading}>
        {loading ? 'Opening...' : label}
      </button>
      {error && <small className="form-error">{error}</small>}
    </>
  )
}

export default function CleanerHistoryPage() {
  const { revision } = useDataRefresh()
  const [date, setDate] = useState(today())
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadHistory() {
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
    const { data, error: loadError } = await orgDb
      .from('daily_assignments')
      .select('daily_tasks(id, task_name, finish_by, task_runs(id, run_date, cleaner_id, started_at, start_photo_id, finished_at, finish_video_id, state))')
      .eq('cleaner_id', cleanerId)
      .eq('work_date', date)
    if (loadError) {
      setError(friendlyError(loadError))
      setTasks([])
    } else {
      setTasks((data || []).flatMap((assignment) => assignment.daily_tasks || [])
        .sort((a, b) => a.finish_by.localeCompare(b.finish_by)))
    }
    setLoading(false)
  }

  useEffect(() => {
    loadHistory()
  }, [date, revision])

  const taskPagination = usePagination(tasks.length, 12, 12)

  return (
    <section className="content-page cleaner-page">
      <div className="page-heading cleaner-heading">
        <div><p className="eyebrow">Task records</p><h2>History</h2></div>
        <label className="branch-filter">
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      {loading ? (
        <div className="page-state-inline">Loading history...</div>
      ) : error ? (
        <div className="empty-state error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={loadHistory}>Retry</button></div>
      ) : tasks.length === 0 ? (
        <div className="empty-state"><p>No tasks were assigned for this date.</p></div>
      ) : (
        <div className="cleaner-task-grid">
          {taskPagination.visible(tasks).map((task) => {
            const run = task.task_runs?.find((item) => item.cleaner_id)
            return (
              <article className="cleaner-task-card" key={task.id}>
                <div className="cleaner-task-heading">
                  <div><p className="eyebrow">Finish by {task.finish_by}</p><h3>{task.task_name}</h3></div>
                  <span className={`task-state state-${run?.state || 'not_started'}`}>
                    {!run ? 'Not started' : run.state === 'completed' ? 'Completed' : 'In progress'}
                  </span>
                </div>
                {run?.started_at && <p className="task-meta">Started: {formatDateTime(run.started_at)}</p>}
                {run?.start_photo_id && <MediaLink mediaId={run.start_photo_id} label="View start photo" />}
                {run?.finished_at && <p className="task-meta">Finished: {formatDateTime(run.finished_at)}</p>}
                {run?.finish_video_id && <MediaLink mediaId={run.finish_video_id} label="View finish video" />}
              </article>
            )
          })}
        </div>
      )}
      <LoadMoreButton
        remaining={taskPagination.remaining}
        onClick={taskPagination.showMore}
      />
    </section>
  )
}
