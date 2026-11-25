import Skeleton from './Skeleton'

export default function RouteFallback() {
  return (
    <div className="content-page" role="status" aria-live="polite">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Loading</p>
          <h2>Preparing your page…</h2>
        </div>
      </div>
      <Skeleton count={4} />
    </div>
  )
}
