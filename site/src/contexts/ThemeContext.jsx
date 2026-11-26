import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = 'worktrack:theme'
const LEGACY_KEY = 'mercuryfm:theme'
const ThemeContext = createContext(null)

function initialMode() {
  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    /* storage may be disabled */
  }
  return 'system'
}

function getSystemTheme() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeModeState] = useState(initialMode)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [])

  const theme = themeMode === 'system' ? systemTheme : themeMode

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, themeMode)
    } catch {
      /* storage may be disabled */
    }
  }, [theme, themeMode])

  const setThemeMode = useCallback((nextMode) => {
    if (nextMode === 'light' || nextMode === 'dark' || nextMode === 'system') {
      setThemeModeState(nextMode)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeModeState((current) => {
      const resolved = current === 'system' ? getSystemTheme() : current
      return resolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const value = useMemo(
    () => ({ theme, themeMode, setThemeMode, toggleTheme }),
    [theme, themeMode, setThemeMode, toggleTheme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
