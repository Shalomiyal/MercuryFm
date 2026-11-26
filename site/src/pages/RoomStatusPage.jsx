import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import { db } from '../lib/db'
import { formatDateTime, friendlyError } from '../lib/format'
import DataTable from '../components/ui/DataTable'
import EmptyState from '../components/ui/EmptyState'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'
import { useToast } from '../components/ui/ToastProvider'

const STATUSES = [
  ['check_in', 'Check in'],
  ['check_out', 'Check out'],
  ['clean_start', 'Clean start'],
  ['clean_finished', 'Clean finished'],
  ['ready', 'Ready'],
]

function statusLabel(status) {
  return STATUSES.find(([value]) => value === status)?.[1] || status || 'No status'
}

function localDateTime(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function RoomStatusPage() {
  const { profile } = useAuth()
  const { revision } = useDataRefresh()
  const { toast } = useToast()
  const [rooms, setRooms] = useState([])
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('room_id')
  const [sortDir, setSortDir] = useState('asc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [historyRoom, setHistoryRoom] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [status, setStatus] = useState('ready')
  const [statusDateTime, setStatusDateTime] = useState(localDateTime())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const canManageStatus =
    profile?.role === 'org_admin' || profile?.role === 'admin'

  const loadRooms = useCallback(async () => {
    setLoading(true)
    setError('')
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setError(tenantError.message)
      setRooms([])
      setBranches([])
      setLoading(false)
      return
    }
    const [{ data: branchData, error: branchError }, { data: roomData, error: roomError }] =
      await Promise.all([
        orgDb.from('branches').select('branch_id').order('branch_id'),
        orgDb
          .from('rooms')
          .select('room_id, branch_id, current_status, status_time, updated_at')
          .order('room_id'),
      ])
    if (branchError || roomError) {
      setError(friendlyError(branchError || roomError || new Error('Could not load rooms.')))
      setRooms([])
      setBranches([])
    } else {
      setBranches(branchData || [])
      setRooms(roomData || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadRooms()
  }, [loadRooms, revision])

  const visibleRooms = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = rooms.filter((room) => {
      if (branch !== 'all' && room.branch_id !== branch) return false
      if (statusFilter !== 'all' && (room.current_status || 'none') !== statusFilter) return false
      if (term) {
        const hay = `${room.room_id} ${room.branch_id} ${room.current_status || ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    return [...filtered].sort((a, b) => {
      const valA = String(a[sortBy] || '')
      const valB = String(b[sortBy] || '')
      const cmp = valA.localeCompare(valB, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rooms, branch, statusFilter, search, sortBy, sortDir])

  const roomPagination = usePagination(visibleRooms.length, 15, 15)

  function handleSort(columnKey) {
    if (sortBy === columnKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(columnKey)
      setSortDir('asc')
    }
  }

  function openUpdate(room) {
    if (!canManageStatus) {
      setError('Only organization admins and admins can update room status.')
      return
    }
    setSelectedRoom(room)
    setStatus(room.current_status || 'ready')
    setStatusDateTime(localDateTime())
    setFormError('')
  }

  async function saveStatus(event) {
    event.preventDefault()
    setFormError('')
    if (!profile?.id) {
      setFormError('Your account profile could not be loaded.')
      return
    }
    if (!selectedRoom || !status || !statusDateTime) {
      setFormError('Choose a status and date/time.')
      return
    }

    setSaving(true)
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setSaving(false)
      setFormError(tenantError.message)
      return
    }
    const { error: insertError } = await orgDb
      .from('room_status_history')
      .insert({
        room_id: selectedRoom.room_id,
        status,
        status_time: new Date(statusDateTime).toISOString(),
        created_by: profile.id,
      })
    setSaving(false)

    if (insertError) {
      const isCreatedByFk =
        insertError.message &&
        /foreign key/.test(insertError.message) &&
        /created_by/i.test(insertError.message)
      if (isCreatedByFk) {
        setSaving(true)
        const { error: retryError } = await orgDb
          .from('room_status_history')
          .insert({
            room_id: selectedRoom.room_id,
            status,
            status_time: new Date(statusDateTime).toISOString(),
            created_by: null,
          })
        setSaving(false)
        if (retryError) {
          setFormError(retryError.message)
          return
        }
        toast(`Room ${selectedRoom.room_id} updated to ${statusLabel(status)}`, { tone: 'success' })
        setSelectedRoom(null)
        await loadRooms()
        return
      }
      setFormError(insertError.message)
      return
    }
    toast(`Room ${selectedRoom.room_id} updated to ${statusLabel(status)}`, { tone: 'success' })
    setSelectedRoom(null)
    await loadRooms()
  }

  async function openHistory(room) {
    setHistoryRoom(room)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setHistoryError(tenantError.message)
      setHistoryLoading(false)
      return
    }
    const { data, error: historyLoadError } = await orgDb
      .from('room_status_history')
      .select('id, status, status_time, created_at')
      .eq('room_id', room.room_id)
      .order('created_at', { ascending: false })
    if (historyLoadError) {
      setHistoryError(historyLoadError.message)
    } else {
      setHistory(data || [])
    }
    setHistoryLoading(false)
  }

  const readyCount = rooms.filter((r) => r.current_status === 'ready').length
  const cleaningCount = rooms.filter((r) => r.current_status === 'clean_start').length
  const checkoutCount = rooms.filter((r) => r.current_status === 'check_out').length

  const columns = [
    {
      key: 'room_id',
      label: 'Room / Unit',
      sortable: true,
      render: (room) => <strong>{room.room_id}</strong>,
    },
    {
      key: 'branch_id',
      label: 'Work Track',
      sortable: true,
      render: (room) => room.branch_id,
    },
    {
      key: 'current_status',
      label: 'Status',
      sortable: true,
      render: (room) => (
        <StatusBadge
          status={room.current_status || 'none'}
          label={statusLabel(room.current_status)}
        />
      ),
    },
    {
      key: 'status_time',
      label: 'Last Updated',
      sortable: true,
      render: (room) => formatDateTime(room.status_time),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (room) => (
        <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary-button" onClick={() => openUpdate(room)}>
            Update
          </button>
          <button type="button" className="text-button" onClick={() => openHistory(room)}>
            History
          </button>
        </div>
      ),
    },
  ]

  return (
    <section className="content-page">
      <PageHeader
        eyebrow="Work Track Operations"
        title="Work Tracks & Room Status"
        subtitle="Monitor live room readiness, cleaning progress, and status audit history by track."
      />

      <div className="wt-kpi-grid">
        <StatCard label="Total Units" value={rooms.length} sublabel={`${branches.length} work tracks`} tone="primary" />
        <StatCard label="Ready" value={readyCount} sublabel="Cleared for occupancy" tone="success" />
        <StatCard label="Cleaning Active" value={cleaningCount} sublabel="In progress now" tone="warning" />
        <StatCard label="Needs Attention" value={checkoutCount} sublabel="Checked out" tone="info" />
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <label className="search-field">
          <span className="sr-only">Search rooms</span>
          <input
            type="search"
            placeholder="Search room or work track..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="toolbar-actions">
          <select aria-label="Work track filter" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="all">All Work Tracks</option>
            {branches.map((item) => (
              <option key={item.branch_id} value={item.branch_id}>{item.branch_id}</option>
            ))}
          </select>
          <select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All Statuses</option>
            {STATUSES.map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
            <option value="none">No Status</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="page-state-inline">Loading work tracks...</div>
      ) : error ? (
        <EmptyState
          tone="error"
          title="Could not load work tracks"
          description={error}
          action={<button type="button" className="secondary-button" onClick={loadRooms}>Retry</button>}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={roomPagination.visible(visibleRooms)}
            rowKey={(room) => `${room.branch_id}:${room.room_id}`}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            emptyTitle="No rooms match your filters"
            emptyDescription="Try clearing the search query or selecting All Work Tracks."
          />
          <LoadMoreButton
            remaining={roomPagination.remaining}
            onClick={roomPagination.showMore}
          />
        </>
      )}

      {selectedRoom && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedRoom(null)}>
          <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="update-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{selectedRoom.branch_id} · Room {selectedRoom.room_id}</p>
                <h2 id="update-title">Update status</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedRoom(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={saveStatus} noValidate>
              <label htmlFor="room-status">Status</label>
              <select id="room-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label htmlFor="status-time">Status date and time</label>
              <input
                id="status-time"
                type="datetime-local"
                value={statusDateTime}
                onChange={(event) => setStatusDateTime(event.target.value)}
              />
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setSelectedRoom(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save status'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {historyRoom && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHistoryRoom(null)}>
          <section className="modal-sheet history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{historyRoom.branch_id} · Room {historyRoom.room_id}</p>
                <h2 id="history-title">Status history</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setHistoryRoom(null)}>×</button>
            </div>
            {historyLoading ? (
              <div className="page-state-inline">Loading history...</div>
            ) : historyError ? (
              <EmptyState
                tone="error"
                title="Could not load history"
                description={historyError}
                action={<button type="button" className="secondary-button" onClick={() => openHistory(historyRoom)}>Retry</button>}
              />
            ) : history.length === 0 ? (
              <EmptyState compact title="No status history yet." />
            ) : (
              <ol className="history-list">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <span className={`status-dot status-${entry.status}`} />
                    <div>
                      <strong>{statusLabel(entry.status)}</strong>
                      <p>Entered: {formatDateTime(entry.status_time)}</p>
                      <small>Saved: {formatDateTime(entry.created_at)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
