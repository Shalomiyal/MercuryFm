import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import { db, resolveMySchema } from '../lib/db'
import { formatDateTime, friendlyError } from '../lib/format'
import { ROOM_STATUSES, setRoomStatus, statusLabel } from '../lib/rooms'
import {
  compressPhoto,
  generatePhotoThumbnail,
  getImageDimensions,
  uploadRoomStatusMedia,
} from '../lib/media'
import CameraCapture from '../components/ui/CameraCapture'
import DataTable from '../components/ui/DataTable'
import EmptyState from '../components/ui/EmptyState'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'
import { useToast } from '../components/ui/ToastProvider'

const CHECKIN_SLOT_LABELS = ['Photo 1: Bill', 'Photo 2: ID']

export default function RoomStatusPage() {
  const { profile, schemaName } = useAuth()
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

  // New action modal state
  const [actionRoom, setActionRoom] = useState(null)
  const [actionType, setActionType] = useState(null) // 'check_in' | 'check_out' | 'ready'
  const [photos, setPhotos] = useState([])
  const [activeSlot, setActiveSlot] = useState(0)
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [formError, setFormError] = useState('')

  // History modal state
  const [historyRoom, setHistoryRoom] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

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

  function openActionModal(room, type) {
    if (!canManageStatus) {
      setError('Only organization admins and admins can update room status.')
      return
    }
    setActionRoom(room)
    setActionType(type)
    setPhotos([])
    setActiveSlot(0)
    setUploadProgress(0)
    setFormError('')
  }

  function closeActionModal() {
    photos.forEach((p) => {
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
    })
    setActionRoom(null)
    setActionType(null)
    setPhotos([])
    setActiveSlot(0)
    setUploadProgress(0)
    setFormError('')
  }

  async function handlePhotoCapture(slotIndex, file) {
    if (!file) return
    setFormError('')
    try {
      const compressed = await compressPhoto(file)
      const [dims, thumb] = await Promise.all([
        getImageDimensions(compressed),
        generatePhotoThumbnail(compressed),
      ])
      const previewUrl = URL.createObjectURL(compressed)

      setPhotos((prev) => {
        const next = [...prev]
        if (next[slotIndex]?.previewUrl) {
          URL.revokeObjectURL(next[slotIndex].previewUrl)
        }
        next[slotIndex] = {
          file: compressed,
          thumbFile: thumb,
          previewUrl,
          width: dims.width,
          height: dims.height,
        }
        return next
      })

      const requiredCount = actionType === 'check_in' ? 2 : 1
      if (slotIndex + 1 < requiredCount) {
        setActiveSlot(slotIndex + 1)
      }
    } catch (err) {
      setFormError(friendlyError(err))
    }
  }

  function handleRetake(slotIndex) {
    setPhotos((prev) => {
      const next = [...prev]
      if (next[slotIndex]?.previewUrl) {
        URL.revokeObjectURL(next[slotIndex].previewUrl)
      }
      next[slotIndex] = null
      return next
    })
    setActiveSlot(slotIndex)
  }

  async function handleSaveAction(event) {
    event?.preventDefault()
    if (saving) return
    setFormError('')

    const requiredCount = actionType === 'check_in' ? 2 : 1
    const readyPhotos = photos.filter((p) => p?.file)
    if (readyPhotos.length < requiredCount) {
      setFormError(`Please capture all ${requiredCount} required photo(s) before submitting.`)
      return
    }

    setSaving(true)
    setUploadProgress(5)

    try {
      const activeSchema = schemaName || (await resolveMySchema())
      const userId = profile?.id
      let firstMediaId = null

      // Upload each photo to storage & media table
      for (let i = 0; i < requiredCount; i += 1) {
        const photoItem = photos[i]
        const result = await uploadRoomStatusMedia({
          file: photoItem.file,
          thumbFile: photoItem.thumbFile,
          schemaName: activeSchema,
          userId,
          roomId: actionRoom.room_id,
          status: actionType,
          index: i + 1,
          width: photoItem.width,
          height: photoItem.height,
          onProgress: (pct) => {
            const overall = Math.round(((i + pct / 100) / requiredCount) * 90)
            setUploadProgress(Math.min(95, Math.max(5, overall)))
          },
        })
        // Keep the first photo's mediaId to link with the status history row
        if (i === 0 && result?.mediaId) firstMediaId = result.mediaId
      }

      setUploadProgress(95)

      // Update room status — link the first uploaded photo when available
      await setRoomStatus({
        roomId: actionRoom.room_id,
        status: actionType,
        statusTime: new Date().toISOString(),
        profileId: userId,
        mediaId: firstMediaId,
      })

      setUploadProgress(100)
      toast(`Room ${actionRoom.room_id} status updated to ${statusLabel(actionType)}!`, {
        tone: 'success',
      })
      closeActionModal()
      await loadRooms()
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setSaving(false)
    }
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
      render: (room) => {
        const curStatus = room.current_status
        let actionBtn = null

        if (curStatus === 'ready') {
          actionBtn = (
            <button
              type="button"
              className="primary-button"
              onClick={() => openActionModal(room, 'check_in')}
              title="Guest check-in (2 photos required)"
            >
              Check In
            </button>
          )
        } else if (curStatus === 'check_in') {
          actionBtn = (
            <button
              type="button"
              className="secondary-button"
              style={{
                borderColor: 'var(--color-warning, #f59e0b)',
                color: 'var(--color-warning, #f59e0b)',
              }}
              onClick={() => openActionModal(room, 'check_out')}
              title="Client checkout (1 photo required)"
            >
              Check Out
            </button>
          )
        } else if (curStatus === 'check_out') {
          actionBtn = (
            <button
              type="button"
              className="secondary-button"
              disabled
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
              title="Admin access disabled. Waiting for cleaning staff to start cleaning."
            >
              Awaiting Cleaner
            </button>
          )
        } else if (curStatus === 'clean_start') {
          actionBtn = (
            <button
              type="button"
              className="secondary-button"
              disabled
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
              title="Admin access disabled. Cleaning staff is currently cleaning this room."
            >
              Cleaning Active
            </button>
          )
        } else if (curStatus === 'clean_finished') {
          actionBtn = (
            <button
              type="button"
              className="primary-button"
              style={{
                background: 'var(--color-success, #10b981)',
                borderColor: 'var(--color-success, #10b981)',
              }}
              onClick={() => openActionModal(room, 'ready')}
              title="Cleaning finished! Upload 1 photo to certify room is Ready."
            >
              Mark Ready
            </button>
          )
        } else {
          // No status yet
          actionBtn = (
            <button
              type="button"
              className="secondary-button"
              onClick={() => openActionModal(room, 'ready')}
              title="Initialize room to Ready status"
            >
              Mark Ready
            </button>
          )
        }

        return (
          <div
            className="table-actions"
            style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}
          >
            {actionBtn}
            <button
              type="button"
              className="secondary-button"
              onClick={() => openHistory(room)}
            >
              History
            </button>
          </div>
        )
      },
    },
  ]

  const requiredPhotoCount = actionType === 'check_in' ? 2 : 1
  const capturedCount = photos.filter((p) => p?.file).length
  const allPhotosCaptured = capturedCount >= requiredPhotoCount

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
            {ROOM_STATUSES.map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
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

      {/* Action Modal for Check In (2 photos), Check Out (1 photo), Ready (1 photo) */}
      {actionRoom && actionType && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeActionModal}>
          <section
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-modal-title"
            style={{ maxWidth: 560 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{actionRoom.branch_id} · Room {actionRoom.room_id}</p>
                <h2 id="action-modal-title">
                  {actionType === 'check_in' && 'Check In Room'}
                  {actionType === 'check_out' && 'Check Out Room'}
                  {actionType === 'ready' && 'Mark Room Ready'}
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--color-muted)', marginTop: 4 }}>
                  {actionType === 'check_in' && 'Capture 2 photos (Bill and Guest ID) to complete check-in.'}
                  {actionType === 'check_out' && 'Take 1 checkout photo of room condition as client departs.'}
                  {actionType === 'ready' && 'Verify cleaning and upload 1 photo to certify room is ready.'}
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={closeActionModal}>×</button>
            </div>

            <form className="status-form" onSubmit={handleSaveAction} noValidate>
              {/* Photo slots header & counter */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className="field-label" style={{ margin: 0 }}>
                  Required Photos ({capturedCount} of {requiredPhotoCount})
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: allPhotosCaptured ? 'var(--color-success, #10b981)' : 'var(--color-warning, #f59e0b)',
                  }}
                >
                  {allPhotosCaptured ? '✓ All photos ready' : `Capture ${requiredPhotoCount - capturedCount} more`}
                </span>
              </div>

              {/* Slot Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: requiredPhotoCount }).map((_, slotIndex) => {
                  const slotLabel = actionType === 'check_in'
                    ? CHECKIN_SLOT_LABELS[slotIndex]
                    : actionType === 'check_out'
                      ? 'Checkout Condition Photo'
                      : 'Ready Inspection Photo'
                  const capturedPhoto = photos[slotIndex]
                  const isSlotActive = activeSlot === slotIndex

                  return (
                    <div
                      key={`slot-${slotIndex}`}
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md, 8px)',
                        padding: 12,
                        background: isSlotActive ? 'var(--color-surface, #1e2029)' : 'var(--color-surface-subtle, #14161f)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{slotLabel}</span>
                        {capturedPhoto?.file ? (
                          <span style={{ fontSize: '12px', color: 'var(--color-success, #10b981)', fontWeight: 600 }}>
                            ✓ Captured
                          </span>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-muted)' }}>
                            Required
                          </span>
                        )}
                      </div>

                      {capturedPhoto?.file ? (
                        <div className="upload-preview-box">
                          <div className="upload-preview-header" style={{ marginBottom: 8 }}>
                            <span className="upload-ready" style={{ fontSize: '12px' }}>Photo ready to upload</span>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={saving}
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => handleRetake(slotIndex)}
                            >
                              Retake
                            </button>
                          </div>
                          {capturedPhoto.previewUrl && (
                            <img
                              src={capturedPhoto.previewUrl}
                              alt={`Slot ${slotIndex + 1} preview`}
                              className="cleaner-media-img"
                              style={{ maxHeight: 200, width: '100%', objectFit: 'cover', borderRadius: 6 }}
                            />
                          )}
                        </div>
                      ) : isSlotActive ? (
                        <div>
                          <CameraCapture
                            mode="photo"
                            stampLabel={`Room ${actionRoom.room_id} · ${actionType === 'check_in' ? (slotIndex === 0 ? 'Check-in Bill' : 'Check-in ID') : actionType === 'check_out' ? 'Check-out' : 'Ready'}`}
                            disabled={saving}
                            onCapture={(capturedFile) => handlePhotoCapture(slotIndex, capturedFile)}
                          />
                          <p className="upload-help" style={{ marginTop: 6, textAlign: 'center' }}>
                            Take a live photo using your camera. Gallery uploads are disabled.
                          </p>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '12px 0' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: '13px' }}
                            onClick={() => setActiveSlot(slotIndex)}
                          >
                            📷 Take {slotLabel}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {formError && <p className="form-error" role="alert">{formError}</p>}

              {saving && uploadProgress > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: 4 }}>
                    <span>Processing & uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--color-primary, #6366f1)', transition: 'width 0.2s' }} />
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="secondary-button" disabled={saving} onClick={closeActionModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!allPhotosCaptured || saving}
                >
                  {saving
                    ? 'Saving...'
                    : actionType === 'check_in'
                      ? 'Complete Check-In'
                      : actionType === 'check_out'
                        ? 'Complete Check-Out'
                        : 'Confirm Room Ready'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* History Modal */}
      {historyRoom && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHistoryRoom(null)}>
          <section
            className="modal-sheet history-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
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
