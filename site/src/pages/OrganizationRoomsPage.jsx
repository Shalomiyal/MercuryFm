import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { parseRoomsCsv, toRoomsCsv } from '../lib/roomsCsv'
import { downloadRoomsWorkbook, parseRoomsWorkbook } from '../lib/excel'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

function draftKey(orgId) {
  return `mercuryfm:rooms-draft:${orgId || 'unknown'}`
}

function readDraft(orgId) {
  try {
    const raw = window.localStorage.getItem(draftKey(orgId))
    if (!raw) return { exists: false, rows: [] }
    const parsed = JSON.parse(raw)
    const rows = Array.isArray(parsed) ? parsed : parsed?.rows || []
    return {
      exists: true,
      rows: rows.filter((row) => row?.branch_id && row?.room_id),
    }
  } catch {
    return { exists: false, rows: [] }
  }
}

function mergeRows(current, incoming) {
  const seen = new Set(current.map((row) => row.room_id.toLowerCase()))
  const merged = [...current]
  let added = 0
  for (const row of incoming) {
    const roomId = String(row.room_id || '').trim()
    const branchId = String(row.branch_id || '').trim()
    if (!roomId || !branchId) continue
    const key = roomId.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ branch_id: branchId, room_id: roomId })
    added += 1
  }
  return { rows: merged, added }
}

function normalizedRows(rows) {
  return rows
    .map((row) => `${String(row.branch_id).toLowerCase()}|${String(row.room_id).toLowerCase()}`)
    .sort()
    .join('\n')
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function OrganizationRoomsPage() {
  const { profile } = useAuth()
  const { revision } = useDataRefresh()
  const isPlatformAdmin = profile?.role === 'platform_admin'
  const [organizations, setOrganizations] = useState([])
  const [orgId, setOrgId] = useState(() => profile?.org_id || '')
  const [organization, setOrganization] = useState(null)
  const [rows, setRows] = useState(() => readDraft(profile?.org_id).rows)
  const [savedRows, setSavedRows] = useState([])
  const [branchId, setBranchId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [fileName, setFileName] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [success, setSuccess] = useState('')
  const fileRef = useRef(null)

  const branchOptions = useMemo(
    () => [...new Set(rows.map((row) => row.branch_id))].sort(),
    [rows],
  )

  const isDirty = useMemo(
    () => normalizedRows(rows) !== normalizedRows(savedRows),
    [rows, savedRows],
  )

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (row) =>
        row.branch_id.toLowerCase().includes(term) ||
        row.room_id.toLowerCase().includes(term),
    )
  }, [rows, search])
  const rowPagination = usePagination(visibleRows.length, 15, 15)

  async function authorizedFetch(url) {
    const { data: sessionData } = await supabase.auth.getSession()
    return fetch(url, {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token || ''}` },
    })
  }

  async function loadOrganizations() {
    if (!isPlatformAdmin) return
    const { data, error: loadError } = await supabase
      .from('organizations')
      .select('id, name')
      .order('name')
    if (loadError) {
      setError(loadError.message)
      return
    }
    const list = data || []
    setOrganizations(list)
    setOrgId((current) => current || list[0]?.id || '')
  }

  async function loadOrganization(targetId = orgId) {
    setLoading(true)
    setError('')
    setHint('')
    if (!targetId) {
      setOrganization(null)
      setError('Choose an organization.')
      setLoading(false)
      return
    }

    const { data, error: loadError } = await supabase
      .from('organizations')
      .select('id, name, slug, schema_name, is_active, rooms_locked')
      .eq('id', targetId)
      .maybeSingle()
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }
    setOrganization(data)

    const query = isPlatformAdmin ? `?organizationId=${encodeURIComponent(targetId)}` : ''
    const response = await authorizedFetch(`/api/list-rooms${query}`)
    let body
    try {
      body = await response.json()
    } catch {
      body = { error: 'The server returned an invalid response.' }
    }
    if (!response.ok) {
      setError(body.error || 'Could not load rooms.')
      setHint(body.hint || '')
      setLoading(false)
      return
    }

    const draft = readDraft(targetId)
    const dbRows = (body.rooms || []).map((room) => ({
      branch_id: room.branch_id,
      room_id: room.room_id,
    }))
    setSavedRows(dbRows)
    setRows(draft.exists ? draft.rows : dbRows)
    setLoading(false)
  }

  // The auth profile can arrive after this page mounts; adopt its organization once.
  useEffect(() => {
    if (!isPlatformAdmin && profile?.org_id && !orgId) {
      setOrgId(profile.org_id)
    }
  }, [profile?.org_id, isPlatformAdmin, orgId])

  useEffect(() => {
    loadOrganizations()
  }, [isPlatformAdmin])

  useEffect(() => {
    const draft = readDraft(orgId)
    setRows(draft.rows)
    setSavedRows([])
    setSuccess('')
    setFileName('')
    setSearch('')
    if (fileRef.current) fileRef.current.value = ''
    if (orgId) loadOrganization(orgId)
    else {
      setOrganization(null)
      setLoading(false)
    }
  }, [orgId, revision])

  // Draft rows stay on this device until the admin saves them to the database.
  useEffect(() => {
    if (!orgId) return
    try {
      if (isDirty) {
        window.localStorage.setItem(draftKey(orgId), JSON.stringify({ rows }))
      } else {
        window.localStorage.removeItem(draftKey(orgId))
      }
    } catch {
      // Storage may be unavailable/private; the draft still lives in memory.
    }
  }, [rows, orgId, isDirty])

  function clearMessages() {
    setError('')
    setHint('')
    setSuccess('')
  }

  function updateRow(index, field, value) {
    clearMessages()
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    )
  }

  function addRow(event) {
    event.preventDefault()
    clearMessages()
    const nextBranch = branchId.trim()
    const nextRoom = roomId.trim()
    if (!nextBranch || !nextRoom) {
      setError('Enter both a branch ID and a room ID.')
      return
    }
    if (!ID_PATTERN.test(nextBranch) || !ID_PATTERN.test(nextRoom)) {
      setError('Branch and room IDs may contain 1-100 letters, numbers, hyphens, or underscores.')
      return
    }
    if (rows.some((row) => row.room_id.toLowerCase() === nextRoom.toLowerCase())) {
      setError(`Room ${nextRoom} is already in the list.`)
      return
    }
    setRows((current) => [...current, { branch_id: nextBranch, room_id: nextRoom }])
    setRoomId('')
  }

  function removeRow(index) {
    clearMessages()
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  function validateRows(candidate) {
    const invalid = candidate.find(
      (row) => !ID_PATTERN.test(row.branch_id) || !ID_PATTERN.test(row.room_id),
    )
    if (invalid) {
      return 'Branch and room IDs may contain 1-100 letters, numbers, hyphens, or underscores.'
    }
    const roomIds = candidate.map((row) => row.room_id.toLowerCase())
    if (new Set(roomIds).size !== roomIds.length) {
      return 'Room IDs must be unique.'
    }
    return ''
  }

  async function readFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    clearMessages()
    setFileName(file.name)
    try {
      const lowerName = file.name.toLowerCase()
      const parsed = lowerName.endsWith('.xlsx')
        ? (await parseRoomsWorkbook(file)).rows
        : parseRoomsCsv(await file.text())
      if (!parsed.length) {
        setError('No branch_id,room_id rows were found in that file.')
        return
      }
      const invalid = parsed.find(
        (row) => !ID_PATTERN.test(row.branch_id) || !ID_PATTERN.test(row.room_id),
      )
      if (invalid) {
        setError('Branch and room IDs may contain 1-100 letters, numbers, hyphens, or underscores.')
        return
      }
      const { rows: merged, added } = mergeRows(rows, parsed)
      setRows(merged)
      setSuccess(
        added
          ? `Added ${added} room(s) from ${file.name}. Review the list, then save.`
          : `Every room in ${file.name} is already in the list.`,
      )
    } catch (fileError) {
      setError(fileError.message)
    }
  }

  function discardDraft() {
    clearMessages()
    setRows(savedRows)
    setSuccess('Unsaved changes discarded.')
  }

  async function saveRooms(event) {
    event.preventDefault()
    clearMessages()
    if (!orgId) {
      setError('Choose an organization first.')
      return
    }
    if (!rows.length) {
      setError('Add at least one branch and room.')
      return
    }
    const validationError = validateRows(rows)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    const { data: sessionData } = await supabase.auth.getSession()
    const response = await fetch('/api/load-rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token || ''}`,
      },
      body: JSON.stringify({ csv: toRoomsCsv(rows), organizationId: orgId }),
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = { error: 'The server returned an invalid response.' }
    }
    setSaving(false)
    if (!response.ok) {
      setError(body.error || 'Could not save rooms.')
      setHint(body.hint || '')
      return
    }

    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
    setSuccess(`Saved ${body.imported} room(s). You can keep editing here.`)
    await loadOrganization(orgId)
  }

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Room management</p>
          <h2>Branches and rooms</h2>
          <p className="page-subtitle">Edit the room list below, then save it to this organization.</p>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => downloadText('mercuryfm-rooms.csv', toRoomsCsv(rows))}
            disabled={!rows.length}
          >
            Download CSV
          </button>
          <button type="button" className="secondary-button" onClick={downloadRoomsWorkbook}>
            Sample Excel
          </button>
        </div>
      </div>

      {isPlatformAdmin && (
        <label className="org-select">
          <span className="field-label">Organization</span>
          <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
            <option value="">Choose an organization</option>
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      )}

      {organization?.rooms_locked && (
        <div className="notice" role="status">
          Room data has been loaded for this organization before. You can still edit and save the list below.
        </div>
      )}

      {loading ? (
        <div className="page-state-inline">Loading organization...</div>
      ) : !organization ? (
        <div className="empty-state error" role="alert">
          <p>{error || 'Organization not found.'}</p>
          <button type="button" className="secondary-button" onClick={() => loadOrganization()}>Retry</button>
        </div>
      ) : (
        <section className="rooms-workspace">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{organization.schema_name}</p>
              <h3>{organization.name}</h3>
              <p className="field-hint">
                {savedRows.length} saved room(s). {rows.length} in your current list.
              </p>
            </div>
            <div className="toolbar-actions">
              {isDirty && <span className="badge warning">Unsaved changes</span>}
              <button
                type="button"
                className="secondary-button"
                onClick={discardDraft}
                disabled={!isDirty}
              >
                Discard changes
              </button>
            </div>
          </div>

          {success && <div className="success-banner" role="status">{success}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {hint && <p className="upload-help" role="status">{hint}</p>}

          <form className="rooms-form" onSubmit={saveRooms} noValidate>
            <div className="rooms-toolbar">
              <div className="field-grid three">
                <label>
                  <span className="field-label">Branch ID</span>
                  <input
                    list="branch-options"
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    placeholder="e.g. downtown"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span className="field-label">Room ID</span>
                  <input
                    value={roomId}
                    onChange={(event) => setRoomId(event.target.value)}
                    placeholder="e.g. 101"
                    autoComplete="off"
                  />
                </label>
                <button type="button" className="secondary-button add-room-button" onClick={addRow}>
                  + Add room
                </button>
              </div>

              <datalist id="branch-options">
                {branchOptions.map((branch) => (
                  <option key={branch} value={branch} />
                ))}
              </datalist>

              <div className="upload-dropzone">
                <div>
                  <strong>Import a room list</strong>
                  <p className="field-hint">Excel (.xlsx) or CSV with branch_id and room_id columns.</p>
                </div>
                <div className="toolbar-actions">
                  <button type="button" className="text-button" onClick={() => fileRef.current?.click()}>
                    Choose file
                  </button>
                  {fileName && <span className="upload-ready">{fileName}</span>}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={readFile}
                  hidden
                />
              </div>
            </div>

            <div className="rooms-table-head">
              <label className="search-field">
                <span className="sr-only">Search rooms</span>
                <input
                  type="search"
                  placeholder="Search branch or room..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <span className="count-badge">
                {visibleRows.length === rows.length
                  ? `${rows.length} room(s)`
                  : `${visibleRows.length} of ${rows.length} room(s)`}
              </span>
            </div>

            {rows.length ? (
              <div className="room-table-wrap">
                <table className="room-table">
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
                      <th>Branch ID</th>
                      <th>Room ID</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowPagination.visible(visibleRows).map((row, index) => {
                      const originalIndex = rows.indexOf(row)
                      return (
                        <tr key={`${row.branch_id}-${row.room_id}-${originalIndex}`}>
                          <td className="row-number">{index + 1}</td>
                          <td>
                            <input
                              list="branch-options"
                              value={row.branch_id}
                              onChange={(event) => updateRow(originalIndex, 'branch_id', event.target.value)}
                              aria-label={`Branch ID for row ${originalIndex + 1}`}
                            />
                          </td>
                          <td>
                            <input
                              value={row.room_id}
                              onChange={(event) => updateRow(originalIndex, 'room_id', event.target.value)}
                              aria-label={`Room ID for row ${originalIndex + 1}`}
                            />
                          </td>
                          <td className="table-actions">
                            <button
                              type="button"
                              className="text-button danger"
                              onClick={() => removeRow(originalIndex)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {visibleRows.length === 0 && (
                  <p className="upload-help table-empty">No rooms match that search.</p>
                )}
              </div>
            ) : (
              <div className="empty-state compact"><p>No rooms added yet.</p></div>
            )}
            <LoadMoreButton
              remaining={rowPagination.remaining}
              onClick={rowPagination.showMore}
            />

            <div className="save-bar">
              <span className="field-hint">
                {isDirty ? 'You have unsaved changes on this device.' : 'Everything here matches the saved room list.'}
              </span>
              <button type="submit" className="primary-button" disabled={saving || !rows.length}>
                {saving ? 'Saving...' : `Save ${rows.length || ''} room(s) to database`}
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  )
}
