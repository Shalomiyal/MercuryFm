/**
 * AnimatedNumber — smoothly counts up from 0 to `value` on mount.
 * Uses the `motion` animate() imperative API.
 *
 * Usage:
 *   import AnimatedNumber from './AnimatedNumber'
 *   <AnimatedNumber value={readyCount} />
 *
 * Requires: npm install motion
 */
import { useEffect, useRef } from 'react'
import { animate } from 'motion'

export default function AnimatedNumber({ value, className }) {
  const ref = useRef(null)

  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.75,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = Math.round(v)
      },
    })
    return () => controls.stop()
  }, [value])

  return <strong ref={ref} className={className}>0</strong>
}
