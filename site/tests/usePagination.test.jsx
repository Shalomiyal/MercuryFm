import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePagination } from '../src/hooks/usePagination'

describe('usePagination', () => {
  it('shows the first page and reveals more on demand', () => {
    const items = Array.from({ length: 30 }, (_, i) => i)
    const { result } = renderHook(() => usePagination(items.length, 12, 12))

    expect(result.current.visible(items)).toHaveLength(12)
    expect(result.current.remaining).toBe(18)

    act(() => result.current.showMore())
    expect(result.current.visible(items)).toHaveLength(24)
    expect(result.current.remaining).toBe(6)

    act(() => result.current.showMore())
    expect(result.current.visible(items)).toHaveLength(30)
    expect(result.current.remaining).toBe(0)
  })

  it('resets when the total changes', () => {
    const { result, rerender } = renderHook(({ total }) => usePagination(total, 5, 5), {
      initialProps: { total: 20 },
    })
    act(() => result.current.showMore())
    expect(result.current.visibleCount).toBe(10)

    rerender({ total: 2 })
    expect(result.current.visibleCount).toBe(5)
    expect(result.current.remaining).toBe(0)
  })
})
