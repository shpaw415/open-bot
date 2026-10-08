import CssBaseline from "@shpaw415/mui-lite/CssBaseline"
import { DefaultTheme, ThemeProvider } from "@shpaw415/mui-lite/theme"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import "@shpaw415/mui-lite/style.css"

export type ThemeMode = "light" | "dark"

const STORAGE_KEY = "ob-theme"

function systemTheme(): ThemeMode {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark"
  }
  return "light"
}

function initialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {
    // private mode / SSR — fall through to system
  }
  return systemTheme()
}

type ThemeModeContextValue = {
  mode: ThemeMode
  toggle: () => void
  setMode: (mode: ThemeMode) => void
}

// The mui-lite default secondary is violet; teal sits better next to the
// blue primary and the IDE's VSCode-style blues.
const SECONDARY = {
  "bg-secondary": {
    light: "#4db6ac",
    dark: "#26a69a",
    main: "#009688",
  },
  "text-secondary": {
    light: "#00897b",
    dark: "#4db6ac",
    main: "#009688",
  },
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: "light",
  toggle: () => {},
  setMode: () => {},
})

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext)
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === "undefined" ? "light" : initialTheme(),
  )

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage unavailable — theme still applies for the session
    }
  }, [])

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark"
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  // Follow the OS while the user has no explicit choice stored.
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      stored = null
    }
    if (stored === "light" || stored === "dark") return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const update = (event: MediaQueryListEvent) =>
      setModeState(event.matches ? "dark" : "light")
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  // Keep <meta name="color-scheme"> and <html> in sync for native controls.
  useEffect(() => {
    document.documentElement.dataset.theme = mode
    document.documentElement.style.colorScheme = mode
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]',
    )
    if (!meta) {
      meta = document.createElement("meta")
      meta.name = "color-scheme"
      document.head.appendChild(meta)
    }
    meta.content = mode
  }, [mode])

  const theme = useMemo(
    () =>
      ({
        ...DefaultTheme,
        ...SECONDARY,
        theme: mode,
      }) as typeof DefaultTheme,
    [mode],
  )
  const value = useMemo(
    () => ({ mode, toggle, setMode }),
    [mode, toggle, setMode],
  )

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider
        theme={theme}
        WrapperElement="div"
        sx={{
          height: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  )
}
