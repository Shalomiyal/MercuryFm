import { useCallback, useEffect, useState } from 'react'

export function usePagination(total, initial = 12, step = 12) {
  const [visibleCount, setVisibleCount] = useState(initial)

  useEffect(() => {
    setVisibleCount(initial)
  }, [total, initial])

  const showMore = useCallback(() => {
    setVisibleCount((current) => Math.min(total, current + step))
  }, [total, step])

  return {
    visibleCount,
    remaining: Math.max(0, total - visibleCount),
    showMore,
    visible: (items) => (items || []).slice(0, visibleCount),
  }
}
