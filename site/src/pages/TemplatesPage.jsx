import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../lib/db'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { useConfirm } from '../components/ui/ConfirmProvider'
import {
  downloadTaskWorkbook,
  parseTaskWorkbook,
} from '../lib/excel'

const NEW_TASK_SELECT =
  'id, name, description, template_tasks(id, task_name, start_by, finish_by, sort_order, task_fields(id, field_name, default_value, sort_order))'
const LEGACY_TASK_SELECT =
  'id, name, description, template_tasks(id, task_name, finish_by, sort_order)'

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('start_by') || message.includes('task_fields')
}

function emptyTask(startBy = '', finishBy = '') {
  return { task_name: '', start_by: startBy, finish_by: finishBy, fields: [] }
}

function emptyDraft() {
  return { name: '', description: '', tasks: [emptyTask()] }
}

function sortedTasks(template) {
  return [...(template.template_tasks || [])].sort(
    (left, right) => (left.sort_order || 0) - (right.sort_order || 0),
  )
}

export default function TemplatesPage() {
  const { revision } = useDataRefresh()
  const confirm = useConfirm()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [schemaReady, setSchemaReady] = useState(true)
  const [search, setSearch] = useState('')
  const [importInfo, setImportInfo] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

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

  useEffect(() => {
    loadTemplates()
  }, [revision])

  const visibleTemplates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return templates
    return templates.filter((template) =>
      template.name.toLowerCase().includes(term) ||
      String(template.description || '').toLowerCase().includes(term) ||
      sortedTasks(template).some((task) => task.task_name.toLowerCase().includes(term)),
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
      tasks: sortedTasks(template).map((task) => ({
        id: task.id,
        task_name: task.task_name,
        start_by: task.start_by || '',
        finish_by: task.finish_by,
        fields: [...(task.task_fields || [])]
          .sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
          .map((field) => ({
            id: field.id,
            field_name: field.field_name,
            default_value: field.default_value || '',
          })),
      })),
    })
    setFormError('')
    setImportInfo(null)
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateTask(index, field, value) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, [field]: value } : task,
      ),
    }))
  }

  function addTask() {
    setDraft((current) => ({
      ...current,
      tasks: [...current.tasks, emptyTask()],
    }))
  }

  function removeTask(index) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.filter((_, taskIndex) => taskIndex !== index),
    }))
  }

  function addField(taskIndex) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task, index) =>
        index === taskIndex
          ? { ...task, fields: [...task.fields, { field_name: '', default_value: '' }] }
          : task,
      ),
    }))
  }

  function updateField(taskIndex, fieldIndex, field, value) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task, index) =>
        index === taskIndex
          ? {
              ...task,
              fields: task.fields.map((item, itemIndex) =>
                itemIndex === fieldIndex ? { ...item, [field]: value } : item,
              ),
            }
          : task,
      ),
    }))
  }

  function removeField(taskIndex, fieldIndex) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task, index) =>
        index === taskIndex
          ? { ...task, fields: task.fields.filter((_, itemIndex) => itemIndex !== fieldIndex) }
          : task,
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
        fields: task.fields.map((field) => ({
          field_name: field.field_name,
          default_value: field.default_value,
        })),
      }))
      setDraft((current) => ({
        ...(current || emptyDraft()),
        name: current?.name || file.name.replace(/\.[^.]+$/, ''),
        description: current?.description || `Imported from ${imported.sheetName}`,
        tasks,
      }))
      setImportInfo({
        fileName: file.name,
        sheetName: imported.sheetName,
        count: tasks.length,
        columns: imported.customColumns,
        issues: imported.issues,
      })
      if (imported.issues.length) {
        setFormError(imported.issues.slice(0, 3).join(' '))
      }
    } catch (importError) {
      setFormError(importError.message)
    } finally {
      setImporting(false)
    }
  }

  function validateDraft() {
    if (!draft.name.trim()) return 'Template name is required.'
    if (!draft.tasks.length) return 'Add at least one task.'
    for (const [index, task] of draft.tasks.entries()) {
      if (!task.task_name.trim()) return `Task ${index + 1} needs a name.`
      if (!task.finish_by) return `Task ${index + 1} needs a finish time.`
      if (schemaReady && task.start_by && task.start_by > task.finish_by) {
        return `Task ${index + 1} starts after it finishes.`
      }
      if (schemaReady) {
        const rawNames = task.fields.map((field) => field.field_name.trim())
        if (rawNames.some((name) => !name)) {
          return `Task ${index + 1} has an unnamed custom field.`
        }
        const names = rawNames.map((name) => name.toLowerCase())
        if (new Set(names).size !== names.length) {
          return `Task ${index + 1} has duplicate custom field names.`
        }
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
    let orgDb
    try {
      orgDb = await db()
    } catch (tenantError) {
      setFormError(tenantError.message)
      setSaving(false)
      return
    }

    let templateId = draft.id
    if (templateId) {
      const { error: updateError } = await orgDb
        .from('task_templates')
        .update({ name: draft.name.trim(), description: draft.description.trim() || null })
        .eq('id', templateId)
      if (updateError) throw updateError

      const { error: deleteError } = await orgDb
        .from('template_tasks')
        .delete()
        .eq('template_id', templateId)
      if (deleteError) throw deleteError
    } else {
      const { data, error: insertError } = await orgDb
        .from('task_templates')
        .insert({ name: draft.name.trim(), description: draft.description.trim() || null })
        .select('id')
        .single()
      if (insertError) throw insertError
      templateId = data.id
    }

    const taskRows = draft.tasks.map((task, index) => ({
      template_id: templateId,
      task_name: task.task_name.trim(),
      finish_by: task.finish_by,
      sort_order: index,
      ...(schemaReady ? { start_by: task.start_by || null } : {}),
    }))
    const { data: insertedTasks, error: taskError } = await orgDb
      .from('template_tasks')
      .insert(taskRows)
      .select('id, sort_order')
    if (taskError) throw taskError

    if (schemaReady) {
      const fieldRows = (insertedTasks || []).flatMap((inserted) => {
        const source = draft.tasks.find((_, index) => index === inserted.sort_order)
        if (!source) return []
        return source.fields
          .filter((field) => field.field_name.trim())
          .map((field, fieldIndex) => ({
            task_id: inserted.id,
            field_name: field.field_name.trim(),
            default_value: field.default_value.trim() || null,
            sort_order: fieldIndex,
          }))
      })
      if (fieldRows.length) {
        const { error: fieldError } = await orgDb.from('task_fields').insert(fieldRows)
        if (fieldError) throw fieldError
      }
    }

    setSaving(false)
    setDraft(null)
    setImportInfo(null)
    await loadTemplates()
  }

  async function deleteTemplate(template) {
    const accepted = await confirm(`Delete "${template.name}"?`, {
      title: 'Delete template',
      confirmLabel: 'Delete template',
    })
    if (!accepted) return
    setError('')
    const orgDb = await db()
    const { error: deleteError } = await orgDb
      .from('task_templates')
      .delete()
      .eq('id', template.id)
    if (deleteError) setError(deleteError.message)
    else await loadTemplates()
  }

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reusable task lists</p>
          <h2>Templates</h2>
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
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={importExcel}
            hidden
          />
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
            <input
              type="search"
              placeholder="Search templates or tasks..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
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
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <div className="template-summary-main">
                        <span>{task.task_name}</span>
                        <time>
                          {task.start_by ? `${task.start_by} – ${task.finish_by}` : task.finish_by}
                        </time>
                      </div>
                      {schemaReady && (task.task_fields || []).length > 0 && (
                        <div className="field-chips">
                          {task.task_fields.map((field) => (
                            <span className="field-chip" key={field.id}>{field.field_name}</span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
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
          <section
            className="modal-sheet template-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
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
                  <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
                </label>
                <label>
                  <span className="field-label">Description (optional)</span>
                  <input value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} />
                </label>
              </div>

              <div className="template-task-toolbar">
                <div>
                  <h3>Tasks</h3>
                  <p className="field-hint">Each task has a name, start time, finish time, and optional named fields.</p>
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
                        <div className="field-grid three">
                          <label>
                            <span className="field-label">Task name</span>
                            <input
                              placeholder="e.g. Clean bathroom"
                              value={task.task_name}
                              onChange={(event) => updateTask(index, 'task_name', event.target.value)}
                            />
                          </label>
                          {schemaReady && (
                            <label>
                              <span className="field-label">Start time</span>
                              <input
                                type="time"
                                value={task.start_by}
                                onChange={(event) => updateTask(index, 'start_by', event.target.value)}
                              />
                            </label>
                          )}
                          <label>
                            <span className="field-label">Finish time</span>
                            <input
                              type="time"
                              value={task.finish_by}
                              onChange={(event) => updateTask(index, 'finish_by', event.target.value)}
                            />
                          </label>
                        </div>

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
                                {task.fields.map((field, fieldIndex) => (
                                  <div className="custom-field-row" key={field.id || `new-${fieldIndex}`}>
                                    <input
                                      aria-label={`Field ${fieldIndex + 1} name for task ${index + 1}`}
                                      placeholder="Field name (e.g. Room notes)"
                                      value={field.field_name}
                                      onChange={(event) => updateField(index, fieldIndex, 'field_name', event.target.value)}
                                    />
                                    <input
                                      aria-label={`Default value for ${field.field_name || `field ${fieldIndex + 1}`}`}
                                      placeholder="Default value (optional)"
                                      value={field.default_value}
                                      onChange={(event) => updateField(index, fieldIndex, 'default_value', event.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className="text-button danger"
                                      onClick={() => removeField(index, fieldIndex)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Remove task ${index + 1}`}
                        onClick={() => removeTask(index)}
                      >
                        ×
                      </button>
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
    </section>
  )
}
