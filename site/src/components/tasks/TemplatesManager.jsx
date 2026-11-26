import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../../lib/db'
import { useDataRefresh } from '../../contexts/DataRefreshContext'
import { useConfirm } from '../ui/ConfirmProvider'
import {
  downloadTaskWorkbook,
  parseTaskWorkbook,
} from '../../lib/excel'

// Reserved field names used to store branch/room defaults inside task_fields.
// They are stripped from the visible "custom fields" list in the UI.
const FIELD_BRANCH = '__branch__'
const FIELD_ROOM   = '__room__'

const NEW_TASK_SELECT =
  'id, name, description, template_tasks(id, task_name, start_by, finish_by, sort_order, task_fields(id, field_name, default_value, sort_order))'
const LEGACY_TASK_SELECT =
  'id, name, description, template_tasks(id, task_name, finish_by, sort_order)'

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('start_by') || message.includes('task_fields')
}

// Pull the reserved branch/room values out of the task_fields array
function extractBranchRoom(fields = []) {
  const branch = fields.find((f) => f.field_name === FIELD_BRANCH)?.default_value || ''
  const room   = fields.find((f) => f.field_name === FIELD_ROOM)?.default_value   || ''
  return { branch, room }
}

// Visible custom fields — exclude the reserved ones
function visibleFields(fields = []) {
  return fields.filter((f) => f.field_name !== FIELD_BRANCH && f.field_name !== FIELD_ROOM)
}

function emptyTask() {
  return { task_name: '', start_by: '', finish_by: '', branch: '', room: '', fields: [] }
}

function emptyDraft() {
  return { name: '', description: '', tasks: [emptyTask()] }
}

function sortedTasks(template) {
  return [...(template.template_tasks || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
  )
}

export default function TemplatesManager({ embedded = false, onTemplatesChanged }) {
  const { revision } = useDataRefresh()
  const confirm = useConfirm()
  const [templates, setTemplates]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [draft, setDraft]           = useState(null)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')
  const [schemaReady, setSchemaReady] = useState(true)
  const [search, setSearch]         = useState('')
  const [importInfo, setImportInfo] = useState(null)
  const [importing, setImporting]   = useState(false)
  const fileRef = useRef(null)

  // Branch / room lookup data for dropdowns (loaded from existing tables — no SQL needed)
  const [branches, setBranches] = useState([])
  const [rooms, setRooms]       = useState([])

  async function loadTemplates() {
    setLoading(true)
    setError('')
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setError(tenantError.message)
      setTemplates([])
      setLoading(false)
      return
    }

    // Load branches and rooms for dropdowns — non-fatal if tables don't exist yet
    const [branchResult, roomResult] = await Promise.all([
      orgDb.from('branches').select('branch_id').order('branch_id'),
      orgDb.from('rooms').select('room_id, branch_id').order('branch_id').order('room_id'),
    ])
    if (!branchResult.error) setBranches(branchResult.data || [])
    if (!roomResult.error)   setRooms(roomResult.data || [])

    let result = await orgDb.from('task_templates').select(NEW_TASK_SELECT).order('name')
    if (result.error && isSchemaError(result.error)) {
      setSchemaReady(false)
      result = await orgDb.from('task_templates').select(LEGACY_TASK_SELECT).order('name')
    } else {
      setSchemaReady(true)
    }

    if (result.error) setError(result.error.message)
    else setTemplates(result.data || [])
    setLoading(false)
  }

  useEffect(() => { loadTemplates() }, [revision])

  const visibleTemplates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return templates
    return templates.filter((t) =>
      t.name.toLowerCase().includes(term) ||
      String(t.description || '').toLowerCase().includes(term) ||
      sortedTasks(t).some((task) => task.task_name.toLowerCase().includes(term)),
    )
  }, [templates, search])

  function openCreate() {
    setDraft(emptyDraft())
    setFormError('')
    setImportInfo(null)
  }

  function openEdit(template) {
    setDraft({
      id: template.id,
      name: template.name,
      description: template.description || '',
      tasks: sortedTasks(template).map((task) => {
        const allFields = [...(task.task_fields || [])]
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        const { branch, room } = extractBranchRoom(allFields)
        return {
          id: task.id,
          task_name: task.task_name,
          start_by: task.start_by || '',
          finish_by: task.finish_by,
          branch,
          room,
          fields: visibleFields(allFields).map((f) => ({
            id: f.id,
            field_name: f.field_name,
            default_value: f.default_value || '',
          })),
        }
      }),
    })
    setFormError('')
    setImportInfo(null)
  }

  function updateDraft(field, value) {
    setDraft((c) => ({ ...c, [field]: value }))
  }

  function updateTask(index, field, value) {
    setDraft((c) => ({
      ...c,
      tasks: c.tasks.map((t, i) => i === index ? { ...t, [field]: value } : t),
    }))
  }

  function addTask() {
    setDraft((c) => ({ ...c, tasks: [...c.tasks, emptyTask()] }))
  }

  function removeTask(index) {
    setDraft((c) => ({ ...c, tasks: c.tasks.filter((_, i) => i !== index) }))
  }

  function addField(taskIndex) {
    setDraft((c) => ({
      ...c,
      tasks: c.tasks.map((t, i) =>
        i === taskIndex ? { ...t, fields: [...t.fields, { field_name: '', default_value: '' }] } : t,
      ),
    }))
  }

  function updateField(taskIndex, fieldIndex, key, value) {
    setDraft((c) => ({
      ...c,
      tasks: c.tasks.map((t, i) =>
        i === taskIndex
          ? { ...t, fields: t.fields.map((f, fi) => fi === fieldIndex ? { ...f, [key]: value } : f) }
          : t,
      ),
    }))
  }

  function removeField(taskIndex, fieldIndex) {
    setDraft((c) => ({
      ...c,
      tasks: c.tasks.map((t, i) =>
        i === taskIndex ? { ...t, fields: t.fields.filter((_, fi) => fi !== fieldIndex) } : t,
      ),
    }))
  }

  async function importExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFormError('')
    if (!schemaReady) {
      setFormError('Run supabase/task-fields-and-start-times.sql before importing Excel sheets.')
      return
    }
    setImporting(true)
    try {
      const imported = await parseTaskWorkbook(file)
      const tasks = imported.tasks.map((task) => ({
        task_name: task.task_name,
        start_by: task.start_by,
        finish_by: task.finish_by,
        branch: '',
        room: '',
        fields: task.fields.map((f) => ({ field_name: f.field_name, default_value: f.default_value })),
      }))
      setDraft((c) => ({
        ...(c || emptyDraft()),
        name: c?.name || file.name.replace(/\.[^.]+$/, ''),
        description: c?.description || `Imported from ${imported.sheetName}`,
        tasks,
      }))
      setImportInfo({
        fileName: file.name,
        sheetName: imported.sheetName,
        count: tasks.length,
        columns: imported.customColumns,
        issues: imported.issues,
      })
      if (imported.issues.length) setFormError(imported.issues.slice(0, 3).join(' '))
    } catch (err) {
      setFormError(err.message)
    } finally {
      setImporting(false)
    }
  }

  function validateDraft() {
    if (!draft.name.trim()) return 'Template name is required.'
    if (!draft.tasks.length) return 'Add at least one task.'
    for (const [i, task] of draft.tasks.entries()) {
      if (!task.task_name.trim()) return `Task ${i + 1} needs a name.`
      if (!task.finish_by) return `Task ${i + 1} needs a finish time.`
      if (schemaReady && task.start_by && task.start_by > task.finish_by)
        return `Task ${i + 1} starts after it finishes.`
      if (schemaReady) {
        const rawNames = task.fields.map((f) => f.field_name.trim())
        if (rawNames.some((n) => !n)) return `Task ${i + 1} has an unnamed custom field.`
        const names = rawNames.map((n) => n.toLowerCase())
        if (new Set(names).size !== names.length) return `Task ${i + 1} has duplicate custom field names.`
      }
    }
    return ''
  }

  async function submitTemplate(event) {
    event.preventDefault()
    const validationError = validateDraft()
    setFormError(validationError)
    if (validationError) return

    setSaving(true)
    try {
      const orgDb = await db()
      let templateId = draft.id
      if (templateId) {
        const { error: updateError } = await orgDb
          .from('task_templates')
          .update({ name: draft.name.trim(), description: draft.description.trim() || null })
          .eq('id', templateId)
        if (updateError) throw updateError
        const { error: deleteError } = await orgDb
          .from('template_tasks').delete().eq('template_id', templateId)
        if (deleteError) throw deleteError
      } else {
        const { data, error: insertError } = await orgDb
          .from('task_templates')
          .insert({ name: draft.name.trim(), description: draft.description.trim() || null })
          .select('id').single()
        if (insertError) throw insertError
        templateId = data.id
      }

      const taskRows = draft.tasks.map((task, i) => ({
        template_id: templateId,
        task_name: task.task_name.trim(),
        finish_by: task.finish_by,
        sort_order: i,
        ...(schemaReady ? { start_by: task.start_by || null } : {}),
      }))
      const { data: insertedTasks, error: taskError } = await orgDb
        .from('template_tasks').insert(taskRows).select('id, sort_order')
      if (taskError) throw taskError

      if (schemaReady) {
        // Build field rows: branch/room as reserved fields + user custom fields
        const fieldRows = (insertedTasks || []).flatMap((inserted) => {
          const source = draft.tasks[inserted.sort_order]
          if (!source) return []
          const rows = []
          let sortOrder = 0
          // Reserved branch field
          if (source.branch) {
            rows.push({ task_id: inserted.id, field_name: FIELD_BRANCH, default_value: source.branch, sort_order: sortOrder++ })
          }
          // Reserved room field
          if (source.room) {
            rows.push({ task_id: inserted.id, field_name: FIELD_ROOM, default_value: source.room, sort_order: sortOrder++ })
          }
          // User-defined custom fields
          source.fields
            .filter((f) => f.field_name.trim())
            .forEach((f) => {
              rows.push({
                task_id: inserted.id,
                field_name: f.field_name.trim(),
                default_value: f.default_value.trim() || null,
                sort_order: sortOrder++,
              })
            })
          return rows
        })
        if (fieldRows.length) {
          const { error: fieldError } = await orgDb.from('task_fields').insert(fieldRows)
          if (fieldError) throw fieldError
        }
      }

      setDraft(null)
      setImportInfo(null)
      await loadTemplates()
      await onTemplatesChanged?.()
    } catch (saveError) {
      setFormError(saveError?.message || 'Unable to save template.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate(template) {
    const accepted = await confirm(`Delete "${template.name}"?`, {
      title: 'Delete template',
      confirmLabel: 'Delete template',
    })
    if (!accepted) return
    setError('')
    try {
      const orgDb = await db()
      const { error: deleteError } = await orgDb
        .from('task_templates').delete().eq('id', template.id)
      if (deleteError) setError(deleteError.message)
      else {
        await loadTemplates()
        await onTemplatesChanged?.()
      }
    } catch (err) {
      setError(err?.message || 'Unable to delete template.')
    }
  }

  const Wrapper = embedded ? 'div' : 'section'
  const wrapperClass = embedded ? 'templates-manager' : 'content-page'

  return (
    <Wrapper className={wrapperClass}>
      <div className={embedded ? 'templates-manager-header' : 'page-heading'}>
        <div>
          <p className="eyebrow">Reusable task lists</p>
          {embedded ? <h3>Templates</h3> : <h2>Templates</h2>}
          <p className="page-subtitle">Build a task list once, then assign it to cleaners by date.</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="secondary-button" onClick={downloadTaskWorkbook}>
            Sample Excel
          </button>
          <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={importing || !schemaReady}>
            {importing ? 'Reading...' : 'Import Excel'}
          </button>
          <button type="button" className="primary-button page-button" onClick={openCreate}>
            New template
          </button>
          <input ref={fileRef} type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={importExcel} hidden />
        </div>
      </div>

      {!schemaReady && (
        <div className="notice warning" role="status">
          Run <code>supabase/task-fields-and-start-times.sql</code> in the Supabase SQL Editor to enable
          start times, Excel import, and custom task fields.
        </div>
      )}

      {error && (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadTemplates}>Retry</button>
        </div>
      )}

      {!error && templates.length > 0 && (
        <div className="toolbar">
          <label className="search-field">
            <span className="sr-only">Search templates</span>
            <input type="search" placeholder="Search templates or tasks..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <span className="count-badge">{visibleTemplates.length} of {templates.length} templates</span>
        </div>
      )}

      {loading ? (
        <div className="page-state-inline">Loading templates...</div>
      ) : !error && templates.length === 0 ? (
        <div className="empty-state">
          <p>No templates yet.</p>
          <button type="button" className="secondary-button" onClick={openCreate}>Create template</button>
        </div>
      ) : !error && visibleTemplates.length === 0 ? (
        <div className="empty-state"><p>No templates match that search.</p></div>
      ) : !error ? (
        <div className="template-grid">
          {visibleTemplates.map((template) => {
            const tasks = sortedTasks(template)
            return (
              <article className="template-card" key={template.id}>
                <div className="template-card-heading">
                  <div>
                    <h3>{template.name}</h3>
                    {template.description && <p>{template.description}</p>}
                  </div>
                  <span className="count-badge">{tasks.length} tasks</span>
                </div>
                <ol className="template-summary">
                  {tasks.map((task) => {
                    const allFields = task.task_fields || []
                    const { branch, room } = extractBranchRoom(allFields)
                    const customFields = visibleFields(allFields)
                    return (
                      <li key={task.id}>
                        <div className="template-summary-main">
                          <span>{task.task_name}</span>
                          <time>
                            {task.start_by ? `${task.start_by} – ${task.finish_by}` : task.finish_by}
                          </time>
                        </div>
                        {(branch || room) && (
                          <div className="field-chips" style={{ marginTop: 4 }}>
                            {branch && <span className="field-chip">📍 {branch}</span>}
                            {room   && <span className="field-chip">🚪 {room}</span>}
                          </div>
                        )}
                        {schemaReady && customFields.length > 0 && (
                          <div className="field-chips">
                            {customFields.map((f) => (
                              <span className="field-chip" key={f.id}>{f.field_name}</span>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
                <div className="card-actions">
                  <button type="button" className="secondary-button" onClick={() => openEdit(template)}>Edit</button>
                  <button type="button" className="text-button danger" onClick={() => deleteTemplate(template)}>Delete</button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDraft(null)}>
          <section className="modal-sheet template-sheet" role="dialog" aria-modal="true"
            aria-labelledby="template-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{draft.id ? 'Edit' : 'Create'} template</p>
                <h2 id="template-title">Template details</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDraft(null)}>×</button>
            </div>

            {importInfo && (
              <div className="notice success" role="status">
                Imported {importInfo.count} task(s) from <strong>{importInfo.fileName}</strong>
                {importInfo.columns.length > 0 && ` with custom column(s): ${importInfo.columns.join(', ')}`}.
              </div>
            )}

            <form className="status-form" onSubmit={submitTemplate} noValidate>
              <div className="field-grid two">
                <label>
                  <span className="field-label">Template name</span>
                  <input value={draft.name} onChange={(e) => updateDraft('name', e.target.value)} />
                </label>
                <label>
                  <span className="field-label">Description (optional)</span>
                  <input value={draft.description} onChange={(e) => updateDraft('description', e.target.value)} />
                </label>
              </div>

              <div className="template-task-toolbar">
                <div>
                  <h3>Tasks</h3>
                  <p className="field-hint">Each task has a name, times, optional branch/room, and custom fields.</p>
                </div>
                <div className="toolbar-actions">
                  <button type="button" className="text-button" onClick={downloadTaskWorkbook}>Sample Excel</button>
                  <button type="button" className="text-button" onClick={() => fileRef.current?.click()} disabled={!schemaReady}>Import Excel</button>
                  <button type="button" className="secondary-button" onClick={addTask}>+ Add task</button>
                </div>
              </div>

              {draft.tasks.length === 0 ? (
                <div className="empty-state compact"><p>Add at least one task.</p></div>
              ) : (
                <div className="template-task-list">
                  {draft.tasks.map((task, index) => (
                    <article className="template-task-card" key={task.id || `new-${index}`}>
                      <span className="task-number">{index + 1}</span>
                      <div className="template-task-main">

                        {/* Row 1: name + times */}
                        <div className="field-grid three">
                          <label>
                            <span className="field-label">Task name</span>
                            <input placeholder="e.g. Clean bathroom"
                              value={task.task_name}
                              onChange={(e) => updateTask(index, 'task_name', e.target.value)} />
                          </label>
                          {schemaReady && (
                            <label>
                              <span className="field-label">Start time</span>
                              <input type="time" value={task.start_by}
                                onChange={(e) => updateTask(index, 'start_by', e.target.value)} />
                            </label>
                          )}
                          <label>
                            <span className="field-label">Finish time</span>
                            <input type="time" value={task.finish_by}
                              onChange={(e) => updateTask(index, 'finish_by', e.target.value)} />
                          </label>
                        </div>

                        {/* Row 2: branch + room (always shown when org has rooms, independent of schema version) */}
                        {branches.length > 0 && (
                          <div className="field-grid two" style={{ marginTop: 10 }}>
                            <label>
                              <span className="field-label">Branch (optional)</span>
                              <select value={task.branch}
                                onChange={(e) => {
                                  const val = e.target.value
                                  updateTask(index, 'branch', val)
                                  // Clear room if it no longer belongs to this branch
                                  if (val && task.room) {
                                    const stillValid = rooms.some(
                                      (r) => r.room_id === task.room && r.branch_id === val
                                    )
                                    if (!stillValid) updateTask(index, 'room', '')
                                  }
                                }}>
                                <option value="">— None —</option>
                                {branches.map((b) => (
                                  <option key={b.branch_id} value={b.branch_id}>{b.branch_id}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="field-label">Room (optional)</span>
                              <select value={task.room}
                                onChange={(e) => updateTask(index, 'room', e.target.value)}>
                                <option value="">— None —</option>
                                {rooms
                                  .filter((r) => !task.branch || r.branch_id === task.branch)
                                  .map((r) => (
                                    <option key={r.room_id} value={r.room_id}>
                                      {r.room_id}{r.branch_id && !task.branch ? ` (${r.branch_id})` : ''}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </div>
                        )}

                        {/* Row 3: custom fields */}
                        {schemaReady && (
                          <div className="task-custom-fields">
                            <div className="field-list-heading">
                              <span className="field-label">Custom fields</span>
                              <button type="button" className="text-button" onClick={() => addField(index)}>+ Add field</button>
                            </div>
                            {task.fields.length === 0 ? (
                              <p className="field-hint">Need extra information for this task? Add a named field.</p>
                            ) : (
                              <div className="custom-field-list">
                                {task.fields.map((field, fi) => (
                                  <div className="custom-field-row" key={field.id || `new-${fi}`}>
                                    <input
                                      aria-label={`Field ${fi + 1} name for task ${index + 1}`}
                                      placeholder="Field name (e.g. Room notes)"
                                      value={field.field_name}
                                      onChange={(e) => updateField(index, fi, 'field_name', e.target.value)} />
                                    <input
                                      aria-label={`Default value for ${field.field_name || `field ${fi + 1}`}`}
                                      placeholder="Default value (optional)"
                                      value={field.default_value}
                                      onChange={(e) => updateField(index, fi, 'default_value', e.target.value)} />
                                    <button type="button" className="text-button danger"
                                      onClick={() => removeField(index, fi)}>Remove</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <button type="button" className="icon-button danger"
                        aria-label={`Remove task ${index + 1}`} onClick={() => removeTask(index)}>×</button>
                    </article>
                  ))}
                </div>
              )}

              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? 'Saving...' : 'Save template'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </Wrapper>
  )
}
