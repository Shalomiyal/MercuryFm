import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useDataRefresh } from '../contexts/DataRefreshContext'
import { usePagination } from '../hooks/usePagination'
import LoadMoreButton from '../components/ui/LoadMoreButton'

function emptyOrganization() {
  return { name: '', slug: '', orgAdminFullName: '', email: '' }
}

function OrgCard({ organization, onToggleActive, saving }) {
  const isActive = organization.is_active
  return (
    <article className={`org-card${isActive ? '' : ' org-card--inactive'}`}>
      <div className="org-card-header">
        <div className="org-card-avatar">
          {organization.name.charAt(0).toUpperCase()}
        </div>
        <div className="org-card-title">
          <h3>{organization.name}</h3>
          <code className="org-slug">/{organization.slug}</code>
        </div>
        <span className={`task-state ${isActive ? 'state-completed' : 'state-not_started'}`}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <dl className="org-details">
        <div>
          <dt>Admin</dt>
          <dd title={organization.orgAdmin?.fullName}>
            {organization.orgAdmin?.fullName || <span className="org-unassigned">Not assigned</span>}
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd title={organization.orgAdmin?.email}>
            {organization.orgAdmin?.email || <span className="org-unassigned">—</span>}
          </dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd><code className="org-slug">{organization.schema_name}</code></dd>
        </div>
        <div>
          <dt>Rooms</dt>
          <dd>
            <span className={`org-rooms-pill${organization.rooms_locked ? '' : ' locked'}`}>
              {organization.rooms_locked ? '✓ Rooms loaded' : '○ No rooms yet'}
            </span>
          </dd>
        </div>
      </dl>

      <div className="card-actions">
        <button
          type="button"
          className={isActive ? 'text-button danger' : 'text-button'}
          onClick={() => onToggleActive(organization, !isActive)}
          disabled={saving}
        >
          {isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </article>
  )
}

export default function PlatformPage() {
  const { revision } = useDataRefresh()
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'active' | 'inactive'
  const [confirmDeactivate, setConfirmDeactivate] = useState(null)

  async function loadOrganizations() {
    setLoading(true)
    setError('')
    const { data: sessionData } = await supabase.auth.getSession()
    const response = await fetch('/api/organization-details', {
      headers: {
        Authorization: `Bearer ${sessionData.session?.access_token || ''}`,
      },
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = { error: 'Could not load organization details.' }
    }
    if (!response.ok) setError(body.error || 'Could not load organizations.')
    else setOrganizations(body.organizations || [])
    setLoading(false)
  }

  useEffect(() => {
    loadOrganizations()
  }, [revision])

  async function authorizedPost(path, body) {
    const { data } = await supabase.auth.getSession()
    return fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token || ''}`,
      },
      body: JSON.stringify(body),
    })
  }

  function openCreate() {
    setDraft(emptyOrganization())
    setFormError('')
  }

  async function createOrganization(event) {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    const slug = draft.slug.trim().toLowerCase()
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
      setFormError('Slug must be 2–30 characters: lowercase letters, numbers, and underscores only.')
      return
    }
    if (!draft.name.trim() || !draft.orgAdminFullName.trim() || !draft.email.trim()) {
      setFormError('Complete the organization name, slug, admin name, and email.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      setFormError('Enter a valid organization admin email address.')
      return
    }
    setSaving(true)
    const response = await authorizedPost('/api/create-organization', { ...draft, slug })
    let body
    try {
      body = await response.json()
    } catch {
      body = {
        error: response.status === 404
          ? 'API route not available. Start the app with npm run dev.'
          : 'The server returned an invalid response.',
      }
    }
    setSaving(false)
    if (!response.ok) {
      setFormError(
        body.detail
          ? `${body.error || 'Organization provisioning failed'}: ${body.detail}`
          : (body.error || 'Organization provisioning failed'),
      )
      return
    }
    setDraft(null)
    setSuccess(`✓ Organization "${body.schemaName}" provisioned successfully.`)
    setTempPassword(body.tempPassword || '')
    await loadOrganizations()
  }

  function requestToggle(organization, nextActive) {
    if (!nextActive) {
      setConfirmDeactivate(organization)
    } else {
      doToggle(organization, true)
    }
  }

  async function doToggle(organization, isActive) {
    setConfirmDeactivate(null)
    setError('')
    setSuccess('')
    setSaving(true)
    const response = await authorizedPost('/api/set-organization-active', {
      organizationId: organization.id,
      isActive,
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = { error: 'The server returned an invalid response.' }
    }
    setSaving(false)
    if (!response.ok) setError(body.error || 'Could not update organization.')
    else {
      setSuccess(`${organization.name} ${isActive ? 'activated' : 'deactivated'}.`)
      await loadOrganizations()
    }
  }

  const stats = useMemo(() => ({
    total: organizations.length,
    active: organizations.filter((o) => o.is_active).length,
    inactive: organizations.filter((o) => !o.is_active).length,
  }), [organizations])

  const visibleOrgs = useMemo(() => {
    let list = organizations
    if (filter === 'active') list = list.filter((o) => o.is_active)
    if (filter === 'inactive') list = list.filter((o) => !o.is_active)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
      )
    }
    return list
  }, [organizations, filter, search])
  const orgPagination = usePagination(visibleOrgs.length, 12, 12)

  return (
    <section className="content-page">
      {/* Page heading */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform administration</p>
          <h2>Organizations</h2>
        </div>
        <button type="button" className="primary-button page-button" onClick={openCreate}>
          + Create organization
        </button>
      </div>

      {/* Stats strip */}
      {!loading && !error && (
        <div className="org-stats-strip">
          <div className="org-stat">
            <span className="org-stat-num">{stats.total}</span>
            <span className="org-stat-label">Total</span>
          </div>
          <div className="org-stat-divider" />
          <div className="org-stat">
            <span className="org-stat-num org-stat-num--active">{stats.active}</span>
            <span className="org-stat-label">Active</span>
          </div>
          <div className="org-stat-divider" />
          <div className="org-stat">
            <span className="org-stat-num org-stat-num--inactive">{stats.inactive}</span>
            <span className="org-stat-label">Inactive</span>
          </div>
        </div>
      )}

      {/* Success banner */}
      {success && (
        <div className="success-banner" role="status">
          {success}
          <button type="button" className="banner-dismiss" onClick={() => setSuccess('')} aria-label="Dismiss">×</button>
        </div>
      )}
      {tempPassword && (
        <div className="success-banner" role="status">
          Admin temporary password: <strong>{tempPassword}</strong>. Copy it now — it will not be shown again.
          <button type="button" className="banner-dismiss" onClick={() => setTempPassword('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Search + filter bar */}
      {!loading && !error && organizations.length > 0 && (
        <div className="org-toolbar">
          <input
            className="org-search"
            type="search"
            placeholder="Search by name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search organizations"
          />
          <div className="task-filter" role="group" aria-label="Filter organizations">
            {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={filter === val ? 'active' : ''}
                onClick={() => setFilter(val)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="org-skeleton-grid">
          {[1, 2, 3].map((n) => <div key={n} className="org-skeleton-card shimmer" />)}
        </div>
      ) : error ? (
        <div className="empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={loadOrganizations}>Retry</button>
        </div>
      ) : visibleOrgs.length === 0 ? (
        <div className="empty-state">
          {search || filter !== 'all'
            ? <p>No organizations match your search.</p>
            : <><p>No organizations yet.</p><button type="button" className="secondary-button" onClick={openCreate}>Create organization</button></>
          }
        </div>
      ) : (
        <div className="org-card-grid">
          {orgPagination.visible(visibleOrgs).map((organization) => (
            <OrgCard
              key={organization.id}
              organization={organization}
              onToggleActive={requestToggle}
              saving={saving}
            />
          ))}
        </div>
      )}
      <LoadMoreButton
        remaining={orgPagination.remaining}
        onClick={orgPagination.showMore}
      />

      {/* SQL Fallback */}
      <details className="phase-card sql-fallback">
        <summary style={{ cursor: 'pointer', userSelect: 'none', listStyle: 'none' }}>
          <p className="eyebrow" style={{ display: 'inline' }}>Manual SQL fallback ▾</p>
        </summary>
        <code>{"select public.provision_organization('Organization Name', 'organization_slug');"}</code>
      </details>

      {/* Deactivate confirmation modal */}
      {confirmDeactivate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmDeactivate(null)}>
          <section className="modal-sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="confirm-icon">⚠️</div>
            <h2 id="confirm-title">Deactivate organization?</h2>
            <p className="confirm-body">
              <strong>{confirmDeactivate.name}</strong> will be deactivated. Users in this organization
              will no longer be able to sign in until it is reactivated.
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmDeactivate(null)}>Cancel</button>
              <button type="button" className="primary-button danger-button" onClick={() => doToggle(confirmDeactivate, false)}>
                Deactivate
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Create organization modal */}
      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDraft(null)}>
          <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="org-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Provision organization</p>
                <h2 id="org-title">Create organization</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDraft(null)}>×</button>
            </div>
            <form className="status-form" onSubmit={createOrganization} noValidate>
              <label htmlFor="org-name">Organization name</label>
              <input
                id="org-name"
                value={draft.name}
                placeholder="e.g. Sunset Hotels"
                onChange={(event) => {
                  const name = event.target.value
                  setDraft((current) => ({
                    ...current,
                    name,
                    slug: current.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                  }))
                }}
              />
              <label htmlFor="org-slug">
                Slug
                <span className="optional-label" style={{ marginLeft: 6 }}>2–30 chars, lowercase, underscores</span>
              </label>
              <input
                id="org-slug"
                value={draft.slug}
                placeholder="e.g. sunset_hotels"
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  slug: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                }))}
              />
              <label htmlFor="org-admin-name">Admin full name</label>
              <input
                id="org-admin-name"
                value={draft.orgAdminFullName}
                placeholder="e.g. Jane Smith"
                onChange={(event) => setDraft((current) => ({ ...current, orgAdminFullName: event.target.value }))}
              />
              <label htmlFor="org-admin-email">Admin email</label>
              <input
                id="org-admin-email"
                type="email"
                value={draft.email}
                placeholder="admin@example.com"
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
              />
              <p className="upload-help">A strong temporary password will be generated and shown once after provisioning.</p>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? 'Provisioning…' : 'Create organization'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
