import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import CleanerMediaPreview from '../components/ui/CleanerMediaPreview'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import PageHeader from '../components/ui/PageHeader'
import StatusBadge from '../components/ui/StatusBadge'
import { formatDateTime, friendlyError } from '../lib/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function CleanerHistoryPage() {
  const { revision } = useDataRefresh()
  const [date, setDate] = useState(today())
  const [search, setSearch] = useState('')
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
      .select('daily_tasks(id, task_name, finish_by, task_runs(id, run_date, cleaner_id, started_at, start_photo_id, finished_at, finish_video_id, state, start_photo:media!start_photo_id(storage_path, thumb_path), finish_video:media!finish_video_id(storage_path, thumb_path)))')
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

  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return tasks
    return tasks.filter((task) => String(task.task_name || '').toLowerCase().includes(term))
  }, [tasks, search])

  const taskPagination = usePagination(visibleTasks.length, 12, 12)

  return (
    <section className="content-page cleaner-page">
      <PageHeader
        eyebrow="Work log"
        title="Activity History"
        subtitle="Review your completed tasks, start photos, and finish videos."
        actions={
          <>
            <label className="search-field">
              <span className="sr-only">Search task name</span>
              <input
                type="search"
                placeholder="Search task name..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="branch-filter">
              <span>Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </>
        }
      />
      {loading ? (
        <div className="page-state-inline">Loading history...</div>
      ) : error ? (
        <div className="empty-state error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={loadHistory}>Retry</button></div>
      ) : tasks.length === 0 ? (
        <div className="empty-state"><p>No tasks were assigned for this date.</p></div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state"><p>No tasks match &ldquo;{search.trim()}&rdquo;.</p></div>
      ) : (
        <div className="cleaner-task-grid">
          {taskPagination.visible(visibleTasks).map((task) => {
            const runs = Array.isArray(task.task_runs)
              ? task.task_runs
              : task.task_runs
                ? [task.task_runs]
                : []
            const run = runs.find((item) => item.cleaner_id)
            return (
              <article className="cleaner-task-card" key={task.id}>
                <div className="cleaner-task-heading">
                  <div><p className="eyebrow">Finish by {task.finish_by}</p><h3>{task.task_name}</h3></div>
                  <StatusBadge
                    status={run?.state || 'not_started'}
                    label={!run ? 'Not started' : run.state === 'completed' ? 'Completed' : 'In progress'}
                  />
                </div>
                {run?.started_at && <p className="task-meta">Started: {formatDateTime(run.started_at)}</p>}
                {run?.finished_at && <p className="task-meta">Finished: {formatDateTime(run.finished_at)}</p>}
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
