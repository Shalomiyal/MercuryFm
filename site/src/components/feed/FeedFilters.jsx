// FeedFilters.jsx — filter bar: date + all-dates toggle, cleaner, branch, type, search
// On mobile this collapses into a drawer toggled by a button.

import { useState } from 'react'

export default function FeedFilters({ filters, onChange, cleaners, branches = [], isMobile }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  const controls = (
    <div className="feed-filter-controls">
      <label className="feed-filter-item feed-all-dates">
        <input
          type="checkbox"
          checked={Boolean(filters.allDates)}
          onChange={(e) => onChange({ ...filters, allDates: e.target.checked })}
          aria-label="Show all dates"
        />
        <span>All dates</span>
      </label>

      {!filters.allDates && (
        <label className="feed-filter-item">
          <span className="sr-only">Date</span>
          <input
            type="date"
            value={filters.date}
            className="feed-filter-input"
            onChange={(e) => onChange({ ...filters, date: e.target.value })}
            aria-label="Filter by date"
          />
        </label>
      )}

      <label className="feed-filter-item">
        <span className="sr-only">Cleaner</span>
        <select
          value={filters.cleaner}
          className="feed-filter-select"
          onChange={(e) => onChange({ ...filters, cleaner: e.target.value })}
          aria-label="Filter by cleaner"
        >
          <option value="">All cleaners</option>
          {cleaners.map((c) => (
            <option key={c.id} value={c.id}>{c.full_name}</option>
          ))}
        </select>
      </label>

      <label className="feed-filter-item">
        <span className="sr-only">Branch</span>
        <select
          value={filters.branch}
          className="feed-filter-select"
          onChange={(e) => onChange({ ...filters, branch: e.target.value })}
          aria-label="Filter by branch"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.branch_id} value={b.branch_id}>{b.branch_id}</option>
          ))}
        </select>
      </label>

      <label className="feed-filter-item">
        <span className="sr-only">Type</span>
        <select
          value={filters.type}
          className="feed-filter-select"
          onChange={(e) => onChange({ ...filters, type: e.target.value })}
          aria-label="Filter by media type"
        >
          <option value="">All media</option>
          <option value="photo">Photos only</option>
          <option value="video">Videos only</option>
        </select>
      </label>

      <label className="feed-filter-item feed-search-wrap">
        <span className="sr-only">Search</span>
        <svg
          className="feed-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          placeholder="Search cleaner, room or task"
          value={filters.search}
          className="feed-filter-search"
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          aria-label="Search feed"
        />
      </label>
    </div>
  )

  if (isMobile) {
    const activeFilters = filters.search || filters.cleaner || filters.branch || filters.type || filters.allDates
    return (
      <div className="feed-filter-mobile">
        <button
          type="button"
          className="feed-filter-toggle"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          ⚙ Filters {activeFilters ? '•' : ''}
        </button>
        {drawerOpen && (
          <div className="feed-filter-drawer">
            {controls}
            <button type="button" className="text-button" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>
        )}
      </div>
    )
  }

  return controls
}
