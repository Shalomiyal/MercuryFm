import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import { db } from '../lib/db'
import { formatDateTime, friendlyError } from '../lib/format'
import ChartCard from '../components/ui/ChartCard'
import EmptyState from '../components/ui/EmptyState'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'

function isoDateOffset(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function greetingForHour() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatReadableToday() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
}

const RANGE_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
]

export default function DashboardPage() {
  const { profile } = useAuth()
  const { revision } = useDataRefresh()
  const [dateRange, setDateRange] = useState('today')
  const [branch, setBranch] = useState('all')
  const [rooms, setRooms] = useState([])
  const [branches, setBranches] = useState([])
  const [staff, setStaff] = useState([])
  const [assignments, setAssignments] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const dateBounds = useMemo(() => {
    const today = isoDateOffset(0)
    if (dateRange === 'yesterday') {
      const y = isoDateOffset(1)
      return { from: y, to: y }
    }
    if (dateRange === '7d') {
      return { from: isoDateOffset(6), to: today }
    }
    if (dateRange === '30d') {
      return { from: isoDateOffset(29), to: today }
    }
    return { from: today, to: today }
  }, [dateRange])

  const loadDashboard = useCallback(async () => {
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

    const [branchResult, roomResult, staffResult, assignmentResult, historyResult] =
      await Promise.all([
        orgDb.from('branches').select('branch_id').order('branch_id'),
        orgDb
          .from('rooms')
          .select('room_id, branch_id, current_status, status_time, updated_at')
          .order('room_id'),
        orgDb
          .from('members')
          .select('id, full_name, is_active, role')
          .eq('role', 'cleaner'),
        orgDb
          .from('daily_assignments')
          .select('id, work_date, cleaner_id, daily_tasks(id, task_name, branch_id, room_id, finish_by, task_runs(state, finished_at))')
          .gte('work_date', dateBounds.from)
          .lte('work_date', dateBounds.to),
        orgDb
          .from('room_status_history')
          .select('id, room_id, status, status_time, created_at, rooms(branch_id)')
          .order('created_at', { ascending: false })
          .limit(24),
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
    setStaff(staffResult.error ? [] : staffResult.data || [])
    setAssignments(assignmentResult.error ? [] : assignmentResult.data || [])
    setActivity(historyResult.data || [])
    setLoading(false)
  }, [dateBounds])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard, revision])

  const visibleRooms = useMemo(
    () => (branch === 'all' ? rooms : rooms.filter((room) => room.branch_id === branch)),
    [rooms, branch],
  )

  const taskStats = useMemo(() => {
    let assigned = 0
    let completed = 0
    let inProgress = 0
    let pending = 0
    const byBranch = {}

    for (const assignment of assignments) {
      for (const task of assignment.daily_tasks || []) {
        const taskBranch = task.branch_id || 'General'
        if (branch !== 'all' && task.branch_id && task.branch_id !== branch) continue

        assigned += 1
        if (!byBranch[taskBranch]) {
          byBranch[taskBranch] = { branch: taskBranch, total: 0, completed: 0 }
        }
        byBranch[taskBranch].total += 1

        const runs = Array.isArray(task.task_runs)
          ? task.task_runs
          : task.task_runs
            ? [task.task_runs]
            : []
        if (runs.some((r) => r.state === 'completed')) {
          completed += 1
          byBranch[taskBranch].completed += 1
        } else if (runs.some((r) => r.state === 'in_progress')) {
          inProgress += 1
        } else {
          pending += 1
        }
      }
    }

    const rate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0
    return {
      assigned,
      completed,
      inProgress,
      pending,
      rate,
      byBranch: Object.values(byBranch).sort((a, b) => b.total - a.total),
    }
  }, [assignments, branch])

  const totalStaff = staff.length
  const activeStaff = staff.filter((member) => member.is_active).length
  const readyRooms = visibleRooms.filter((room) => room.current_status === 'ready').length
  const cleaningRooms = visibleRooms.filter((room) => room.current_status === 'clean_start').length

  const visibleActivity = useMemo(
    () =>
      branch === 'all'
        ? activity
        : activity.filter((entry) => entry.rooms?.branch_id === branch),
    [activity, branch],
  )

  const roomPagination = usePagination(visibleRooms.length, 10, 10)
  const activityPagination = usePagination(visibleActivity.length, 6, 6)

  // Donut SVG math
  const donutRadius = 46
  const donutCircumference = 2 * Math.PI * donutRadius
  const totalTasks = Math.max(taskStats.assigned, 1)
  const completedArc = (taskStats.completed / totalTasks) * donutCircumference
  const inProgressArc = (taskStats.inProgress / totalTasks) * donutCircumference
  const pendingArc = (taskStats.pending / totalTasks) * donutCircumference

  const firstName = profile?.full_name?.split(' ')[0] || 'Admin'

  return (
    <section className="content-page">
      <PageHeader
        eyebrow={formatReadableToday()}
        title={`${greetingForHour()}, ${firstName}`}
        subtitle="Here is what is happening across your work tracks and operations."
        actions={
          <>
            <div className="wt-theme-switch" role="group" aria-label="Date range">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`wt-theme-btn ${dateRange === opt.id ? 'active' : ''}`}
                  style={{ width: 'auto', padding: '0 10px', fontSize: '12px', fontWeight: 600 }}
                  onClick={() => setDateRange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <select
              aria-label="Filter by work track"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            >
              <option value="all">All Work Tracks</option>
              {branches.map((item) => (
                <option key={item.branch_id} value={item.branch_id}>
                  {item.branch_id}
                </option>
              ))}
            </select>
          </>
        }
      />

      {loading ? (
        <div className="page-state-inline">Loading operational metrics...</div>
      ) : error ? (
        <EmptyState
          tone="error"
          title="Could not load dashboard"
          description={error}
          action={
            <button type="button" className="secondary-button" onClick={loadDashboard}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <div className="wt-kpi-grid cols-3">
            <StatCard
              label="Total Staff"
              value={totalStaff}
              sublabel="Registered cleaners"
              tone="primary"
            />
            <StatCard
              label="Active Staff"
              value={activeStaff}
              sublabel={`${Math.max(totalStaff - activeStaff, 0)} inactive`}
              tone="accent"
            />
            <StatCard
              label="Tasks Assigned"
              value={taskStats.assigned}
              sublabel={`In selected range`}
              tone="info"
            />
            <StatCard
              label="Tasks Completed"
              value={taskStats.completed}
              sublabel={`${taskStats.rate}% completion rate`}
              tone="success"
            />
            <StatCard
              label="Pending / Active"
              value={taskStats.pending + taskStats.inProgress}
              sublabel={`${taskStats.inProgress} in progress`}
              tone="warning"
            />
            <StatCard
              label="Rooms Ready"
              value={readyRooms}
              sublabel={`${cleaningRooms} currently cleaning`}
              tone="success"
            />
          </div>

          <div className="wt-analytics-grid">
            <ChartCard
              title="Task Status Distribution"
              subtitle="Real-time breakdown for the selected period"
              action={
                <Link to="/admin/tasks" className="text-button">
                  Manage tasks →
                </Link>
              }
            >
              <div className="wt-donut-wrap">
                <svg width="124" height="124" viewBox="0 0 124 124" aria-label="Task completion chart">
                  <circle
                    cx="62"
                    cy="62"
                    r={donutRadius}
                    fill="none"
                    stroke="var(--color-border-subtle)"
                    strokeWidth="14"
                  />
                  {taskStats.assigned > 0 ? (
                    <>
                      <circle
                        cx="62"
                        cy="62"
                        r={donutRadius}
                        fill="none"
                        stroke="var(--color-success)"
                        strokeWidth="14"
                        strokeDasharray={`${completedArc} ${donutCircumference}`}
                        transform="rotate(-90 62 62)"
                      />
                      <circle
                        cx="62"
                        cy="62"
                        r={donutRadius}
                        fill="none"
                        stroke="var(--color-info)"
                        strokeWidth="14"
                        strokeDasharray={`${inProgressArc} ${donutCircumference}`}
                        strokeDashoffset={-completedArc}
                        transform="rotate(-90 62 62)"
                      />
                      <circle
                        cx="62"
                        cy="62"
                        r={donutRadius}
                        fill="none"
                        stroke="var(--color-warning)"
                        strokeWidth="14"
                        strokeDasharray={`${pendingArc} ${donutCircumference}`}
                        strokeDashoffset={-(completedArc + inProgressArc)}
                        transform="rotate(-90 62 62)"
                      />
                    </>
                  ) : null}
                  <text
                    x="62"
                    y="60"
                    textAnchor="middle"
                    fill="var(--color-text-primary)"
                    fontSize="20"
                    fontWeight="800"
                  >
                    {taskStats.rate}%
                  </text>
                  <text
                    x="62"
                    y="76"
                    textAnchor="middle"
                    fill="var(--color-text-muted)"
                    fontSize="10"
                    fontWeight="600"
                  >
                    DONE
                  </text>
                </svg>

                <div className="wt-legend">
                  <div className="wt-legend-item">
                    <span className="wt-legend-label">
                      <span className="wt-legend-dot" style={{ background: 'var(--color-success)' }} />
                      Completed
                    </span>
                    <strong>{taskStats.completed}</strong>
                  </div>
                  <div className="wt-legend-item">
                    <span className="wt-legend-label">
                      <span className="wt-legend-dot" style={{ background: 'var(--color-info)' }} />
                      In Progress
                    </span>
                    <strong>{taskStats.inProgress}</strong>
                  </div>
                  <div className="wt-legend-item">
                    <span className="wt-legend-label">
                      <span className="wt-legend-dot" style={{ background: 'var(--color-warning)' }} />
                      Pending
                    </span>
                    <strong>{taskStats.pending}</strong>
                  </div>
                </div>
              </div>
            </ChartCard>

            <ChartCard
              title="Work Track Performance"
              subtitle="Completed tasks by branch or work track"
              action={
                <Link to="/admin/rooms" className="text-button">
                  View tracks →
                </Link>
              }
            >
              {taskStats.byBranch.length === 0 ? (
                <EmptyState
                  compact
                  title="No task data in this period"
                  description="Assign templates on Daily Tasks to track completion per location."
                />
              ) : (
                <div className="wt-bar-list">
                  {taskStats.byBranch.slice(0, 5).map((item) => {
                    const pct = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0
                    return (
                      <div className="wt-bar-row" key={item.branch}>
                        <div className="wt-bar-meta">
                          <strong>{item.branch}</strong>
                          <span>
                            {item.completed} / {item.total} ({pct}%)
                          </span>
                        </div>
                        <div className="wt-progress-track">
                          <div className="wt-progress-fill is-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ChartCard>
          </div>

          <div className="dashboard-layout">
            <section className="wt-card">
              <div className="wt-card-header">
                <div>
                  <h3 className="wt-card-title">Live Work Track Status</h3>
                  <p className="wt-card-subtitle">Room readiness across active locations</p>
                </div>
                <Link to="/admin/rooms" className="text-button">
                  All rooms →
                </Link>
              </div>
              {visibleRooms.length === 0 ? (
                <EmptyState compact title="No rooms match this work track." />
              ) : (
                <div className="room-status-grid">
                  {roomPagination.visible(visibleRooms).map((room) => (
                    <article className="room-status-card" key={`${room.branch_id}:${room.room_id}`}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="room-id">Room {room.room_id}</span>
                        <small>Track {room.branch_id}</small>
                      </div>
                      <StatusBadge status={room.current_status || 'none'} />
                    </article>
                  ))}
                </div>
              )}
              <LoadMoreButton
                remaining={roomPagination.remaining}
                onClick={roomPagination.showMore}
              />
            </section>

            <section className="wt-card">
              <div className="wt-card-header">
                <div>
                  <h3 className="wt-card-title">Recent Activity</h3>
                  <p className="wt-card-subtitle">Latest room and status transitions</p>
                </div>
                <Link to="/admin/feed" className="text-button">
                  Media records →
                </Link>
              </div>
              {visibleActivity.length === 0 ? (
                <EmptyState compact title="No recent activity." />
              ) : (
                <ol className="activity-list">
                  {activityPagination.visible(visibleActivity).map((entry) => (
                    <li key={entry.id}>
                      <span className={`status-dot status-${entry.status}`} />
                      <div>
                        <strong>
                          Room {entry.room_id}
                          {entry.rooms?.branch_id ? ` (${entry.rooms.branch_id})` : ''}
                        </strong>
                        <p>{formatDateTime(entry.created_at)}</p>
                      </div>
                      <StatusBadge status={entry.status} showDot={false} />
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
