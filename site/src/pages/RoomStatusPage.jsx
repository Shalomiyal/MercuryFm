import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { db } from '../lib/db'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { formatDateTime, friendlyError } from '../lib/format'

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
  const [rooms, setRooms] = useState([])
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState('all')
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

  async function loadRooms() {
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
  }

  useEffect(() => {
    loadRooms()
  }, [revision])

  const visibleRooms = useMemo(
    () => (branch === 'all' ? rooms : rooms.filter((room) => room.branch_id === branch)),
    [rooms, branch],
  )
  const roomPagination = usePagination(visibleRooms.length, 15, 15)

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
      setFormError(insertError.message)
      return
    }
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

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Room management</p>
          <h2>Admin Room Status &amp; History</h2>
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
        <div className="page-state-inline">Loading rooms...</div>
      ) : error ? (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadRooms}>Retry</button>
        </div>
      ) : visibleRooms.length === 0 ? (
        <div className="empty-state">
          <p>No rooms match this branch.</p>
        </div>
      ) : (
        <div className="room-table-wrap">
          <table className="room-table">
            <thead>
              <tr>
                <th>Room ID</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Status date/time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roomPagination.visible(visibleRooms).map((room) => (
                <tr key={room.room_id}>
                  <td data-label="Room ID"><strong>{room.room_id}</strong></td>
                  <td data-label="Branch">{room.branch_id}</td>
                  <td data-label="Status">
                    <span className={`status-badge status-${room.current_status || 'none'}`}>
                      {statusLabel(room.current_status)}
                    </span>
                  </td>
                  <td data-label="Status date/time">
                    {formatDateTime(room.status_time)}
                  </td>
                  <td data-label="Actions" className="table-actions">
                    <button type="button" className="secondary-button" onClick={() => openUpdate(room)}>Update</button>
                    <button type="button" className="text-button" onClick={() => openHistory(room)}>History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMoreButton
            remaining={roomPagination.remaining}
            onClick={roomPagination.showMore}
          />
        </div>
      )}

      {selectedRoom && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedRoom(null)}>
          <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="update-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Room {selectedRoom.room_id}</p>
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
                <p className="eyebrow">Room {historyRoom.room_id}</p>
                <h2 id="history-title">Status history</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setHistoryRoom(null)}>×</button>
            </div>
            {historyLoading ? (
              <div className="page-state-inline">Loading history...</div>
            ) : historyError ? (
              <div className="empty-state error" role="alert">
                <p>{historyError}</p>
                <button type="button" className="secondary-button" onClick={() => openHistory(historyRoom)}>Retry</button>
              </div>
            ) : history.length === 0 ? (
              <div className="empty-state"><p>No status history yet.</p></div>
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
