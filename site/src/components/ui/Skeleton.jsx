export default function Skeleton({ count = 3, className = '' }) {
  return (
    <div className={`skeleton-stack ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <span className="shimmer" />
          <span className="shimmer short" />
        </div>
      ))}
    </div>
  )
}
