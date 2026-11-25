import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setRequest({
        message,
        title: options.title || 'Please confirm',
        confirmLabel: options.confirmLabel || 'Confirm',
        tone: options.tone || 'danger',
        resolve,
      })
    })
  }, [])

  const finish = useCallback((result) => {
    setRequest((current) => {
      current?.resolve(result)
      return null
    })
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-sheet confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
          >
            <div className="confirm-icon" aria-hidden="true">!</div>
            <h2 id="confirm-title">{request.title}</h2>
            <p id="confirm-message" className="confirm-body">{request.message}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => finish(false)}
                data-dialog-close
              >
                Cancel
              </button>
              <button
                type="button"
                className={request.tone === 'danger' ? 'danger-button' : 'primary-button'}
                onClick={() => finish(true)}
                autoFocus
              >
                {request.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider')
  return context.confirm
}
