import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { useConfirm } from '../components/ui/ConfirmProvider'
import DataTable from '../components/ui/DataTable'
import PageHeader from '../components/ui/PageHeader'
import StatusBadge from '../components/ui/StatusBadge'
import TaskDetailsDrawer from '../components/ui/TaskDetailsDrawer'
import TemplatesManager from '../components/tasks/TemplatesManager'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('start_by') || message.includes('daily_task_field_values')
}

function sortFields(fields = []) {
  return [...fields].sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
}

function sortTasks(tasks = []) {
  return [...tasks].sort((left, right) => {
    const startLeft = left.start_by || '99:99'
    const startRight = right.start_by || '99:99'
    return startLeft.localeCompare(startRight) || String(left.finish_by).localeCompare(right.finish_by)
  })
}

function emptyDraft() {
  return { task_name: '', start_by: '', finish_by: '', fields: [] }
}

export default function DailyTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeView = searchParams.get('view') === 'templates' ? 'templates' : 'assign'
  const { revision } = useDataRefresh()
  const confirm = useConfirm()
  const [assignments, setAssignments] = useState([])
  const [templates, setTemplates] = useState([])
  const [cleaners, setCleaners] = useState([])
  const [tasks, setTasks] = useState([])
  const [selectedAssignment, setSelectedAssignment] = useState(null)
  const [workDate, setWorkDate] = useState(today())
  const [templateId, setTemplateId] = useState('')
  const [cleanerId, setCleanerId] = useState('')
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const cleanerById = useMemo(
    () => Object.fromEntries((cleaners || []).map((c) => [c.id, c.full_name])),
    [cleaners],
  )
  const templateById = useMemo(
    () => Object.fromEntries((templates || []).map((t) => [String(t.id), t.name])),
    [templates],
  )
  const [taskDraft, setTaskDraft] = useState(null)
  const [drawerTask, setDrawerTask] = useState(null)
  const [taskViewMode, setTaskViewMode] = useState('cards')
  const [formError, setFormError] = useState('')
  const [schemaReady, setSchemaReady] = useState(true)

  const visibleAssignments = useMemo(() => {
    const term = assignmentSearch.trim().toLowerCase()
    if (!term) return assignments
    return assignments.filter((assignment) =>
      String(cleanerById[assignment.cleaner_id] || '').toLowerCase().includes(term) ||
      String(templateById[String(assignment.template_id)] || '').toLowerCase().includes(term),
    )
  }, [assignments, assignmentSearch])

  async function loadLookups() {
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
    const [templateResult, cleanerResult, assignmentResult] = await Promise.all([
      orgDb.from('task_templates').select('id, name').order('name'),
      orgDb.from('members').select('id, full_name').eq('role', 'cleaner').eq('is_active', true).order('full_name'),
      workDate
        ? orgDb
            .from('daily_assignments')
            .select('id, work_date, template_id, cleaner_id')
            .eq('work_date', workDate)
            .order('id')
        : Promise.resolve({ data: [], error: null }),
    ])
    if (templateResult.error || cleanerResult.error || assignmentResult.error) {
      setError(
        templateResult.error?.message ||
        cleanerResult.error?.message ||
        assignmentResult.error?.message,
      )
    } else {
      setTemplates(templateResult.data || [])
      setCleaners(cleanerResult.data || [])
      setAssignments(assignmentResult.data || [])
      setSelectedAssignment(null)
      setTasks([])
      setTemplateId(templateResult.data?.[0]?.id?.toString() || '')
      setCleanerId(cleanerResult.data?.[0]?.id || '')
    }
    setLoading(false)
  }

  useEffect(() => {
    loadLookups()
  }, [workDate, revision])

  async function openTasks(assignment) {
    setSelectedAssignment(assignment)
    setError('')
    const orgDb = await db()
    let result = await orgDb
      .from('daily_tasks')
      .select('id, task_name, start_by, finish_by, branch_id, room_id, daily_task_field_values(id, field_name, field_value, sort_order), task_runs(state)')
      .eq('assignment_id', assignment.id)
      .order('start_by', { ascending: true, nullsFirst: false })
      .order('finish_by')
    if (result.error && isSchemaError(result.error)) {
      setSchemaReady(false)
      result = await orgDb
        .from('daily_tasks')
        .select('id, task_name, finish_by')
        .eq('assignment_id', assignment.id)
        .order('finish_by')
    } else {
      setSchemaReady(true)
    }
    if (result.error) {
      setError(result.error.message)
      setTasks([])
      return
    }
    setTasks(
      sortTasks(
        (result.data || []).map((task) => {
          const runs = Array.isArray(task.task_runs)
            ? task.task_runs
            : task.task_runs
              ? [task.task_runs]
              : []
          const allFields = sortFields(task.daily_task_field_values || [])
          // Extract reserved branch/room fields — show as task details, not custom fields
          const branch = allFields.find((f) => f.field_name === '__branch__')?.field_value || task.branch_id || ''
          const room   = allFields.find((f) => f.field_name === '__room__')?.field_value   || task.room_id   || ''
          return {
            ...task,
            branch,
            room,
            isCompleted: runs.some((run) => run.state === 'completed'),
            fields: allFields.filter((f) => f.field_name !== '__branch__' && f.field_name !== '__room__'),
          }
        }),
      ),
    )
  }

  async function findAssignment(orgDb, template) {
    return orgDb
      .from('daily_assignments')
      .select('id, work_date, template_id, cleaner_id')
      .eq('work_date', workDate)
      .eq('cleaner_id', cleanerId)
      .eq('template_id', template)
      .order('id')
      .limit(1)
      .maybeSingle()
  }

  function isDuplicate(error) {
    return error?.code === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''))
  }

  function isMissingRpc(error) {
    const message = String(error?.message || '')
    return error?.code === 'PGRST202' ||
      (message.includes('assign_template_tasks') && /not found|does not exist|schema cache/i.test(message))
  }

  async function assignTemplate(event) {
    event.preventDefault()
    setFormError('')
    if (!workDate || !templateId || !cleanerId) {
      setFormError('Choose a date, template, and cleaner.')
      return
    }
    setSaving(true)
    try {
      const orgDb = await db()
      const template = Number(templateId)
      let assignment = null

      // Preferred path: one idempotent call. Re-assigning the same template to
      // the same cleaner/date reuses the existing day and its admin-added tasks.
      const rpcResult = await supabase.rpc('assign_template_tasks', {
        p_work_date: workDate,
        p_cleaner_id: cleanerId,
        p_template_id: template,
      })
      if (!rpcResult.error && rpcResult.data) {
        assignment = {
          id: Number(rpcResult.data),
          work_date: workDate,
          template_id: template,
          cleaner_id: cleanerId,
        }
      } else if (rpcResult.error && !isMissingRpc(rpcResult.error)) {
        setFormError(rpcResult.error.message)
        setSaving(false)
        return
      }

      // Fallback for databases where the new migration has not been applied.
      if (!assignment) {
        const existing = await findAssignment(orgDb, template)
        if (existing.error) {
          setFormError(existing.error.message)
          setSaving(false)
          return
        }
        if (existing.data) {
          assignment = existing.data
        } else {
          const inserted = await orgDb
            .from('daily_assignments')
            .insert({ work_date: workDate, template_id: template, cleaner_id: cleanerId })
            .select('id, work_date, template_id, cleaner_id')
            .single()
          if (inserted.error && !isDuplicate(inserted.error)) {
            setFormError(inserted.error.message)
            setSaving(false)
            return
          }
          if (inserted.data) {
            const { error: loadError } = await orgDb.rpc('load_template_tasks', {
              p_assignment: inserted.data.id,
            })
            if (loadError) {
              setFormError(loadError.message)
              setSaving(false)
              return
            }
            assignment = inserted.data
          } else {
            // Another tab created it between the read and the insert.
            const raced = await findAssignment(orgDb, template)
            if (raced.error || !raced.data) {
              setFormError(raced.error?.message || 'Could not open this assignment.')
              setSaving(false)
              return
            }
            assignment = raced.data
          }
        }
      }

      setSaving(false)
      await loadLookups()
      await openTasks(assignment)
    } catch (requestError) {
      setFormError(requestError.message)
      setSaving(false)
    }
  }

  function openTaskDraft(task = null) {
    setFormError('')
    setTaskDraft(
      task
        ? { ...task, fields: sortFields(task.fields).map((field) => ({ ...field })) }
        : emptyDraft(),
    )
  }

  function addField() {
    setTaskDraft((current) => ({
      ...current,
      fields: [...current.fields, { field_name: '', field_value: '' }],
    }))
  }

  function updateField(index, field, value) {
    setTaskDraft((current) => ({
      ...current,
      fields: current.fields.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }))
  }

  function removeField(index) {
    setTaskDraft((current) => ({
      ...current,
      fields: current.fields.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  async function saveFields(orgDb, dailyTaskId) {
    if (!schemaReady || taskDraft?.isCompleted) return null
    const { error: deleteError } = await orgDb
      .from('daily_task_field_values')
      .delete()
      .eq('daily_task_id', dailyTaskId)
    if (deleteError) return deleteError
    const rows = taskDraft.fields
      .filter((field) => field.field_name.trim())
      .map((field, index) => ({
        daily_task_id: dailyTaskId,
        field_name: field.field_name.trim(),
        field_value: field.field_value || '',
        sort_order: index,
      }))
    if (!rows.length) return null
    const { error: insertError } = await orgDb.from('daily_task_field_values').insert(rows)
    return insertError
  }

  async function saveTask(event) {
    event.preventDefault()
    setFormError('')
    if (!taskDraft.task_name.trim() || !taskDraft.finish_by) {
      setFormError('Task name and finish time are required.')
      return
    }
    if (schemaReady && taskDraft.start_by && taskDraft.start_by > taskDraft.finish_by) {
      setFormError('Start time cannot be after finish time.')
      return
    }
    if (schemaReady) {
      const names = taskDraft.fields.map((field) => field.field_name.trim())
      if (names.some((name) => !name)) {
        setFormError('Every custom field needs a name.')
        return
      }
      if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
        setFormError('Custom field names must be unique for this task.')
        return
      }
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

    const payload = {
      task_name: taskDraft.task_name.trim(),
      finish_by: taskDraft.finish_by,
      ...(schemaReady ? { start_by: taskDraft.start_by || null } : {}),
    }

    let dailyTaskId = taskDraft.id
    let saveError = null
    if (dailyTaskId) {
      const result = await orgDb.from('daily_tasks').update(payload).eq('id', dailyTaskId)
      saveError = result.error
    } else {
      const result = await orgDb
        .from('daily_tasks')
        .insert({ assignment_id: selectedAssignment.id, ...payload })
        .select('id')
        .single()
      saveError = result.error
      dailyTaskId = result.data?.id
    }
    if (!saveError && dailyTaskId) saveError = await saveFields(orgDb, dailyTaskId)

    setSaving(false)
    if (saveError) {
      setFormError(saveError.message)
      return
    }
    setTaskDraft(null)
    await openTasks(selectedAssignment)
  }

  async function removeTask(task) {
    const accepted = await confirm(`Remove "${task.task_name}" from this day?`, {
      title: 'Remove task',
      confirmLabel: 'Remove task',
    })
    if (!accepted) return
    const orgDb = await db()
    const { error: deleteError } = await orgDb.from('daily_tasks').delete().eq('id', task.id)
    if (deleteError) setError(deleteError.message)
    else await openTasks(selectedAssignment)
  }

  function setView(nextView) {
    if (nextView === 'templates') {
      setSearchParams({ view: 'templates' })
    } else {
      setSearchParams({})
    }
  }

  return (
    <section className="content-page">
      <PageHeader
        eyebrow="Operations"
        title="Daily Tasks & Templates"
        subtitle="Assign reusable templates to staff by date, then inspect or fine-tune each day's tasks."
      />

      <div className="segmented-tabs" role="tablist" aria-label="Daily tasks views">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'assign'}
          className={`segmented-tab ${activeView === 'assign' ? 'active' : ''}`}
          onClick={() => setView('assign')}
        >
          Assign tasks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'templates'}
          className={`segmented-tab ${activeView === 'templates' ? 'active' : ''}`}
          onClick={() => setView('templates')}
        >
          Templates
        </button>
      </div>

      {activeView === 'templates' ? (
        <TemplatesManager embedded onTemplatesChanged={loadLookups} />
      ) : (
        <>
      {!schemaReady && (
        <div className="notice warning" role="status">
          Run <code>supabase/task-fields-and-start-times.sql</code> in the Supabase SQL Editor to
          edit start times and custom field values.
        </div>
      )}
      {error && (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadLookups}>Retry</button>
        </div>
      )}

      <div className={`assignment-layout ${error ? 'is-muted' : ''}`}>
        <aside className="assignment-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Step 1</p>
              <h3>Assign a template</h3>
            </div>
          </div>
          <form className="assignment-form" onSubmit={assignTemplate} noValidate>
            <label>
              <span className="field-label">Work date</span>
              <input id="work-date" type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
            </label>
            <div className="field-block">
              <div className="field-label-row">
                <label className="field-label" htmlFor="template-select">Template</label>
                <button
                  type="button"
                  className="text-button inline-action"
                  onClick={() => setView('templates')}
                >
                  Manage templates
                </button>
              </div>
              <select id="template-select" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">Select template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              {!loading && templates.length === 0 && (
                <p className="field-hint">
                  No templates yet?{' '}
                  <button
                    type="button"
                    className="text-button inline-action"
                    onClick={() => setView('templates')}
                  >
                    Create one
                  </button>
                </p>
              )}
            </div>
            <label>
              <span className="field-label">Cleaning staff</span>
              <select id="cleaner-select" value={cleanerId} onChange={(event) => setCleanerId(event.target.value)}>
                <option value="">Select cleaner</option>
                {cleaners.map((cleaner) => (
                  <option key={cleaner.id} value={cleaner.id}>{cleaner.full_name}</option>
                ))}
              </select>
            </label>
            {formError && !taskDraft && <p className="form-error" role="alert">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving || !templateId || !cleanerId}>
              {saving ? 'Loading tasks...' : 'Assign template'}
            </button>
          </form>

          <div className="assignment-list">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Step 2</p>
                <h3>Assignments</h3>
              </div>
              <span className="count-badge">{visibleAssignments.length}</span>
            </div>
            <label className="search-field">
              <span className="sr-only">Search assignments</span>
              <input
                type="search"
                placeholder="Search cleaner or template..."
                value={assignmentSearch}
                onChange={(event) => setAssignmentSearch(event.target.value)}
              />
            </label>
            {loading ? (
              <p className="muted">Loading assignments...</p>
            ) : assignments.length === 0 ? (
              <div className="empty-state compact"><p>No assignments for this date.</p></div>
            ) : visibleAssignments.length === 0 ? (
              <div className="empty-state compact"><p>No assignments match that search.</p></div>
            ) : visibleAssignments.map((assignment) => (
              <button
                type="button"
                className={`assignment-item ${selectedAssignment?.id === assignment.id ? 'active' : ''}`}
                key={assignment.id}
                onClick={() => openTasks(assignment)}
              >
                <strong>{cleanerById[assignment.cleaner_id] || 'Cleaner'}</strong>
                <span>{templateById[String(assignment.template_id)] || 'Daily assignment'}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="task-panel">
          {selectedAssignment ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{workDate} · Step 3</p>
                  <h3>{cleanerById[selectedAssignment.cleaner_id] || 'Cleaner'}</h3>
                  <p className="field-hint">{templateById[String(selectedAssignment.template_id)] || 'Daily assignment'}</p>
                </div>
                <div className="toolbar-actions">
                  <div className="wt-theme-switch" role="group" aria-label="Task display mode">
                    <button
                      type="button"
                      className={`wt-theme-btn ${taskViewMode === 'cards' ? 'active' : ''}`}
                      style={{ width: 'auto', padding: '0 10px', fontSize: '12px', fontWeight: 600 }}
                      onClick={() => setTaskViewMode('cards')}
                    >
                      Cards
                    </button>
                    <button
                      type="button"
                      className={`wt-theme-btn ${taskViewMode === 'table' ? 'active' : ''}`}
                      style={{ width: 'auto', padding: '0 10px', fontSize: '12px', fontWeight: 600 }}
                      onClick={() => setTaskViewMode('table')}
                    >
                      Table
                    </button>
                  </div>
                  <span className="count-badge">
                    {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                  <button type="button" className="primary-button page-button" onClick={() => openTaskDraft()}>
                    Add task
                  </button>
                </div>
              </div>
              {tasks.length === 0 ? (
                <div className="empty-state"><p>No daily tasks for this assignment yet.</p></div>
              ) : taskViewMode === 'table' ? (
                <DataTable
                  rows={tasks}
                  onRowClick={(task) => setDrawerTask(task)}
                  columns={[
                    {
                      key: 'task_name',
                      label: 'Task',
                      render: (task) => (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong>{task.task_name}</strong>
                            {task.isCompleted && <StatusBadge status="completed" label="Completed" />}
                          </div>
                          {(task.branch || task.room) && (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                              {[task.branch, task.room].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: 'start_by',
                      label: 'Window',
                      render: (task) =>
                        task.start_by ? `${task.start_by} – ${task.finish_by}` : `By ${task.finish_by}`,
                    },
                    {
                      key: 'actions',
                      label: 'Actions',
                      align: 'right',
                      render: (task) => (
                        <div className="card-actions" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="text-button" onClick={() => setDrawerTask(task)}>Details</button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={task.isCompleted}
                            title={task.isCompleted ? 'Completed by staff' : undefined}
                            onClick={() => openTaskDraft(task)}
                          >
                            Edit
                          </button>
                          <button type="button" className="text-button danger" onClick={() => removeTask(task)}>Remove</button>
                        </div>
                      ),
                    },
                  ]}
                />
              ) : (
                <div className="daily-task-list">
                  {tasks.map((task) => (
                    <article className="daily-task-row" key={task.id}>
                      <div className="daily-task-main">
                        <div className="daily-task-title">
                          <strong>{task.task_name}</strong>
                          <div className="time-chip-group">
                            {task.isCompleted && <StatusBadge status="completed" label="Completed" />}
                            {schemaReady && task.start_by && <span className="time-chip start">Starts {task.start_by}</span>}
                            <span className="time-chip">Finish {task.finish_by}</span>
                            {task.branch && <span className="time-chip">📍 {task.branch}{task.room ? ` · ${task.room}` : ''}</span>}
                          </div>
                        </div>
                        {schemaReady && task.fields.length > 0 && (
                          <div className="daily-task-fields">
                            {task.fields.map((field) => (
                              <div className="daily-task-field" key={field.id}>
                                <span>{field.field_name}</span>
                                <strong>{field.field_value || '—'}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="card-actions">
                        <button type="button" className="text-button" onClick={() => setDrawerTask(task)}>Details</button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={task.isCompleted}
                          title={task.isCompleted ? 'Completed by staff' : undefined}
                          onClick={() => openTaskDraft(task)}
                        >
                          Edit
                        </button>
                        <button type="button" className="text-button danger" onClick={() => removeTask(task)}>Remove</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>Select or create an assignment to edit its daily tasks.</p>
            </div>
          )}
        </div>
      </div>

      {taskDraft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTaskDraft(null)}>
          <section
            className="modal-sheet template-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{taskDraft.id ? 'Edit' : 'Add'} daily task</p>
                <h2 id="task-title">Task details</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setTaskDraft(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={saveTask} noValidate>
              <div className="field-grid three">
                <label>
                  <span className="field-label">Task name</span>
                  <input value={taskDraft.task_name} onChange={(event) => setTaskDraft((current) => ({ ...current, task_name: event.target.value }))} />
                </label>
                {schemaReady && (
                  <label>
                    <span className="field-label">Start time</span>
                    <input type="time" value={taskDraft.start_by} onChange={(event) => setTaskDraft((current) => ({ ...current, start_by: event.target.value }))} />
                  </label>
                )}
                <label>
                  <span className="field-label">Finish time</span>
                  <input type="time" value={taskDraft.finish_by} onChange={(event) => setTaskDraft((current) => ({ ...current, finish_by: event.target.value }))} />
                </label>
              </div>

              {(taskDraft.branch || taskDraft.room) && (
                <div className="field-grid two" style={{ marginTop: 10 }}>
                  {taskDraft.branch && (
                    <div>
                      <span className="field-label">Branch</span>
                      <div style={{
                        height: 40, display: 'flex', alignItems: 'center',
                        padding: '0 12px', borderRadius: 10,
                        border: '1.5px solid var(--color-border)',
                        background: 'var(--color-surface-subtle)',
                        fontSize: 13.5, color: 'var(--color-text-primary)',
                      }}>
                        {taskDraft.branch}
                      </div>
                    </div>
                  )}
                  {taskDraft.room && (
                    <div>
                      <span className="field-label">Room</span>
                      <div style={{
                        height: 40, display: 'flex', alignItems: 'center',
                        padding: '0 12px', borderRadius: 10,
                        border: '1.5px solid var(--color-border)',
                        background: 'var(--color-surface-subtle)',
                        fontSize: 13.5, color: 'var(--color-text-primary)',
                      }}>
                        {taskDraft.room}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {schemaReady && (
                <div className="task-custom-fields">
                  <div className="field-list-heading">
                    <span className="field-label">Custom field values</span>
                    {!taskDraft.isCompleted && (
                      <button type="button" className="text-button" onClick={addField}>+ Add field</button>
                    )}
                  </div>
                  {taskDraft.isCompleted && (
                    <p className="field-hint">
                      Completed by staff — recorded custom field values are locked and read-only.
                    </p>
                  )}
                  {taskDraft.fields.length === 0 ? (
                    <p className="field-hint">No extra fields for this task. Add one if you need to record more detail.</p>
                  ) : (
                    <div className="custom-field-list">
                      {taskDraft.fields.map((field, index) => (
                        <div className="custom-field-row" key={field.id || `new-${index}`}>
                          <input
                            aria-label={`Field ${index + 1} name`}
                            placeholder="Field name"
                            value={field.field_name}
                            disabled={Boolean(taskDraft.isCompleted)}
                            readOnly={Boolean(taskDraft.isCompleted)}
                            onChange={(event) => updateField(index, 'field_name', event.target.value)}
                          />
                          <input
                            aria-label={`Value for ${field.field_name || `field ${index + 1}`}`}
                            placeholder="Value"
                            value={field.field_value || ''}
                            disabled={Boolean(taskDraft.isCompleted)}
                            readOnly={Boolean(taskDraft.isCompleted)}
                            onChange={(event) => updateField(index, 'field_value', event.target.value)}
                          />
                          {!taskDraft.isCompleted && (
                            <button type="button" className="text-button danger" onClick={() => removeField(index)}>Remove</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setTaskDraft(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? 'Saving...' : 'Save task'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
        </>
      )}
      <TaskDetailsDrawer
        open={Boolean(drawerTask)}
        onClose={() => setDrawerTask(null)}
        task={drawerTask}
        cleanerName={selectedAssignment ? cleanerById[selectedAssignment.cleaner_id] : ''}
        templateName={selectedAssignment ? templateById[String(selectedAssignment.template_id)] : ''}
        workDate={workDate}
        onEdit={drawerTask && !drawerTask.isCompleted ? (task) => openTaskDraft(task) : undefined}
      />
    </section>
  )
}
