// FeedFilters.jsx — single WhatsApp-style search box to filter chat by name (or room/task)

export default function FeedFilters({ filters, onChange }) {
  const search = filters.search || ''

  return (
    <div className="feed-filter-controls">
      <label className="feed-filter-item feed-search-wrap">
        <span className="sr-only">Search chat by name</span>
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
          placeholder="Search name..."
          value={search}
          className="feed-filter-search"
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          aria-label="Search chat by name"
        />
      </label>
    </div>
  )
}
