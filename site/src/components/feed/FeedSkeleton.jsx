// FeedSkeleton.jsx — shimmer placeholder while feed is loading
export default function FeedSkeleton({ count = 4 }) {
  return (
    <div className="feed-skeleton" aria-hidden="true" aria-label="Loading feed…">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="feed-skeleton-bubble">
          <div className="feed-skeleton-avatar shimmer" />
          <div className="feed-skeleton-body">
            <div className="shimmer" style={{ width: '30%', height: 12, borderRadius: 6, marginBottom: 8 }} />
            <div className="shimmer" style={{ width: '60%', height: 10, borderRadius: 6, marginBottom: 10 }} />
            <div className="shimmer" style={{ width: '100%', height: 160, borderRadius: 10 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
