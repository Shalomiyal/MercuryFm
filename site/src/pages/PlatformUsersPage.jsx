import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiPostAuthed } from '../lib/api'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'
import { friendlyError } from '../lib/format'

export default function PlatformUsersPage() {
  const { revision } = useDataRefresh()
  const confirm = useConfirm()
  const [users, setUsers] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [success, setSuccess] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [search, setSearch] = useState('')
  const [selectedOrg, setSelectedOrg] = useState('all')
  const [selectedRole, setSelectedRole] = useState('all')
  const [busyUserId, setBusyUserId] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [newRole, setNewRole] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    const { data: sessionData } = await supabase.auth.getSession()
    try {
      const response = await fetch('/api/platform-users', {
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token || ''}`,
        },
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error || 'Could not load platform users.')
      } else {
        setUsers(body.users || [])
        setOrganizations(body.organizations || [])
      }
    } catch {
      setError('Could not connect to user service.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [revision])

  async function runAction(action, payload, confirmMsg) {
    if (confirmMsg) {
      const accepted = await confirm(confirmMsg, {
        title: 'Confirm user change',
        confirmLabel: 'Continue',
      })
      if (!accepted) return
    }
    setActionError('')
    setSuccess('')
    setBusyUserId(payload.userId)
    try {
      const res = await apiPostAuthed('/manage-user', { action, ...payload })
      setSuccess(res.message || 'Operation succeeded.')
      setTempPassword(res.tempPassword || '')
      await loadData()
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setBusyUserId(null)
      setEditingUser(null)
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (selectedOrg !== 'all' && u.orgId !== selectedOrg) return false
      if (selectedRole !== 'all' && u.role !== selectedRole) return false
      if (search.trim()) {
        const query = search.toLowerCase()
        const matchesName = u.fullName?.toLowerCase().includes(query)
        const matchesEmail = u.email?.toLowerCase().includes(query)
        const matchesOrg = u.organizationName?.toLowerCase().includes(query)
        if (!matchesName && !matchesEmail && !matchesOrg) return false
      }
      return true
    })
  }, [users, selectedOrg, selectedRole, search])
  const userPagination = usePagination(filteredUsers.length, 15, 15)

  const stats = useMemo(() => {
    const total = users.length
    const orgAdmins = users.filter((u) => u.role === 'org_admin').length
    const admins = users.filter((u) => u.role === 'admin').length
    const cleaners = users.filter((u) => u.role === 'cleaner').length
    return { total, orgAdmins, admins, cleaners }
  }, [users])

  function roleBadgeInfo(role) {
    switch (role) {
      case 'platform_admin':
        return { label: 'Platform Admin', bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' }
      case 'org_admin':
        return { label: 'Org Admin', bg: '#fff1f2', text: '#9f1239', border: '#fecdd3' }
      case 'admin':
        return { label: 'Admin', bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' }
      case 'cleaner':
        return { label: 'Cleaner', bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
      default:
        return { label: role, bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' }
    }
  }

  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform Administration</p>
          <h2>User Management</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={loadData}
          disabled={loading}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 21h5v-5"/>
          </svg>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* KPI Stats Strip */}
      <div className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Total Users</p>
          <strong className="stat-value">{stats.total}</strong>
        </article>
        <article className="stat-card">
          <p className="stat-label">Org Admins</p>
          <strong className="stat-value" style={{ color: '#9f1239' }}>{stats.orgAdmins}</strong>
        </article>
        <article className="stat-card">
          <p className="stat-label">Facility Admins</p>
          <strong className="stat-value" style={{ color: '#0369a1' }}>{stats.admins}</strong>
        </article>
        <article className="stat-card">
          <p className="stat-label">Cleaners</p>
          <strong className="stat-value" style={{ color: '#047857' }}>{stats.cleaners}</strong>
        </article>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search by name, email or organization..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={selectedOrg}
          onChange={(e) => setSelectedOrg(e.target.value)}
          aria-label="Filter by organization"
        >
          <option value="all">All organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name} (/{org.slug})
            </option>
          ))}
        </select>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="all">All roles</option>
          <option value="org_admin">Org Admin</option>
          <option value="admin">Admin</option>
          <option value="cleaner">Cleaner</option>
          <option value="platform_admin">Platform Admin</option>
        </select>
      </div>

      {success && (
        <div className="success-banner" role="status">
          <span>✓ {success}</span>
          <button type="button" className="text-button" onClick={() => setSuccess('')} style={{ minHeight: 'auto', padding: 0 }}>✕</button>
        </div>
      )}
      {tempPassword && (
        <div className="success-banner" role="status">
          Temporary password: <strong>{tempPassword}</strong>. Copy it now — it will not be shown again.
        </div>
      )}
      {actionError && <p className="form-error" role="alert" style={{ marginBottom: 16 }}>{actionError}</p>}
      {error && <p className="form-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <div className="page-state-inline">Loading users across organizations...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <p>No users found matching the selected filters.</p>
        </div>
      ) : (
        <div className="template-grid">
          {userPagination.visible(filteredUsers).map((u) => {
            const isBusy = busyUserId === u.id
            const isSelf = u.role === 'platform_admin'
            const badge = roleBadgeInfo(u.role)
            const initial = (u.fullName && u.fullName !== '—') ? u.fullName.charAt(0).toUpperCase() : (u.email ? u.email.charAt(0).toUpperCase() : 'U')

            return (
              <article className="template-card" key={u.id}>
                {/* Header with avatar, user info, and role badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      minWidth: 44,
                      borderRadius: 12,
                      background: badge.bg,
                      color: badge.text,
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 800,
                      fontSize: 18,
                      border: `1px solid ${badge.border}`,
                    }}
                  >
                    {initial}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.fullName}>
                        {u.fullName}
                      </h3>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: badge.bg,
                          color: badge.text,
                          border: `1px solid ${badge.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.email}>
                      {u.email}
                    </p>
                    {u.phone && (
                      <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: 12 }}>
                        Phone: {u.phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* Details dl */}
                <dl className="org-details" style={{ marginBottom: 16 }}>
                  <div>
                    <dt>Organization</dt>
                    <dd title={u.organizationName}>
                      <strong>{u.organizationName}</strong>
                      {u.organizationSlug && (
                        <code className="org-slug" style={{ marginLeft: 6 }}>/{u.organizationSlug}</code>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Email status</dt>
                    <dd>
                      <span className={`task-state ${u.emailVerified ? 'state-completed' : 'state-not_started'}`}>
                        {u.emailVerified ? '✓ Verified' : '○ Unverified'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Password status</dt>
                    <dd>
                      {u.mustChangePassword ? (
                        <span style={{ color: '#d97706', fontSize: 12, fontWeight: 700 }}>Initial password</span>
                      ) : (
                        <span style={{ color: '#059669', fontSize: 12, fontWeight: 700 }}>✓ Active</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {/* Card actions */}
                {!isSelf ? (
                  <div className="card-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={isBusy}
                      onClick={() => {
                        setEditingUser(u)
                        setNewRole(u.role)
                      }}
                    >
                      Change role
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={isBusy}
                      onClick={() =>
                        runAction(
                          'reset_password',
                          { userId: u.id },
                          `Reset password for ${u.fullName} (${u.email})? The current password will stop working.`,
                        )
                      }
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={isBusy}
                      onClick={() =>
                        runAction(
                          'delete',
                          { userId: u.id },
                          `Are you sure you want to delete ${u.fullName} (${u.email})? This action cannot be undone.`,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                    <small style={{ color: '#94a3b8', fontSize: 12 }}>Platform account (self)</small>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
      <LoadMoreButton
        remaining={userPagination.remaining}
        onClick={userPagination.showMore}
      />

      {/* Change role dialog modal */}
      {editingUser && (
        <dialog
          open
          className="dialog"
        >
          <div className="login-card" style={{ maxWidth: 440, width: '90%', margin: 'auto' }}>
            <p className="eyebrow">User Management</p>
            <h3 style={{ fontSize: 20 }}>Change User Role</h3>
            <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 16px' }}>
              Assign a new role for <strong>{editingUser.fullName}</strong> ({editingUser.email}).
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                runAction('update_role', { userId: editingUser.id, role: newRole })
              }}
            >
              <label htmlFor="select-role-modal" style={{ fontSize: 13, fontWeight: 600 }}>Select Role</label>
              <select
                id="select-role-modal"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                style={{ width: '100%', marginBottom: 20 }}
              >
                <option value="cleaner">Cleaner</option>
                <option value="admin">Facility Admin</option>
                <option value="org_admin">Organization Admin</option>
              </select>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingUser(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Save Role
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </section>
  )
}
