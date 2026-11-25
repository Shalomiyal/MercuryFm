import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiPostAuthed } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { friendlyError } from '../lib/format'

function emptyDraft() {
  return { fullName: '', email: '', phone: '', role: 'cleaner' }
}

export default function UsersPage() {
  const { profile, schemaName } = useAuth()
  const { revision } = useDataRefresh()
  const confirm = useConfirm()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [draft, setDraft] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('cleaner')
  const [saving, setSaving] = useState(false)
  const [busyUserId, setBusyUserId] = useState(null)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [tempPassword, setTempPassword] = useState('')

  async function loadUsers() {
    if (!schemaName) {
      setUsers([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    // Staff-only RPC: it checks the caller is org_admin/admin of this schema
    // and is the only way authenticated clients can see NIC numbers.
    const { data, error: loadError } = await supabase.rpc('tenant_users', {
      p_schema: schemaName,
    })
    if (loadError) setError(friendlyError(loadError))
    else setUsers(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (schemaName) loadUsers()
  }, [schemaName, revision])

  function openCreate() {
    setDraft(emptyDraft())
    setFormError('')
    setSuccess('')
    setActionError('')
  }

  function openEdit(user) {
    setEditingUser(user)
    setEditRole(user.role)
    setFormError('')
    setSuccess('')
    setActionError('')
  }

  async function createUser(event) {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    if (!draft.fullName.trim() || !draft.email.trim() ||
        !['admin', 'cleaner'].includes(draft.role)) {
      setFormError('Complete the name, email, and role fields.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      setFormError('Enter a valid email address.')
      return
    }

    setSaving(true)
    try {
      const body = await apiPostAuthed('/create-user', draft)
      setDraft(null)
      setSuccess(`${draft.role === 'admin' ? 'Admin' : 'Cleaner'} account created for ${draft.email.trim()}.`)
      setTempPassword(body?.tempPassword || '')
      await loadUsers()
      if (body?.message) setSuccess(body.message)
    } catch (requestError) {
      setFormError(requestError.message || 'Could not create user.')
    } finally {
      setSaving(false)
    }
  }

  async function saveRole(event) {
    event.preventDefault()
    setFormError('')
    if (!editingUser || !['admin', 'cleaner'].includes(editRole)) return
    const changed = await runAction('update_role', {
      userId: editingUser.id,
      role: editRole,
    })
    if (changed) setEditingUser(null)
  }

  async function runAction(action, payload, confirmationMessage) {
    setActionError('')
    setSuccess('')
    if (confirmationMessage) {
      const accepted = await confirm(confirmationMessage, {
        title: 'Confirm user change',
        confirmLabel: 'Continue',
      })
      if (!accepted) return false
    }

    setBusyUserId(payload.userId || null)
    try {
      const body = await apiPostAuthed('/manage-user', { action, ...payload })
      setSuccess(body.message || 'User updated.')
      setTempPassword(body.tempPassword || '')
      await loadUsers()
      return true
    } catch (requestError) {
      setActionError(requestError.message || 'Could not update user.')
      return false
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Organization accounts</p>
          <h2>Users</h2>
        </div>
        {profile?.role === 'org_admin' && (
          <button type="button" className="primary-button page-button" onClick={openCreate}>
            Create user
          </button>
        )}
      </div>

      {success && <div className="success-banner" role="status">{success}</div>}
      {tempPassword && (
        <div className="success-banner" role="status">
          Temporary password: <strong>{tempPassword}</strong>. Copy it now — it will not be shown again.
        </div>
      )}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {loading ? (
        <div className="page-state-inline">Loading users...</div>
      ) : error ? (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadUsers}>Retry</button>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>No users in this organization yet.</p>
          {profile?.role === 'org_admin' && (
            <button type="button" className="secondary-button" onClick={openCreate}>Create user</button>
          )}
        </div>
      ) : (
        <div className="template-grid">
          {users.map((user) => {
            const canManage = profile?.role === 'org_admin' &&
              ['admin', 'cleaner'].includes(user.role)
            const busy = busyUserId === user.id

            return (
              <article className="template-card" key={user.id}>
                <div className="template-card-heading">
                  <div>
                    <h3>{user.full_name}</h3>
                    <p>{user.email || user.id}</p>
                    {user.nic && <p>NIC: {user.nic}</p>}
                    {user.phone && <p>Phone: {user.phone}</p>}
                  </div>
                  <span className="count-badge">{user.role}</span>
                </div>

                {canManage && (
                  <div className="user-actions">
                    <button
                      type="button"
                      className="secondary-button small-button"
                      onClick={() => openEdit(user)}
                      disabled={busy}
                    >
                      Edit role
                    </button>
                    <button
                      type="button"
                      className="secondary-button small-button"
                      onClick={() => runAction(
                        'reset_password',
                        { userId: user.id },
                        `Reset the password for ${user.full_name}? The current password will stop working.`,
                      )}
                      disabled={busy}
                    >
                      {busy ? 'Resetting...' : 'Reset password'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button small-button danger-button"
                      onClick={() => runAction(
                        'delete',
                        { userId: user.id },
                        `Delete ${user.full_name}? This cannot be undone.`,
                      )}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDraft(null)}>
          <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="user-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">Organization account</p><h2 id="user-title">Create user</h2></div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDraft(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={createUser} noValidate>
              <label htmlFor="user-full-name">Full name</label>
              <input id="user-full-name" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} />
              <label htmlFor="user-email">Email</label>
              <input id="user-email" type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />
              <label htmlFor="user-phone">Phone (optional)</label>
              <input id="user-phone" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} />
              <p className="upload-help">A strong temporary password will be generated and shown once after the account is created.</p>
              <label htmlFor="user-role">Role</label>
              <select id="user-role" value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}>
                <option value="cleaner">Cleaner</option>
                <option value="admin">Admin</option>
              </select>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingUser && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingUser(null)}>
          <section className="modal-sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-role-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">Organization account</p><h2 id="edit-role-title">Edit role</h2></div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setEditingUser(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={saveRole}>
              <p className="confirm-body">Choose a new role for {editingUser.full_name}.</p>
              <label htmlFor="edit-user-role">Role</label>
              <select id="edit-user-role" value={editRole} onChange={(event) => setEditRole(event.target.value)}>
                <option value="cleaner">Cleaner</option>
                <option value="admin">Admin</option>
              </select>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingUser(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={busyUserId === editingUser.id}>
                  {busyUserId === editingUser.id ? 'Saving...' : 'Save role'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
