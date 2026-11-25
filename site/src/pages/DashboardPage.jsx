import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { formatDateTime, friendlyError } from '../lib/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function statusLabel(status) {
  return ({
    check_in: 'Check in',
    check_out: 'Check out',
    clean_start: 'Clean start',
    clean_finished: 'Clean finished',
    ready: 'Ready',
  })[status] || 'No status'
}

export default function DashboardPage() {
  const { revision } = useDataRefresh()
  const [rooms, setRooms] = useState([])
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState('all')
  const [taskCounts, setTaskCounts] = useState({ completed: 0, pending: 0 })
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadDashboard() {
    setLoading(true)
    setError('')
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setError(tenantError.message)
      setLoading(false)
      return
    }
    const [branchResult, roomResult, historyResult, countsResult] = await Promise.all([
      orgDb.from('branches').select('branch_id').order('branch_id'),
      orgDb
        .from('rooms')
        .select('room_id, branch_id, current_status, status_time, updated_at')
        .order('room_id'),
      orgDb
        .from('room_status_history')
        .select('id, room_id, status, status_time, created_at, rooms(branch_id)')
        .order('created_at', { ascending: false })
        .limit(24),
      supabase.rpc('get_dashboard_counts', { p_work_date: today() }),
    ])
    if (branchResult.error || roomResult.error || historyResult.error) {
      setError(
        friendlyError(
          branchResult.error ||
          roomResult.error ||
          historyResult.error ||
          new Error('Could not load dashboard data.'),
        ),
      )
      setLoading(false)
      return
    }

    setBranches(branchResult.data || [])
    setRooms(roomResult.data || [])
    setActivity(historyResult.data || [])

    const counts = Array.isArray(countsResult.data)
      ? countsResult.data[0]
      : countsResult.data
    if (!countsResult.error && counts) {
      setTaskCounts({
        completed: Number(counts.tasks_completed || 0),
        pending: Number(counts.tasks_pending || 0),
      })
    } else {
      // Fallback for databases where the aggregate RPC has not been applied.
      const assignmentResult = await orgDb
        .from('daily_assignments')
        .select('id, daily_tasks(id, task_runs(state))')
        .eq('work_date', today())
      if (!assignmentResult.error) {
        let completed = 0
        let pending = 0
        for (const assignment of assignmentResult.data || []) {
          for (const task of assignment.daily_tasks || []) {
            if (task.task_runs?.some((run) => run.state === 'completed')) completed += 1
            else pending += 1
          }
        }
        setTaskCounts({ completed, pending })
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadDashboard()
  }, [revision])

  const visibleRooms = useMemo(
    () => branch === 'all' ? rooms : rooms.filter((room) => room.branch_id === branch),
    [rooms, branch],
  )

  const readyCount = visibleRooms.filter((room) => room.current_status === 'ready').length
  const cleaningCount = visibleRooms.filter((room) => room.current_status === 'clean_start').length
  const visibleActivity = branch === 'all'
    ? activity
    : activity.filter((entry) => entry.rooms?.branch_id === branch)
  const roomPagination = usePagination(visibleRooms.length, 12, 12)
  const activityPagination = usePagination(visibleActivity.length, 8, 8)

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Admin dashboard</h2>
        </div>
        <label className="branch-filter">
          <span>Branch</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="all">All branches</option>
            {branches.map((item) => (
              <option key={item.branch_id} value={item.branch_id}>{item.branch_id}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="page-state-inline">Loading dashboard...</div>
      ) : error ? (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadDashboard}>Retry</button>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <article className="metric-card"><p>Rooms ready</p><strong>{readyCount}</strong></article>
            <article className="metric-card"><p>Cleaning in progress</p><strong>{cleaningCount}</strong></article>
            <article className="metric-card"><p>Tasks completed</p><strong>{taskCounts.completed}</strong></article>
            <article className="metric-card"><p>Tasks pending</p><strong>{taskCounts.pending}</strong></article>
          </div>

          <div className="dashboard-layout">
            <section className="dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Live status</p><h3>Room statuses</h3></div>
              </div>
              {visibleRooms.length === 0 ? (
                <div className="empty-state compact"><p>No rooms match this branch.</p></div>
              ) : (
                <div className="room-status-grid">
                  {roomPagination.visible(visibleRooms).map((room) => (
                    <article className="room-status-card" key={room.room_id}>
                      <div>
                        <span className="room-id">Room {room.room_id}</span>
                        <small>{room.branch_id}</small>
                      </div>
                      <span className={`status-badge status-${room.current_status || 'none'}`}>
                        {statusLabel(room.current_status)}
                      </span>
                    </article>
                  ))}
                </div>
              )}
              <LoadMoreButton
                remaining={roomPagination.remaining}
                onClick={roomPagination.showMore}
              />
            </section>

            <section className="dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Latest changes</p><h3>Recent activity</h3></div>
              </div>
              {visibleActivity.length === 0 ? (
                <div className="empty-state compact"><p>No recent activity.</p></div>
              ) : (
                <ol className="activity-list">
                  {activityPagination.visible(visibleActivity).map((entry) => (
                    <li key={entry.id}>
                      <span className={`status-dot status-${entry.status}`} />
                      <div>
                        <strong>Room {entry.room_id} · {statusLabel(entry.status)}</strong>
                        <p>{formatDateTime(entry.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <LoadMoreButton
                remaining={activityPagination.remaining}
                onClick={activityPagination.showMore}
              />
            </section>
          </div>
        </>
      )}
    </section>
  )
}
