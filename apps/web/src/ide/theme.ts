/** VSCode Dark+ palette used by the IDE shell. */
export const vscode = {
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
} as const

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
