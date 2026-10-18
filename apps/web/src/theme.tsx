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

/*
 * Anthracite workspace palette.
 *
 * Dark is the primary direction: near-black app ground, close surfaces, thin
 * borders, and a single blue accent reserved for primary actions and links.
 * The same hue scale is kept for light mode so both modes stay recognizable.
 * Every pair below is contrast-checked (see app.css comments and the
 * redesign report); semantic colors stay distinct from the accent.
 */
const PALETTE = {
  // App ground behind everything.
  "bg-main": {
    light: "#eef0f4",
    dark: "#0e1014",
    main: "#0e1014",
  },
  // Cards, panels, lists.
  "bg-surface": {
    light: "#ffffff",
    dark: "#181b22",
    main: "#181b22",
  },
  // Action accent: fills primary buttons. White text on #3565d4 ≈ 4.9:1.
  "bg-primary": {
    light: "#2f5fd0",
    dark: "#3565d4",
    main: "#3565d4",
  },
  // Secondary accent (teal) kept from the previous theme; sits next to the
  // blue primary and the IDE's VSCode-style blues without competing.
  "bg-secondary": {
    light: "#4db6ac",
    dark: "#26a69a",
    main: "#009688",
  },
  "bg-error": {
    light: "#d32f2f",
    dark: "#c4372f",
    main: "#c4372f",
  },
  "bg-success": {
    light: "#2e7d32",
    dark: "#2f7d46",
    main: "#2f7d46",
  },
  "bg-warning": {
    light: "#b26205",
    dark: "#b98036",
    main: "#b98036",
  },
  // Accent as text/links: #5d8cff on the dark ground ≈ 5.9:1.
  "text-primary": {
    light: "#2b55b8",
    dark: "#5d8cff",
    main: "#3565d4",
  },
  "text-main": {
    light: "#171a20",
    dark: "#f3f4f6",
    main: "#333",
  },
  // Secondary text: #b6bdc9 ≈ 9.2:1 on #0e1014, 8.0:1 on surface.
  "text-secondary": {
    light: "#454e5e",
    dark: "#b6bdc9",
    main: "#009688",
  },
  "text-error": {
    light: "#c62828",
    dark: "#f0857d",
    main: "#f44336",
  },
  "text-success": {
    light: "#2e7d32",
    dark: "#7fd39a",
    main: "#66bb6a",
  },
  "text-warning": {
    light: "#9a5b04",
    dark: "#e5b56f",
    main: "#db6809",
  },
  "text-info": {
    light: "#0277bd",
    dark: "#7cc7ff",
    main: "#0288d1",
  },
} as const

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
    typeof window === "undefined" ? "dark" : initialTheme(),
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
  // The pre-React bootstrap in index.html already set data-theme + background;
  // this keeps them authoritative after hydration.
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
        ...PALETTE,
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
