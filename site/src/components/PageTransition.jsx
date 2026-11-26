import { motion } from 'motion/react'

export default function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
    >
      {children}
    </motion.div>
  )
}
