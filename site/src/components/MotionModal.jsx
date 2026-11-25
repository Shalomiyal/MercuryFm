/**
 * MotionModal — animated modal wrapper using the `motion` package.
 * Drop-in replacement for the existing modal-backdrop + modal-sheet pattern.
 *
 * Usage:
 *   import MotionModal from './MotionModal'
 *
 *   {draft && (
 *     <MotionModal onClose={() => setDraft(null)} label="org-title" size="normal">
 *       … modal content …
 *     </MotionModal>
 *   )}
 *
 * Requires: npm install motion
 */
import { AnimatePresence, motion } from 'motion/react'

const backdropVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.14 } },
}

const sheetVariants = {
  initial: { opacity: 0, y: 32, scale: 0.97 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: 20,
    scale: 0.98,
    transition: { duration: 0.15 },
  },
}

export default function MotionModal({ children, onClose, label, size = 'normal' }) {
  const sizeClass = size === 'history' ? 'modal-sheet history-sheet' : size === 'template' ? 'modal-sheet template-sheet' : 'modal-sheet'
  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        role="presentation"
        variants={backdropVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        onMouseDown={onClose}
      >
        <motion.section
          className={sizeClass}
          role="dialog"
          aria-modal="true"
          aria-labelledby={label}
          variants={sheetVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  )
}
