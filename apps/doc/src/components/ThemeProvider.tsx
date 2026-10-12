import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import { siteConfig, type ThemeMode } from "../site.config"

type Theme = "light" | "dark"

interface ThemeContextType {
  theme: Theme
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const THEME_STORAGE_KEY = "theme-mode"

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return siteConfig.theme.defaultTheme
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
  return stored || siteConfig.theme.defaultTheme
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === "system") return getSystemTheme()
  return mode
}

// Get the current theme from the DOM (set by the inline script)
function getCurrentThemeFromDOM(): Theme {
  if (typeof document === "undefined") return "dark"
  return document.documentElement.classList.contains("light") ? "light" : "dark"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize with SSR-safe defaults that match what the inline script will set
  const [themeMode, setThemeModeState] = useState<ThemeMode>(
    siteConfig.theme.defaultTheme,
  )
  const [theme, setTheme] = useState<Theme>("dark")
  const [mounted, setMounted] = useState(false)

  // On mount, sync with the actual DOM state set by the inline script
  useEffect(() => {
    const storedMode = getStoredThemeMode()
    const currentTheme = getCurrentThemeFromDOM()
    setThemeModeState(storedMode)
    setTheme(currentTheme)
    setMounted(true)
  }, [])

  // Update theme when mode changes (only after mounted)
  useEffect(() => {
    if (!mounted) return

    const resolved = resolveTheme(themeMode)
    setTheme(resolved)

    // Apply theme to document
    const root = document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolved)

    // Store preference
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  }, [themeMode, mounted])

  // Listen for system theme changes
  useEffect(() => {
    if (!mounted || themeMode !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      setTheme(getSystemTheme())
      const root = document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(getSystemTheme())
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [themeMode, mounted])

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode)
  }

  const toggleTheme = () => {
    setThemeModeState((prev) => {
      if (prev === "light") return "dark"
      if (prev === "dark") return "light"
      // If system, toggle to opposite of current resolved theme
      return theme === "dark" ? "light" : "dark"
    })
  }

  return (
    <ThemeContext.Provider
      value={{ theme, themeMode, setThemeMode, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

export default ThemeProvider
