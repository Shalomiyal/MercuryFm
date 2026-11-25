import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

// Applies Escape-to-close and a simple focus trap to every aria-modal dialog,
// including the existing page-level modals, without changing their markup.
export default function DialogA11y() {
  useEffect(() => {
    let activeDialog = null

    function findDialog() {
      return document.querySelector('[role="dialog"][aria-modal="true"]')
    }

    function activate(dialog) {
      if (dialog === activeDialog) return
      activeDialog = dialog
      if (dialog) {
        const preferred = dialog.querySelector('[autofocus], [data-dialog-close]')
        const target = preferred || focusableElements(dialog)[0] || dialog
        target.focus?.()
      }
    }

    function sync() {
      activate(findDialog())
    }

    function onKeyDown(event) {
      if (!activeDialog || !document.contains(activeDialog)) {
        activate(findDialog())
        if (!activeDialog) return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        const closeButton = activeDialog.querySelector(
          '[aria-label="Close"], [data-dialog-close]',
        )
        if (closeButton) closeButton.click()
        return
      }

      if (event.key !== 'Tab') return
      const elements = focusableElements(activeDialog)
      if (elements.length === 0) {
        event.preventDefault()
        activeDialog.focus?.()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal', 'hidden'],
    })
    document.addEventListener('keydown', onKeyDown)
    sync()

    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return null
}
