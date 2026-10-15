import { createContext, useContext } from "react"
import type { ThemeMode } from "../theme"

export type VscodePalette = {
  editorBg: string
  editorFg: string
  sidebarBg: string
  sidebarFg: string
  sectionHeaderFg: string
  sectionBorder: string
  activityBarBg: string
  activityBarFg: string
  activityBarActiveFg: string
  titleBarBg: string
  titleBarFg: string
  tabBarBg: string
  tabActiveBg: string
  tabInactiveBg: string
  tabFg: string
  tabActiveFg: string
  tabBorder: string
  border: string
  indentGuide: string
  listHover: string
  listActive: string
  listInactive: string
  inputBg: string
  inputBorder: string
  widgetBg: string
  widgetBorder: string
  quickActiveBg: string
  breadcrumbFg: string
  statusBg: string
  statusFg: string
  statusOffBg: string
  muted: string
  scrollbar: string
  errorBg: string
  errorBorder: string
  hoverOverlay: string
  focusBorder: string
  watermarkFg: string
}

/** VSCode Dark+ palette used by the IDE shell. */
export const vscodeDark: VscodePalette = {
  editorBg: "#1e1e1e",
  editorFg: "#d4d4d4",
  sidebarBg: "#252526",
  sidebarFg: "#cccccc",
  sectionHeaderFg: "#c5c5c5",
  sectionBorder: "#37373d",
  activityBarBg: "#333333",
  activityBarFg: "#858585",
  activityBarActiveFg: "#ffffff",
  titleBarBg: "#3c3c3c",
  titleBarFg: "#cccccc",
  tabBarBg: "#252526",
  tabActiveBg: "#1e1e1e",
  tabInactiveBg: "#2d2d2d",
  tabFg: "#969696",
  tabActiveFg: "#ffffff",
  tabBorder: "#252526",
  border: "#333333",
  indentGuide: "#404040",
  listHover: "#2a2d2e",
  listActive: "#094771",
  listInactive: "#37373d",
  inputBg: "#3c3c3c",
  inputBorder: "#3c3c3c",
  widgetBg: "#252526",
  widgetBorder: "#454545",
  quickActiveBg: "#04395e",
  breadcrumbFg: "#a9a9a9",
  statusBg: "#007acc",
  statusFg: "#ffffff",
  statusOffBg: "#16825d",
  muted: "#8b8b8b",
  scrollbar: "rgba(121, 121, 121, 0.4)",
  errorBg: "#3c1e1e",
  errorBorder: "#be1100",
  hoverOverlay: "rgba(255, 255, 255, 0.1)",
  focusBorder: "#007fd4",
  watermarkFg: "#565656",
}

/** VSCode Light+ palette used by the IDE shell. */
export const vscodeLight: VscodePalette = {
  editorBg: "#ffffff",
  editorFg: "#333333",
  sidebarBg: "#f3f3f3",
  sidebarFg: "#3b3b3b",
  sectionHeaderFg: "#6f6f6f",
  sectionBorder: "#e5e5e5",
  activityBarBg: "#e8e8e8",
  activityBarFg: "#767676",
  activityBarActiveFg: "#333333",
  titleBarBg: "#dddddd",
  titleBarFg: "#333333",
  tabBarBg: "#f3f3f3",
  tabActiveBg: "#ffffff",
  tabInactiveBg: "#ececec",
  tabFg: "#6f6f6f",
  tabActiveFg: "#333333",
  tabBorder: "#f3f3f3",
  border: "#e5e5e5",
  indentGuide: "#d3d3d3",
  listHover: "#e8e8e8",
  listActive: "#cce4f7",
  listInactive: "#e4e6f1",
  inputBg: "#ffffff",
  inputBorder: "#cecece",
  widgetBg: "#f3f3f3",
  widgetBorder: "#c8c8c8",
  quickActiveBg: "#cce4f7",
  breadcrumbFg: "#6f6f6f",
  statusBg: "#007acc",
  statusFg: "#ffffff",
  statusOffBg: "#16825d",
  muted: "#717171",
  scrollbar: "rgba(100, 100, 100, 0.4)",
  errorBg: "#f2dede",
  errorBorder: "#be1100",
  hoverOverlay: "rgba(0, 0, 0, 0.08)",
  focusBorder: "#0090f7",
  watermarkFg: "#b0b0b0",
}

export function vscodeTheme(mode: ThemeMode): VscodePalette {
  return mode === "dark" ? vscodeDark : vscodeLight
}

export const VscodeContext = createContext<VscodePalette>(vscodeDark)

export function useVscode(): VscodePalette {
  return useContext(VscodeContext)
}

export type TerminalPalette = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightBlue: string
  brightGreen: string
  brightCyan: string
}

const terminalDark: TerminalPalette = {
  background: vscodeDark.editorBg,
  foreground: vscodeDark.editorFg,
  cursor: "#aeafad",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightBlue: "#3b8eea",
  brightGreen: "#23d18b",
  brightCyan: "#29b8db",
}

const terminalLight: TerminalPalette = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightBlue: "#0451a5",
  brightGreen: "#00bc00",
  brightCyan: "#0598bc",
}

export function terminalTheme(mode: ThemeMode): TerminalPalette {
  return mode === "dark" ? terminalDark : terminalLight
}

export const uiFont =
  "-apple-system, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif"
export const monoFont =
  "'SF Mono', Menlo, Monaco, Consolas, 'Droid Sans Mono', 'Courier New', monospace"

/** File-type colors approximating the VSCode Seti icon theme. */
export const iconColors: Record<string, string> = {
  ts: "#519aba",
  js: "#cbcb41",
  react: "#519aba",
  json: "#cbcb41",
  python: "#519aba",
  html: "#cc6d2e",
  css: "#519aba",
  markdown: "#519aba",
  image: "#a074c4",
  shell: "#4d5a5e",
  git: "#e1533e",
  lock: "#8dc149",
  config: "#6d8086",
  doc: "#8b8b8b",
  file: "#8b8b8b",
  folder: "#c09553",
}
