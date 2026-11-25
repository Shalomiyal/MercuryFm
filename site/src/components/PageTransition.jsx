/**
 * PageTransition — wraps route outlets with an enter/exit fade+slide animation.
 *
 * Usage in AppShell.jsx:
 *   import { useLocation } from 'react-router-dom'
 *   import PageTransition from './PageTransition'
 *
 *   const location = useLocation()
 *   // Replace <Outlet /> with:
 *   <PageTransition key={location.pathname}>
 *     <Outlet />
 *   </PageTransition>
 *
 * Also wrap in <AnimatePresence mode="wait"> in AppShell <main>:
 *   import { AnimatePresence } from 'motion/react'
 *   <AnimatePresence mode="wait">
 *     <PageTransition key={location.pathname}>
 *       <Outlet />
 *     </PageTransition>
 *   </AnimatePresence>
 *
 * Requires: npm install motion
 */
import { motion } from 'motion/react'

export default function PageTransition({ children, key }) {
  return (
    <motion.div
      key={key}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
    >
      {children}
    </motion.div>
  )
}
