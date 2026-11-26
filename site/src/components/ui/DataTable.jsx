import EmptyState from './EmptyState'

export default function DataTable({
  columns = [],
  rows = [],
  rowKey = (row, idx) => row.id ?? idx,
  onRowClick,
  emptyTitle = 'No records found',
  emptyDescription = '',
  sortBy = '',
  sortDir = 'asc',
  onSort,
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="wt-table-wrap">
      <table className="wt-table">
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = Boolean(col.sortable && onSort)
              const active = sortBy === col.key
              return (
                <th key={col.key} className={col.align === 'right' ? 'is-right' : ''}>
                  {sortable ? (
                    <button
                      type="button"
                      className={`wt-sort-btn ${active ? 'is-active' : ''}`}
                      onClick={() => onSort(col.key)}
                    >
                      <span>{col.label}</span>
                      <span className="wt-sort-indicator" aria-hidden="true">
                        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={onRowClick ? 'is-clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.align === 'right' ? 'is-right' : ''}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
