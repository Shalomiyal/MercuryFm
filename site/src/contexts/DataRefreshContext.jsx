import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const DataRefreshContext = createContext(null)
const STALE_AFTER_MS = 30_000

// One shared refresh signal for every data page. Realtime events, returning to
// the tab, and the manual refresh button all bump the same revision.
export function DataRefreshProvider({ children }) {
  const { profile, schemaName, loading: authLoading } = useAuth()
  const [revision, setRevision] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(() => Date.now())
  const [refreshing, setRefreshing] = useState(false)
  const lastUpdatedRef = useRef(lastUpdated)

  const bump = useCallback((_reason = 'manual') => {
    lastUpdatedRef.current = Date.now()
    setLastUpdated(lastUpdatedRef.current)
    setRevision((current) => current + 1)
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    bump('manual')
    // Give the button a paint before the page-level reload starts.
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    setRefreshing(false)
  }, [bump])

  const refreshIfStale = useCallback(() => {
    if (Date.now() - lastUpdatedRef.current >= STALE_AFTER_MS) bump('focus')
  }, [bump])

  useEffect(() => {
    if (authLoading || !schemaName) return undefined

    let channel
    try {
      channel = supabase
        .channel(`tenant-refresh:${schemaName}`)
        .on(
          'postgres_changes',
          { event: '*', schema: schemaName, table: '*' },
          () => bump('realtime'),
        )
        .subscribe()
    } catch (error) {
      console.warn('Realtime refresh is unavailable:', error?.message || error)
    }

    return () => {
      if (channel) supabase.removeChannel(channel).catch(() => {})
    }
  }, [authLoading, schemaName, profile?.id, bump])

  useEffect(() => {
    function onFocus() {
      refreshIfStale()
    }
    function onVisibilityChange() {
      if (!document.hidden) refreshIfStale()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshIfStale])

  const value = useMemo(
    () => ({ revision, lastUpdated, refreshing, refresh, refreshIfStale }),
    [revision, lastUpdated, refreshing, refresh, refreshIfStale],
  )

  return (
    <DataRefreshContext.Provider value={value}>
      {children}
    </DataRefreshContext.Provider>
  )
}

export function useDataRefresh() {
  const context = useContext(DataRefreshContext)
  if (!context) {
    throw new Error('useDataRefresh must be used inside DataRefreshProvider')
  }
  return context
}
