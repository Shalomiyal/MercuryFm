import { useEffect, useRef } from 'react'
import { animate } from 'motion'

export default function AnimatedNumber({ value, className }) {
  const ref = useRef(null)
  const prevRef = useRef(0)

  useEffect(() => {
    const target = Number(value) || 0
    const start = prevRef.current
    prevRef.current = target

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || start === target) {
      if (ref.current) ref.current.textContent = String(target)
      return undefined
    }

    const controls = animate(start, target, {
      duration: 0.25,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = String(Math.round(v))
      },
    })
    return () => controls.stop()
  }, [value])

  return (
    <strong ref={ref} className={className}>
      {Number(value) || 0}
    </strong>
  )
}
