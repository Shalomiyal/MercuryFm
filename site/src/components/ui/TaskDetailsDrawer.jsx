import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import StatusBadge from './StatusBadge'

export default function TaskDetailsDrawer({ open, onClose, task, cleanerName, templateName, workDate, onEdit }) {
  useEffect(() => {
    if (!open) return undefined
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && task ? (
        <motion.div
          className="wt-drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={onClose}
        >
          <motion.aside
            className="wt-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Task details"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="wt-drawer-header">
              <div>
                <p className="wt-eyebrow">{workDate || 'Daily Task'}</p>
                <h3>{task.task_name}</h3>
              </div>
              <button type="button" className="icon-button" aria-label="Close drawer" onClick={onClose}>
                ×
              </button>
            </header>

            <div className="wt-drawer-body">
              <div className="wt-drawer-meta-grid">
                <div className="wt-drawer-meta">
                  <span>Assigned Staff</span>
                  <strong>{cleanerName || 'Unassigned'}</strong>
                </div>
                <div className="wt-drawer-meta">
                  <span>Template</span>
                  <strong>{templateName || 'Daily assignment'}</strong>
                </div>
                <div className="wt-drawer-meta">
                  <span>Work Track / Branch</span>
                  <strong>{task.branch_id || 'All branches'}</strong>
                </div>
                <div className="wt-drawer-meta">
                  <span>Room</span>
                  <strong>{task.room_id || 'General'}</strong>
                </div>
                <div className="wt-drawer-meta">
                  <span>Start Window</span>
                  <strong>{task.start_by || 'Flexible'}</strong>
                </div>
                <div className="wt-drawer-meta">
                  <span>Finish By</span>
                  <strong>{task.finish_by || '—'}</strong>
                </div>
              </div>

              {task.state ? (
                <div className="wt-drawer-section">
                  <h4>Status</h4>
                  <StatusBadge status={task.state} />
                </div>
              ) : null}

              <div className="wt-drawer-section">
                <h4>Custom Fields</h4>
                {task.fields && task.fields.length > 0 ? (
                  <div className="wt-drawer-fields">
                    {task.fields.map((field) => (
                      <div className="wt-drawer-field-row" key={field.id || field.field_name}>
                        <span>{field.field_name}</span>
                        <strong>{field.field_value || '—'}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="wt-muted">No custom fields attached to this task.</p>
                )}
              </div>
            </div>

            {onEdit ? (
              <footer className="wt-drawer-footer">
                <button type="button" className="secondary-button" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    onClose?.()
                    onEdit(task)
                  }}
                >
                  Edit task
                </button>
              </footer>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
