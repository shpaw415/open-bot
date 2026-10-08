import Editor, { loader } from "@monaco-editor/react"
import Box from "@shpaw415/mui-lite/Box"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Typography from "@shpaw415/mui-lite/Typography"
import type * as Monaco from "monaco-editor"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { api } from "../api"
import { type EventStream, useDebounced, useMobile } from "../hooks"
import {
  ArrowBackIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  DescriptionIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshIcon,
  SaveIcon,
  SearchIcon,
  TerminalIcon,
} from "../icons"
import {
  baseName,
  decodeContent,
  dirName,
  type FileContent,
  type FileIconToken,
  fuzzyFilterFiles,
  iconForFile,
  languageFor,
  parseEntries,
  pathSegments,
  relPath,
  type TreeEntry,
} from "./file-utils"
import { ProjectTerminal } from "./ProjectTerminal"
import { iconColors, monoFont, uiFont, vscode } from "./theme"
import type { ProjectInfo } from "./types"

loader.config({ paths: { vs: "/monaco/vs" } })

type Toast = { text: string; error?: boolean }

function FileGlyph({
  token,
  size = 16,
}: {
  token: FileIconToken
  size?: number
}) {
  const color = iconColors[token] ?? iconColors.file
  if (token === "react") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <circle cx="12" cy="12" r="2" fill={color} />
        <g stroke={color} strokeWidth="1" fill="none">
          <ellipse cx="12" cy="12" rx="9" ry="3.6" />
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="3.6"
            transform="rotate(60 12 12)"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="3.6"
            transform="rotate(120 12 12)"
          />
        </g>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill={color}
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"
      />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="7.5"
        fontFamily={monoFont}
        fontWeight="700"
        fill={color}
      >
        {token === "ts"
          ? "TS"
          : token === "js"
            ? "JS"
            : token === "json"
              ? "{}"
              : ""}
      </text>
    </svg>
  )
}

function FolderGlyph({ open, size = 16 }: { open: boolean; size?: number }) {
  return open ? (
    <FolderOpenIcon
      width={size}
      height={size}
      style={{ color: iconColors.folder }}
    />
  ) : (
    <FolderIcon
      width={size}
      height={size}
      style={{ color: iconColors.folder }}
    />
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRightIcon
      width={16}
      height={16}
      style={{
        color: vscode.sidebarFg,
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 0.1s ease",
        flexShrink: 0,
      }}
    />
  )
}

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: monoFont,
  fontSize: 14,
  fontLigatures: true,
  minimap: { enabled: true, renderCharacters: false, maxColumn: 120 },
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  renderLineHighlight: "all",
  renderWhitespace: "selection",
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true },
  scrollbar: {
    verticalScrollbarSize: 14,
    horizontalScrollbarSize: 12,
    useShadows: false,
  },
  overviewRulerBorder: false,
  automaticLayout: true,
  scrollBeyondLastLine: true,
  padding: { top: 8 },
}

export function Ide({
  project,
  onBack,
  subscribe,
}: {
  project: ProjectInfo
  onBack: () => void
  subscribe?: EventStream["subscribe"]
}) {
  const mobile = useMobile()
  const [root, setRoot] = useState<TreeEntry[] | null>(null)
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [previews, setPreviews] = useState<Record<string, FileContent>>({})
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState("")
  const [quickIndex, setQuickIndex] = useState(0)
  const [quickFiles, setQuickFiles] = useState<string[] | null>(null)
  const [sidebar, setSidebar] = useState(!mobile)
  const [cursor, setCursor] = useState({ ln: 1, col: 1 })
  const [termOpen, setTermOpen] = useState(false)

  const stateRef = useRef({ active, draft, saved, project, saving })
  stateRef.current = { active, draft, saved, project, saving }
  const quickInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const touchedRef = useRef<Set<string>>(new Set())

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current))
    }, 4200)
  }, [])

  const listDir = useCallback(
    async (dir: string): Promise<TreeEntry[]> => {
      const body = await api<unknown>(
        `/api/projects/${project.id}/files?path=${encodeURIComponent(dir)}`,
      )
      return parseEntries(body, dir).filter(
        (entry) => !(entry.name === ".git" && entry.isDir),
      )
    },
    [project.id],
  )

  const refreshTree = useCallback(async () => {
    try {
      const entries = await listDir(project.path)
      setRoot(entries)
      return entries
    } catch (error) {
      setRoot([])
      showToast(
        error instanceof Error ? error.message : "could not list the project",
        true,
      )
      return []
    }
  }, [listDir, project.path, showToast])

  /** Re-list specific directories after file events without touching others. */
  const refreshDirs = useCallback(
    async (dirs: string[]) => {
      for (const dir of dirs) {
        try {
          const entries = await listDir(dir)
          if (dir === project.path) setRoot(entries)
          else
            setChildren((current) =>
              current[dir] ? { ...current, [dir]: entries } : current,
            )
        } catch {
          // transient — the next event batch retries
        }
      }
    },
    [listDir, project.path],
  )

  const dirty = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const path of Object.keys(draft)) {
      out[path] = draft[path] !== saved[path]
    }
    return out
  }, [draft, saved])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const reloadActive = useCallback(
    async (path: string) => {
      try {
        const body = await api<unknown>(
          `/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`,
        )
        const content = decodeContent(baseName(path), body)
        if (content?.kind !== "text") return
        const viewState = editorRef.current?.saveViewState()
        setSaved((current) => ({ ...current, [path]: content.text }))
        setDraft((current) => ({ ...current, [path]: content.text }))
        const editor = editorRef.current
        if (viewState && editor) {
          requestAnimationFrame(() => editor.restoreViewState(viewState))
        }
      } catch {
        // the file may have been unlinked; the tree refresh shows it
      }
    },
    [project.id],
  )

  /** Apply a debounced batch of file events: refresh trees, reload clean active file. */
  const flushTouched = useCallback(() => {
    const files = [...touchedRef.current]
    touchedRef.current.clear()
    if (files.length === 0) return
    const dirs = new Set<string>([project.path])
    for (const file of files) {
      let dir = dirName(file)
      while (dir.startsWith(project.path) && dir.length > project.path.length) {
        dirs.add(dir)
        dir = dirName(dir)
      }
    }
    void refreshDirs([...dirs])
    const snapshot = stateRef.current
    const activePath = snapshot.active
    if (activePath && files.includes(activePath)) {
      if (dirtyRef.current[activePath])
        showToast(
          `${baseName(activePath)} changed on the desktop — your edits are unsaved`,
        )
      else void reloadActive(activePath)
    }
  }, [project.path, refreshDirs, reloadActive, showToast])
  const flushTouchedDebounced = useDebounced(flushTouched, 350)

  useEffect(() => {
    if (!subscribe) return
    return subscribe((event) => {
      let touched: string[] | null = null
      if (event.type === "project.files") {
        const props = event.properties as { files?: unknown } | undefined
        if (Array.isArray(props?.files)) touched = props.files as string[]
      } else if (
        event.type === "file.watcher.updated" ||
        event.type === "file.edited"
      ) {
        const props = event.properties as { file?: unknown } | undefined
        if (typeof props?.file === "string") touched = [props.file]
      }
      if (!touched) return
      let hit = false
      for (const file of touched) {
        if (typeof file !== "string") continue
        if (!file.startsWith(`${project.path}/`)) continue
        hit = true
        touchedRef.current.add(file)
      }
      if (hit) flushTouchedDebounced()
    })
  }, [flushTouchedDebounced, project.path, subscribe])

  useEffect(() => {
    let alive = true
    void refreshTree().then((entries) => {
      if (alive && entries.length > 0) return
      // keep the (possibly empty) root; nothing else to prime
    })
    return () => {
      alive = false
    }
  }, [refreshTree])

  const openFile = useCallback(
    async (path: string) => {
      setActive(path)
      setTabs((current) =>
        current.includes(path) ? current : [...current, path],
      )
      if (saved[path] !== undefined || previews[path] !== undefined) return
      setLoadingFile(true)
      try {
        const body = await api<unknown>(
          `/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`,
        )
        const content = decodeContent(baseName(path), body)
        if (content?.kind === "text") {
          setSaved((current) => ({ ...current, [path]: content.text }))
          setDraft((current) => ({ ...current, [path]: content.text }))
          setPreviews((current) => {
            const next = { ...current }
            delete next[path]
            return next
          })
        } else {
          setPreviews((current) => ({ ...current, [path]: content }))
        }
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "could not open the file",
          true,
        )
      } finally {
        setLoadingFile(false)
      }
    },
    [previews, project.id, saved, showToast],
  )

  const toggleDir = useCallback(
    (dir: string) => {
      const isOpen = expanded[dir]
      setExpanded((current) => ({ ...current, [dir]: !isOpen }))
      if (isOpen || children[dir]) return
      void listDir(dir)
        .then((entries) =>
          setChildren((current) => ({ ...current, [dir]: entries })),
        )
        .catch(() => {
          setExpanded((current) => ({ ...current, [dir]: false }))
          showToast("could not open the folder", true)
        })
    },
    [children, expanded, listDir, showToast],
  )

  const saveFile = useCallback(async () => {
    const snapshot = stateRef.current
    const path = snapshot.active
    if (!path || snapshot.saving) return
    const value = snapshot.draft[path]
    if (value === undefined) return
    if (value === snapshot.saved[path]) return
    setSaving(true)
    try {
      await api(
        `/api/projects/${snapshot.project.id}/file?path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: value,
        },
      )
      setSaved((current) => ({ ...current, [path]: value }))
      showToast(`Saved ${baseName(path)}`)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "could not save the file",
        true,
      )
    } finally {
      setSaving(false)
    }
  }, [showToast])

  const closeTab = useCallback((path: string) => {
    if (
      dirtyRef.current[path] &&
      !window.confirm(`Save changes to ${baseName(path)} before closing?`)
    ) {
      return
    }
    setTabs((current) => {
      const next = current.filter((item) => item !== path)
      setActive((currentActive) =>
        currentActive === path
          ? (next[next.length - 1] ?? null)
          : currentActive,
      )
      return next
    })
  }, [])

  const ensureQuickFiles = useCallback(async () => {
    if (quickFiles) return
    try {
      const body = await api<{ files?: string[] }>(
        `/api/projects/${project.id}/search`,
      )
      setQuickFiles(body.files ?? [])
    } catch {
      setQuickFiles([])
    }
  }, [project.id, quickFiles])

  const openQuickOpen = useCallback(() => {
    setQuickOpen(true)
    setQuickQuery("")
    setQuickIndex(0)
    void ensureQuickFiles()
    window.setTimeout(() => quickInputRef.current?.focus(), 30)
  }, [ensureQuickFiles])

  const results = useMemo(
    () =>
      quickOpen
        ? fuzzyFilterFiles(quickFiles ?? [], project.path, quickQuery)
        : [],
    [project.path, quickFiles, quickOpen, quickQuery],
  )

  useEffect(() => {
    setQuickIndex((current) =>
      Math.min(current, Math.max(results.length - 1, 0)),
    )
  }, [results.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void saveFile()
        return
      }
      if (mod && event.key.toLowerCase() === "p") {
        event.preventDefault()
        openQuickOpen()
        return
      }
      if (mod && event.key === "`") {
        event.preventDefault()
        setTermOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [openQuickOpen, saveFile])

  const quickPick = useCallback(
    (path: string) => {
      setQuickOpen(false)
      void openFile(path)
    },
    [openFile],
  )

  function rows(entries: TreeEntry[], depth: number): ReactNode[] {
    const out: ReactNode[] = []
    for (const entry of entries) {
      const isOpen = expanded[entry.path] === true
      const selected = active === entry.path
      const kids = children[entry.path]
      out.push(
        <Box
          key={entry.path}
          onClick={() => {
            if (entry.isDir) toggleDir(entry.path)
            else void openFile(entry.path)
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "2px",
            height: 22,
            paddingRight: 1,
            cursor: "pointer",
            backgroundColor: selected ? vscode.listActive : undefined,
            color: vscode.sidebarFg,
            fontSize: 13,
            whiteSpace: "nowrap",
            "&:hover": {
              backgroundColor: selected ? vscode.listActive : vscode.listHover,
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              width: depth * 8 + 12,
              justifyContent: "flex-end",
            }}
          >
            {entry.isDir ? <Chevron open={isOpen} /> : null}
          </Box>
          {entry.isDir ? (
            <FolderGlyph open={isOpen} />
          ) : (
            <FileGlyph token={iconForFile(entry.name)} />
          )}
          <Box
            Element="span"
            sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {entry.name}
          </Box>
        </Box>,
      )
      if (entry.isDir && isOpen) {
        if (kids) out.push(...rows(kids, depth + 1))
        else
          out.push(
            <Box
              key={`loading-${entry.path}`}
              sx={{
                display: "flex",
                alignItems: "center",
                height: 22,
                paddingLeft: depth * 8 + 32,
                color: vscode.muted,
                fontSize: 12,
              }}
            >
              Loading…
            </Box>,
          )
      }
    }
    return out
  }

  const activeBase = active ? baseName(active) : null
  const activePreview = active ? previews[active] : undefined

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        position: "relative",
        fontFamily: uiFont,
        backgroundColor: vscode.editorBg,
        color: vscode.editorFg,
        overflow: "hidden",
      }}
    >
      {/* Title bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          height: 35,
          flexShrink: 0,
          backgroundColor: vscode.titleBarBg,
          color: vscode.titleBarFg,
          fontSize: 12,
          padding: "0 8px",
          gap: 1,
        }}
      >
        <TitleBarIcon label="Back to projects" onClick={onBack}>
          <ArrowBackIcon width={18} height={18} />
        </TitleBarIcon>
        <TitleBarIcon
          label={sidebar ? "Hide explorer" : "Show explorer"}
          onClick={() => setSidebar((current) => !current)}
        >
          <DescriptionIcon width={18} height={18} />
        </TitleBarIcon>
        <TitleBarIcon
          label={termOpen ? "Hide terminal" : "Show terminal"}
          onClick={() => setTermOpen((current) => !current)}
        >
          <TerminalIcon width={18} height={18} />
        </TitleBarIcon>
        <Box
          sx={{
            flex: 1,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activeBase ? `${activeBase} — ${project.name}` : project.name}
        </Box>
        <Box sx={{ width: mobile ? 192 : 152 }} />
      </Box>

      {/* Body */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Activity bar */}
        {!mobile ? (
          <Box
            sx={{
              width: 48,
              flexShrink: 0,
              backgroundColor: vscode.activityBarBg,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: 1,
              gap: "2px",
            }}
          >
            <ActivityIcon
              label="Explorer"
              active={sidebar}
              onClick={() => setSidebar((current) => !current)}
            >
              <DescriptionIcon width={24} height={24} />
            </ActivityIcon>
            <ActivityIcon
              label="Quick open"
              active={false}
              onClick={openQuickOpen}
            >
              <SearchIcon width={24} height={24} />
            </ActivityIcon>
          </Box>
        ) : null}

        {/* Explorer */}
        {sidebar ? (
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{
              ...(mobile
                ? {
                    position: "absolute",
                    left: 0,
                    top: 35,
                    bottom: 0,
                    zIndex: 30,
                    boxShadow: "0 0 12px rgba(0,0,0,0.6)",
                  }
                : {}),
              width: mobile ? "min(75vw, 280px)" : 240,
              flexShrink: 0,
              backgroundColor: vscode.sidebarBg,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              borderRight: `1px solid ${vscode.border}`,
            }}
          >
            <Box
              sx={{
                fontSize: 11,
                letterSpacing: "0.04em",
                color: vscode.sectionHeaderFg,
                padding: "8px 20px 8px 20px",
                flexShrink: 0,
              }}
            >
              EXPLORER
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "2px",
                padding: "3px 8px 3px 12px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                color: vscode.sidebarFg,
                flexShrink: 0,
              }}
            >
              <Chevron open />
              <Box
                Element="span"
                sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {project.name}
              </Box>
              <IconAction
                label="Refresh explorer"
                onClick={() => {
                  setChildren({})
                  void refreshTree()
                }}
              >
                <RefreshIcon width={14} height={14} />
              </IconAction>
            </Box>
            <Box
              sx={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                minHeight: 0,
                "&::-webkit-scrollbar": { width: 10 },
                "&::-webkit-scrollbar-thumb": {
                  background: vscode.scrollbar,
                  borderRadius: 0,
                },
              }}
            >
              {root === null ? (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    paddingTop: 3,
                  }}
                >
                  <CircularProgress size={1.4} />
                </Box>
              ) : root.length === 0 ? (
                <Box
                  sx={{
                    padding: "8px 20px",
                    color: vscode.muted,
                    fontSize: 12,
                  }}
                >
                  Empty project — ask the agent to add files.
                </Box>
              ) : (
                rows(root, 0)
              )}
            </Box>
          </Box>
        ) : null}

        {/* Editor area */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            minHeight: 0,
          }}
        >
          {/* Tabs */}
          <Box
            sx={{
              display: "flex",
              alignItems: "stretch",
              height: 35,
              flexShrink: 0,
              backgroundColor: vscode.tabBarBg,
              overflowX: "auto",
              overflowY: "hidden",
              "&::-webkit-scrollbar": { height: 3 },
              "&::-webkit-scrollbar-thumb": { background: vscode.scrollbar },
            }}
          >
            {tabs.map((path) => {
              const isActive = path === active
              const isDirty = dirty[path] === true
              return (
                <Box
                  key={path}
                  onClick={() => setActive(path)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "0 8px 0 12px",
                    backgroundColor: isActive
                      ? vscode.tabActiveBg
                      : vscode.tabInactiveBg,
                    color: isActive ? vscode.tabActiveFg : vscode.tabFg,
                    fontSize: 13,
                    cursor: "pointer",
                    flexShrink: 0,
                    borderRight: `1px solid ${vscode.tabBorder}`,
                    position: "relative",
                    "&:hover .ob-tab-close": { visibility: "visible" },
                  }}
                >
                  <FileGlyph token={iconForFile(baseName(path))} size={15} />
                  <Box Element="span" sx={{ whiteSpace: "nowrap" }}>
                    {baseName(path)}
                  </Box>
                  <Box
                    className="ob-tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(path)
                    }}
                    sx={{
                      visibility: isDirty ? "visible" : "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      borderRadius: "5px",
                      "&:hover": { backgroundColor: "rgba(255,255,255,0.1)" },
                    }}
                    title="Close (unsaved changes)"
                  >
                    {isDirty ? (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: vscode.tabActiveFg,
                        }}
                      />
                    ) : (
                      <CloseIcon width={14} height={14} />
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>

          {/* Breadcrumbs */}
          {active ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "2px",
                height: 22,
                flexShrink: 0,
                padding: "0 12px",
                fontSize: 12,
                color: vscode.breadcrumbFg,
                backgroundColor: vscode.editorBg,
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {pathSegments(relPath(project.path, active)).map(
                (segment, index, all) => (
                  <Box
                    key={all.slice(0, index + 1).join("/")}
                    sx={{ display: "flex", alignItems: "center", gap: "2px" }}
                  >
                    {index > 0 ? (
                      <ChevronRightIcon width={14} height={14} />
                    ) : null}
                    {index === all.length - 1 ? (
                      <FileGlyph token={iconForFile(segment)} size={13} />
                    ) : null}
                    <Box Element="span">{segment}</Box>
                  </Box>
                ),
              )}
            </Box>
          ) : null}

          {/* File surface */}
          <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
            {loadingFile && active ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CircularProgress size={1.6} />
              </Box>
            ) : null}
            {!loadingFile && active && activePreview ? (
              activePreview.kind === "image" ? (
                <Box
                  sx={{
                    height: "100%",
                    overflow: "auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 2,
                  }}
                >
                  <Box
                    Element="img"
                    src={activePreview.src}
                    alt={activeBase ?? "preview"}
                    sx={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                    }}
                  />
                </Box>
              ) : (
                <Box
                  sx={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: vscode.muted,
                    fontSize: 13,
                  }}
                >
                  This binary file cannot be displayed.
                </Box>
              )
            ) : null}
            {!loadingFile && active && !activePreview && active !== null ? (
              draft[active] !== undefined ? (
                <Editor
                  path={active}
                  language={languageFor(active)}
                  value={draft[active]}
                  theme="vs-dark"
                  options={EDITOR_OPTIONS}
                  loading={<CircularProgress size={1.6} />}
                  onMount={(editor) => {
                    editorRef.current = editor
                    editor.onDidChangeCursorPosition((event) => {
                      setCursor({
                        ln: event.position.lineNumber,
                        col: event.position.column,
                      })
                    })
                  }}
                  onChange={(value) => {
                    if (active === null) return
                    const text = value ?? ""
                    setDraft((current) => ({ ...current, [active]: text }))
                  }}
                />
              ) : null
            ) : null}
            {!active && !loadingFile ? (
              <Box
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  color: "#565656",
                }}
              >
                <Typography
                  sx={{
                    fontSize: 42,
                    fontWeight: 200,
                    letterSpacing: "0.02em",
                  }}
                >
                  {project.name}
                </Typography>
                <Box sx={{ fontSize: 13, color: vscode.muted }}>
                  Open a file from the explorer
                </Box>
                {!mobile ? (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      marginTop: 2,
                      fontSize: 12,
                    }}
                  >
                    <ShortcutRow keys="Ctrl+P" text="Quick open a file" />
                    <ShortcutRow keys="Ctrl+S" text="Save the active file" />
                    <ShortcutRow keys="Ctrl+`" text="Toggle the terminal" />
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Box>

          {/* Terminal panel */}
          {termOpen ? (
            <Box
              sx={{
                height: 280,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderTop: `1px solid ${vscode.border}`,
                backgroundColor: vscode.editorBg,
                minHeight: 0,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  height: 30,
                  flexShrink: 0,
                  padding: "0 8px",
                  gap: "6px",
                  fontSize: 11,
                  color: vscode.sidebarFg,
                }}
              >
                <TerminalIcon width={14} height={14} />
                <Box
                  Element="span"
                  sx={{ fontWeight: 700, letterSpacing: "0.04em" }}
                >
                  TERMINAL
                </Box>
                <Box Element="span" sx={{ color: vscode.muted }}>
                  bash — {project.name}
                </Box>
                <Box sx={{ flex: 1 }} />
                <IconAction
                  label="Kill terminal"
                  onClick={() => {
                    setTermOpen(false)
                  }}
                >
                  <DeleteIcon width={15} height={15} />
                </IconAction>
                <IconAction
                  label="Hide panel"
                  onClick={() => setTermOpen(false)}
                >
                  <ChevronDownIcon width={16} height={16} />
                </IconAction>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                <ProjectTerminal project={project} />
              </Box>
            </Box>
          ) : null}

          {/* Status bar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              height: 22,
              flexShrink: 0,
              backgroundColor: vscode.statusBg,
              color: vscode.statusFg,
              fontSize: 12,
              padding: "0 8px",
              gap: 0.5,
            }}
          >
            <StatusBarItem>
              <ChevronRightIcon
                width={13}
                height={13}
                style={{ transform: "rotate(180deg)" }}
              />
              <ChevronRightIcon width={13} height={13} />
              <Box Element="span" sx={{ marginLeft: "4px" }}>
                {project.name}
              </Box>
            </StatusBarItem>
            {saving ? (
              <StatusBarItem>
                <SaveIcon width={13} height={13} />
                <Box Element="span" sx={{ marginLeft: "4px" }}>
                  Saving…
                </Box>
              </StatusBarItem>
            ) : null}
            <Box sx={{ flex: 1 }} />
            {active ? (
              <>
                <StatusBarItem>
                  Ln {cursor.ln}, Col {cursor.col}
                </StatusBarItem>
                <StatusBarItem>Spaces: 2</StatusBarItem>
                <StatusBarItem>UTF-8</StatusBarItem>
                <StatusBarItem>{languageFor(active)}</StatusBarItem>
              </>
            ) : null}
          </Box>

          {/* Toasts */}
          {toast ? (
            <Box
              sx={{
                position: "absolute",
                right: 12,
                bottom: 34,
                zIndex: 40,
                backgroundColor: vscode.widgetBg,
                border: `1px solid ${toast.error ? vscode.errorBorder : vscode.widgetBorder}`,
                color: vscode.editorFg,
                fontSize: 12,
                padding: "10px 14px",
                maxWidth: 360,
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              }}
            >
              {toast.text}
            </Box>
          ) : null}

          {/* Quick open */}
          {quickOpen ? (
            <Box
              onClick={() => setQuickOpen(false)}
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
                backgroundColor: "rgba(0,0,0,0.25)",
              }}
            >
              <Box
                onClick={(event) => event.stopPropagation()}
                sx={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "min(600px, calc(100% - 24px))",
                  marginTop: 0,
                  backgroundColor: vscode.widgetBg,
                  border: `1px solid ${vscode.widgetBorder}`,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: 440,
                }}
              >
                <Box
                  Element="input"
                  ref={quickInputRef}
                  value={quickQuery}
                  placeholder="Search files by name"
                  onChange={(event) => {
                    setQuickQuery((event.target as HTMLInputElement).value)
                    setQuickIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation()
                      setQuickOpen(false)
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault()
                      setQuickIndex((current) =>
                        Math.min(current + 1, results.length - 1),
                      )
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault()
                      setQuickIndex((current) => Math.max(current - 1, 0))
                    } else if (event.key === "Enter") {
                      const pick = results[quickIndex]
                      if (pick) quickPick(pick)
                    }
                  }}
                  sx={{
                    backgroundColor: vscode.inputBg,
                    border: `1px solid #007fd4`,
                    color: vscode.editorFg,
                    fontSize: 13,
                    padding: "6px 10px",
                    margin: "8px",
                    outline: "none",
                    fontFamily: uiFont,
                    "&::placeholder": { color: vscode.muted },
                  }}
                />
                <Box sx={{ overflowY: "auto", paddingBottom: 1 }}>
                  {quickFiles === null ? (
                    <Box
                      sx={{
                        padding: "6px 18px",
                        color: vscode.muted,
                        fontSize: 12,
                      }}
                    >
                      Loading files…
                    </Box>
                  ) : results.length === 0 ? (
                    <Box
                      sx={{
                        padding: "6px 18px",
                        color: vscode.muted,
                        fontSize: 12,
                      }}
                    >
                      No matching files
                    </Box>
                  ) : (
                    results.map((path, index) => (
                      <Box
                        key={path}
                        onClick={() => quickPick(path)}
                        onMouseEnter={() => setQuickIndex(index)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "4px 12px",
                          fontSize: 13,
                          cursor: "pointer",
                          color: vscode.editorFg,
                          backgroundColor:
                            index === quickIndex
                              ? vscode.quickActiveBg
                              : undefined,
                        }}
                      >
                        <FileGlyph
                          token={iconForFile(baseName(path))}
                          size={15}
                        />
                        <Box Element="span">{baseName(path)}</Box>
                        <Box
                          Element="span"
                          sx={{
                            color: vscode.muted,
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {relPath(project.path, dirName(path))}
                        </Box>
                      </Box>
                    ))
                  )}
                </Box>
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
      {mobile && sidebar ? (
        <Box
          onClick={() => setSidebar(false)}
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 25,
            backgroundColor: "rgba(0,0,0,0.35)",
          }}
        />
      ) : null}
    </Box>
  )
}

function TitleBarIcon({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Box
      title={label}
      aria-label={label}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 26,
        borderRadius: "5px",
        cursor: "pointer",
        color: vscode.titleBarFg,
        "&:hover": { backgroundColor: "rgba(255,255,255,0.1)" },
      }}
    >
      {children}
    </Box>
  )
}

function ActivityIcon({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Box
      title={label}
      aria-label={label}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 48,
        height: 48,
        cursor: "pointer",
        color: active ? vscode.activityBarActiveFg : vscode.activityBarFg,
        borderLeft: `2px solid ${active ? vscode.activityBarActiveFg : "transparent"}`,
        "&:hover": { color: vscode.activityBarActiveFg },
      }}
    >
      {children}
    </Box>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Box
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "4px",
        cursor: "pointer",
        color: vscode.sidebarFg,
        "&:hover": { backgroundColor: "rgba(255,255,255,0.12)" },
      }}
    >
      {children}
    </Box>
  )
}

function StatusBarItem({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        height: 22,
        padding: "0 8px",
        whiteSpace: "nowrap",
        "&:hover": { backgroundColor: "rgba(255,255,255,0.12)" },
      }}
    >
      {children}
    </Box>
  )
}

function ShortcutRow({ keys, text }: { keys: string; text: string }) {
  return (
    <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <Box
        Element="kbd"
        sx={{
          backgroundColor: vscode.inputBg,
          border: `1px solid ${vscode.widgetBorder}`,
          borderRadius: "3px",
          padding: "1px 6px",
          fontFamily: monoFont,
          fontSize: 11,
        }}
      >
        {keys}
      </Box>
      <Box Element="span">{text}</Box>
    </Box>
  )
}
