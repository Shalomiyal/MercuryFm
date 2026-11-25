import { useEffect, useState } from 'react'
import { useDataRefresh } from '../../contexts/DataRefreshContext'
import { formatRelative } from '../../lib/format'

export default function DataRefreshBar() {
  const { lastUpdated, refreshing, refresh } = useDataRefresh()
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="data-refresh-bar">
      <span>Last updated {formatRelative(lastUpdated)}</span>
      <button
        type="button"
        className="text-button"
        onClick={refresh}
        disabled={refreshing}
        aria-label="Refresh data now"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
