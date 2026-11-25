export default function LoadMoreButton({ remaining, onClick, loading = false }) {
  if (remaining <= 0) return null
  return (
    <div className="load-more-wrap">
      <button
        type="button"
        className="secondary-button"
        onClick={onClick}
        disabled={loading}
      >
        {loading ? 'Loading...' : `Show ${Math.min(remaining, 12)} more`}
      </button>
      <span>{remaining} remaining</span>
    </div>
  )
}
