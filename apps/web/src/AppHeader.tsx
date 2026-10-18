import Avatar from "@shpaw415/mui-lite/Avatar"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import ClickAwayListener from "@shpaw415/mui-lite/ClickAwayListener"
import Divider from "@shpaw415/mui-lite/Divider"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Menu from "@shpaw415/mui-lite/Menu"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { api, type Me } from "./api"
import { useOverlayA11y } from "./dialog-a11y"
import {
  AdminPanelSettingsIcon,
  ChatIcon,
  ChevronRightIcon,
  CloseIcon,
  DarkModeIcon,
  ExtensionIcon,
  FolderIcon,
  LightModeIcon,
  LogoutIcon,
  MenuIcon,
  NotificationsIcon,
  NotificationsNoneIcon,
  NotificationsOffIcon,
  SearchIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "./icons"
import {
  markAllNoticesRead,
  markNoticeRead,
  type NoticeItem,
  readNotices,
  subscribeNotices,
  unreadNoticeCount,
} from "./notices"
import { type NativePermission, readNativePermission } from "./notify"
import {
  playNotifySound,
  readNotifySound,
  writeNotifySound,
} from "./notify-sound"
import {
  flattenSearchGroups,
  initialSearchResults,
  moveSearchSelection,
  runSearch,
  type SearchEntry,
  type SearchGroup,
  searchAppEntries,
  searchNavEntries,
  searchProjectEntries,
  searchThreadEntries,
} from "./search"
import { Tip } from "./Tip"
import { formatAgo } from "./time"

// ---- Search data: account-scoped, cached per identity ----------------------

type SearchSession = { id: string; title?: string; updatedAt?: number }
type SearchProject = { id: string; name: string }

type SearchDataState = {
  sessions: SearchSession[]
  projects: SearchProject[]
  sessionsStatus: "idle" | "loading" | "ready" | "error"
  projectsStatus: "idle" | "loading" | "ready" | "error"
  sessionsError: string
  projectsError: string
}

const emptySearchData: SearchDataState = {
  sessions: [],
  projects: [],
  sessionsStatus: "idle",
  projectsStatus: "idle",
  sessionsError: "",
  projectsError: "",
}

let searchDataCache: {
  identity: string
  sessions: SearchSession[]
  projects: SearchProject[]
} | null = null
let searchDataInflight = false

function cacheFor(identity: string): SearchDataState {
  return searchDataCache && searchDataCache.identity === identity
    ? {
        ...emptySearchData,
        sessions: searchDataCache.sessions,
        projects: searchDataCache.projects,
        sessionsStatus: "ready",
        projectsStatus: "ready",
      }
    : { ...emptySearchData }
}

/**
 * Loads conversations + projects for the header search on first need, then
 * stale-while-revalidate on every open. Both endpoints are account-scoped;
 * results live behind the identity key and never mix across accounts.
 */
function useSearchData(identity: string) {
  const [state, setState] = useState<SearchDataState>(() => cacheFor(identity))
  const seqRef = useRef(0)

  useEffect(() => {
    // Account switch: previous user's data must not survive into the panel.
    if (searchDataCache && searchDataCache.identity !== identity)
      searchDataCache = null
    setState(cacheFor(identity))
  }, [identity])

  const load = useCallback(() => {
    if (searchDataInflight) return
    searchDataInflight = true
    const seq = ++seqRef.current
    setState((current) =>
      current.sessionsStatus === "idle" || current.projectsStatus === "idle"
        ? {
            ...current,
            sessionsStatus:
              current.sessionsStatus === "idle"
                ? "loading"
                : current.sessionsStatus,
            projectsStatus:
              current.projectsStatus === "idle"
                ? "loading"
                : current.projectsStatus,
          }
        : current,
    )
    const sessionsPromise = fetch("/api/opencode/session")
      .then((res) => {
        if (!res.ok) throw new Error(`sessions ${res.status}`)
        return res.json()
      })
      .then((list: unknown) =>
        (Array.isArray(list) ? list : [])
          .map((item) => item as SearchSession & { parentID?: string })
          .filter(
            (item) =>
              item.id &&
              !item.parentID &&
              !item.title?.startsWith("cron-run:") &&
              !item.title?.startsWith("worker:"),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            updatedAt: item.updatedAt,
          })),
      )
    const projectsPromise = api<{ projects?: SearchProject[] }>(
      "/api/projects",
    ).then((body) => body.projects ?? [])
    void Promise.allSettled([sessionsPromise, projectsPromise]).then(
      ([sessions, projects]) => {
        searchDataInflight = false
        if (seq !== seqRef.current) return
        setState((current) => {
          const next: SearchDataState = {
            sessions:
              sessions.status === "fulfilled"
                ? sessions.value
                : current.sessions,
            projects:
              projects.status === "fulfilled"
                ? projects.value
                : current.projects,
            sessionsStatus:
              sessions.status === "fulfilled"
                ? "ready"
                : current.sessions.length
                  ? "ready"
                  : "error",
            projectsStatus:
              projects.status === "fulfilled"
                ? "ready"
                : current.projects.length
                  ? "ready"
                  : "error",
            sessionsError:
              sessions.status === "fulfilled"
                ? ""
                : String(sessions.reason ?? "failed"),
            projectsError:
              projects.status === "fulfilled"
                ? ""
                : String(projects.reason ?? "failed"),
          }
          if (
            sessions.status === "fulfilled" &&
            projects.status === "fulfilled"
          )
            searchDataCache = {
              identity,
              sessions: next.sessions,
              projects: next.projects,
            }
          return next
        })
      },
    )
  }, [identity])

  return { state, load }
}

// ---- Notifications ----------------------------------------------------------

function useNoticesSnapshot() {
  return useSyncExternalStore(subscribeNotices, readNotices, readNotices)
}

function useUnreadNoticeCount() {
  return useSyncExternalStore(
    subscribeNotices,
    unreadNoticeCount,
    unreadNoticeCount,
  )
}

const NOTICE_ICONS: Record<NoticeItem["kind"], React.ReactNode> = {
  reply: <ChatIcon width={16} height={16} />,
  plugin: <ExtensionIcon width={16} height={16} />,
  security: <AdminPanelSettingsIcon width={16} height={16} />,
}

function NoticeRow({
  notice,
  onOpen,
}: {
  notice: NoticeItem
  onOpen: (notice: NoticeItem) => void
}) {
  return (
    <button
      type="button"
      className={`ob-notice-row${notice.read ? "" : " ob-notice-unread"}`}
      onClick={() => onOpen(notice)}
    >
      <span className="ob-notice-icon" aria-hidden>
        {NOTICE_ICONS[notice.kind]}
      </span>
      <span className="ob-notice-main">
        <span className="ob-notice-title">
          {!notice.read ? (
            <span className="ob-unread-dot" role="img" aria-label="Unread" />
          ) : null}
          <span className="ob-notice-title-text">{notice.title}</span>
        </span>
        {notice.body ? (
          <span className="ob-notice-body">{notice.body}</span>
        ) : null}
        <span className="ob-notice-time">{formatAgo(notice.at)}</span>
      </span>
    </button>
  )
}

function NativeNoticeToggle() {
  const [permission, setPermission] = useState<NativePermission>(() =>
    readNativePermission(),
  )
  const label =
    permission === "granted"
      ? "Browser notifications on"
      : permission === "denied"
        ? "Browser notifications blocked"
        : permission === "unsupported"
          ? "Browser notifications need HTTPS"
          : "Turn on browser notifications"
  const blocked = permission === "denied" || permission === "unsupported"
  return (
    <Button
      size="small"
      variant="text"
      startIcon={
        permission === "granted" ? (
          <NotificationsIcon width={16} height={16} />
        ) : permission === "default" ? (
          <NotificationsNoneIcon width={16} height={16} />
        ) : (
          <NotificationsOffIcon width={16} height={16} />
        )
      }
      disabled={blocked}
      onClick={() => {
        if (permission !== "default" || typeof Notification === "undefined")
          return
        void Notification.requestPermission().then((next) => {
          setPermission(
            next === "granted" || next === "denied" ? next : "default",
          )
        })
      }}
      sx={{ justifyContent: "flex-start", textTransform: "none" }}
    >
      {label}
    </Button>
  )
}

function SoundToggleRow() {
  const [on, setOn] = useState(() => readNotifySound())
  return (
    <Button
      size="small"
      variant="text"
      startIcon={
        on ? (
          <VolumeUpIcon width={16} height={16} />
        ) : (
          <VolumeOffIcon width={16} height={16} />
        )
      }
      onClick={() => {
        const next = !on
        writeNotifySound(next)
        setOn(next)
        if (next) playNotifySound()
      }}
      sx={{ justifyContent: "flex-start", textTransform: "none" }}
    >
      {on ? "Reply sound on" : "Reply sound off"}
    </Button>
  )
}

/**
 * Header bell: opens the session notification center. Opening it never
 * requests browser permission and never marks anything read — reading is an
 * explicit act (item click or "Mark all read").
 */
function NoticeBellButton({
  onOpenThread,
}: {
  onOpenThread: (sessionId: string) => void
}) {
  const items = useNoticesSnapshot()
  const unread = useUnreadNoticeCount()
  const [open, setOpen] = useState(false)
  const bellRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useOverlayA11y(open, close, panelRef)
  const badge = unread > 9 ? "9+" : unread > 0 ? String(unread) : ""
  const openNotice = useCallback(
    (notice: NoticeItem) => {
      markNoticeRead(notice.id)
      if (notice.sessionId) onOpenThread(notice.sessionId)
      else if (notice.href) setOpen(false)
      setOpen(false)
    },
    [onOpenThread],
  )

  return (
    <ClickAwayListener onClickAway={close}>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          // The open panel must paint above later header siblings (search).
          zIndex: open ? 60 : "auto",
        }}
      >
        <Tip title="Notifications">
          <IconButton
            ref={bellRef}
            size="medium"
            aria-label={
              unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
            }
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {unread > 0 ? (
              <NotificationsIcon width={20} height={20} />
            ) : (
              <NotificationsNoneIcon width={20} height={20} />
            )}
            {badge ? <span className="ob-header-badge">{badge}</span> : null}
          </IconButton>
        </Tip>
        {open ? (
          <Paper
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            elevation={8}
            className="ob-notice-panel"
            sx={{ outline: "none" }}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ px: 1.5, pt: 1.25, pb: 0.75 }}
            >
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                Notifications
              </Typography>
              <Button
                size="small"
                variant="text"
                disabled={unread === 0}
                onClick={markAllNoticesRead}
              >
                Mark all read
              </Button>
              <IconButton
                size="small"
                aria-label="Close notifications"
                onClick={close}
              >
                <CloseIcon width={16} height={16} />
              </IconButton>
            </Stack>
            <Divider />
            <Box className="ob-notice-list">
              {items.length === 0 ? (
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ p: 2, textAlign: "center" }}
                >
                  Nothing yet — replies, plugin and security alerts land here.
                </Typography>
              ) : (
                items.map((notice) => (
                  <NoticeRow
                    key={notice.id}
                    notice={notice}
                    onOpen={openNotice}
                  />
                ))
              )}
            </Box>
            <Divider />
            <Stack spacing={0.25} sx={{ px: 1, py: 0.75 }}>
              <NativeNoticeToggle />
              <SoundToggleRow />
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ px: 1 }}
              >
                History covers this session only and clears when you sign out.
              </Typography>
            </Stack>
          </Paper>
        ) : null}
      </Box>
    </ClickAwayListener>
  )
}

// ---- Profile ----------------------------------------------------------------

function initialsOf(email: string): string {
  const head = email.split("@")[0] ?? email
  const parts = head.split(/[._-]+/).filter(Boolean)
  const letters = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  return letters || "?"
}

function ProfileButton({
  me,
  go,
  onLogout,
}: {
  me: Me
  go: (path: string) => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const initials = useMemo(() => initialsOf(me.email), [me.email])
  return (
    <>
      <Tip title="Account">
        <IconButton
          ref={buttonRef}
          size="medium"
          aria-label={`Account — ${me.email}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          sx={{ p: 0.5 }}
        >
          <Avatar size={30} alt="">
            {initials}
          </Avatar>
        </IconButton>
      </Tip>
      <Menu
        open={open}
        anchorEl={buttonRef}
        onClose={() => {
          setOpen(false)
          buttonRef.current?.focus()
        }}
      >
        <Box sx={{ px: 1.5, pt: 1, maxWidth: 260 }}>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me.email}
            {me.role === "admin" ? " · admin" : ""}
          </Typography>
        </Box>
        <Divider sx={{ my: 0.5 }} />
        {me.role === "admin" ? (
          <Button
            variant="text"
            startIcon={<AdminPanelSettingsIcon width={16} height={16} />}
            onClick={() => {
              setOpen(false)
              go("/admin")
            }}
            sx={{ width: "100%", justifyContent: "flex-start" }}
          >
            Admin
          </Button>
        ) : null}
        <Button
          variant="text"
          color="error"
          startIcon={<LogoutIcon width={16} height={16} />}
          onClick={() => {
            setOpen(false)
            onLogout()
          }}
          sx={{ width: "100%", justifyContent: "flex-start" }}
        >
          Log out
        </Button>
      </Menu>
    </>
  )
}

// ---- Search -----------------------------------------------------------------

function searchEntryIcon(entry: SearchEntry): React.ReactNode {
  if (entry.group === "threads") return <ChatIcon width={16} height={16} />
  if (entry.group === "projects") return <FolderIcon width={16} height={16} />
  if (entry.group === "apps") return <ExtensionIcon width={16} height={16} />
  return <ChevronRightIcon width={16} height={16} />
}

const SEARCH_RESULTS_ID = "ob-search-results"

function SearchResults({
  groups,
  flat,
  activeIndex,
  onPickIndex,
  onHoverIndex,
  data,
  onRetry,
  listboxId,
}: {
  groups: SearchGroup[]
  flat: SearchEntry[]
  activeIndex: number
  onPickIndex: (index: number) => void
  onHoverIndex: (index: number) => void
  data: SearchDataState
  onRetry: () => void
  listboxId: string
}) {
  let flatIndex = -1
  const loading =
    data.sessionsStatus === "loading" || data.projectsStatus === "loading"
  return (
    <Box
      className="ob-search-results"
      role="listbox"
      id={listboxId}
      aria-label="Search results"
    >
      {loading ? (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ px: 2, py: 1, display: "block" }}
        >
          Loading conversations and projects…
        </Typography>
      ) : null}
      {groups.map((group) => (
        <Box key={group.id} role="presentation" className="ob-search-group">
          <Typography variant="caption" className="ob-search-group-label">
            {group.label}
          </Typography>
          {group.items.map((entry) => {
            flatIndex += 1
            const index = flatIndex
            const active = index === activeIndex
            return (
              <button
                key={entry.id}
                type="button"
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={active}
                className={`ob-search-row${active ? " ob-search-active" : ""}`}
                onMouseEnter={() => onHoverIndex(index)}
                onClick={() => onPickIndex(index)}
              >
                <span className="ob-search-row-icon" aria-hidden>
                  {searchEntryIcon(entry)}
                </span>
                <span className="ob-search-row-main">
                  <span className="ob-search-row-title">{entry.title}</span>
                  {entry.hint ? (
                    <span className="ob-search-row-hint">{entry.hint}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </Box>
      ))}
      {flat.length === 0 && !loading ? (
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ p: 2, textAlign: "center" }}
        >
          No match.
        </Typography>
      ) : null}
      {data.sessionsStatus === "error" || data.projectsStatus === "error" ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            px: 1.5,
            py: 1,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            {data.sessionsStatus === "error"
              ? "Conversations unavailable. "
              : ""}
            {data.projectsStatus === "error" ? "Projects unavailable." : ""}
          </Typography>
          <Button size="small" variant="text" onClick={onRetry}>
            Retry
          </Button>
        </Stack>
      ) : null}
    </Box>
  )
}

function useSearchEntries(
  me: Me,
  appTabs: { key: string; title: string; pluginName: string }[],
  data: SearchDataState,
): SearchEntry[] {
  return useMemo(() => {
    const nav = searchNavEntries(me.role)
    const apps = searchAppEntries(appTabs)
    const threads = searchThreadEntries(data.sessions)
    const projects = searchProjectEntries(data.projects)
    return [...nav, ...apps, ...threads, ...projects]
  }, [me.role, appTabs, data.sessions, data.projects])
}

/**
 * The header search: real destinations, apps, conversations and projects.
 * Scope is stated in the placeholder/help — no message-content search
 * exists server-side, so none is promised here.
 */
function SearchControl({
  me,
  appTabs,
  data,
  onRetry,
  onOpenThread,
  go,
  mobile,
  open: forcedOpen,
  onOpenChange,
  triggerRef,
}: {
  me: Me
  appTabs: { key: string; title: string; pluginName: string }[]
  data: SearchDataState
  onRetry: () => void
  onOpenThread: (sessionId: string) => void
  go: (path: string) => void
  mobile: boolean
  /** Mobile: the shell owns the sheet state (button / Ctrl+K). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerRef?: React.RefObject<HTMLElement | null>
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const isOpen = mobile ? Boolean(forcedOpen) : open

  const close = useCallback(() => {
    setOpen(false)
    onOpenChange?.(false)
    triggerRef?.current?.focus?.()
  }, [onOpenChange, triggerRef])

  useOverlayA11y(mobile && isOpen, close, sheetRef)

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
    setQuery("")
    setActiveIndex(-1)
  }, [isOpen])

  const entries = useSearchEntries(me, appTabs, data)
  const trimmed = query.trim()
  const groups = useMemo(
    () =>
      trimmed ? runSearch(trimmed, entries) : initialSearchResults(entries),
    [trimmed, entries],
  )
  const flat = useMemo(() => flattenSearchGroups(groups), [groups])

  const pick = useCallback(
    (index: number) => {
      const entry = flat[index]
      if (!entry) return
      close()
      if (entry.sessionId) onOpenThread(entry.sessionId)
      else if (entry.path) go(entry.path)
    },
    [flat, close, go, onOpenThread],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index) => moveSearchSelection(index, 1, flat.length))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index) => moveSearchSelection(index, -1, flat.length))
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(activeIndex >= 0 ? activeIndex : 0)
    } else if (event.key === "Escape") {
      if (!isOpen) return
      event.preventDefault()
      event.stopPropagation()
      if (!mobile && trimmed) {
        // First Escape clears the query; the field stays open.
        setQuery("")
        setActiveIndex(-1)
      } else {
        close()
      }
    }
  }

  const searchInput = (ariaExpanded: boolean) => (
    <label className="ob-search-box ob-search-box-grow">
      <SearchIcon width={16} height={16} />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setActiveIndex(-1)
          if (!mobile) setOpen(true)
        }}
        onFocus={() => {
          if (!mobile) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        placeholder={
          mobile ? "Search apps, threads, projects…" : "Search — Ctrl K"
        }
        aria-label="Search apps, threads and projects"
        aria-controls={SEARCH_RESULTS_ID}
        aria-activedescendant={
          activeIndex >= 0
            ? `${SEARCH_RESULTS_ID}-opt-${activeIndex}`
            : undefined
        }
        role="combobox"
        aria-expanded={ariaExpanded}
      />
    </label>
  )

  if (mobile) {
    return (
      <>
        <Tip title="Search">
          <IconButton
            ref={triggerRef as React.RefObject<HTMLButtonElement | null>}
            size="medium"
            aria-label="Search"
            aria-haspopup="dialog"
            aria-expanded={Boolean(forcedOpen)}
            onClick={() => onOpenChange?.(true)}
          >
            <SearchIcon width={20} height={20} />
          </IconButton>
        </Tip>
        {forcedOpen ? (
          <Box
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="ob-search-sheet"
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              className="ob-search-sheet-bar"
            >
              {searchInput(true)}
              <IconButton
                size="small"
                aria-label="Close search"
                onClick={close}
              >
                <CloseIcon width={18} height={18} />
              </IconButton>
            </Stack>
            <Box className="ob-search-sheet-body">
              <SearchResults
                groups={groups}
                flat={flat}
                activeIndex={activeIndex}
                onPickIndex={pick}
                onHoverIndex={setActiveIndex}
                data={data}
                onRetry={onRetry}
                listboxId={SEARCH_RESULTS_ID}
              />
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ px: 2, py: 1, display: "block" }}
              >
                Searches destinations, apps, conversation titles and projects —
                not message contents.
              </Typography>
            </Box>
          </Box>
        ) : null}
      </>
    )
  }

  return (
    <ClickAwayListener
      onClickAway={() => {
        setOpen(false)
        setActiveIndex(-1)
      }}
    >
      <Box className="ob-search-root">
        <label className="ob-search-box">
          <SearchIcon width={16} height={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActiveIndex(-1)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search — Ctrl K"
            aria-label="Search apps, threads and projects"
            aria-controls={SEARCH_RESULTS_ID}
            aria-activedescendant={
              open && activeIndex >= 0
                ? `${SEARCH_RESULTS_ID}-opt-${activeIndex}`
                : undefined
            }
            role="combobox"
            aria-expanded={open}
          />
          {query ? (
            <button
              type="button"
              className="ob-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("")
                setActiveIndex(-1)
                inputRef.current?.focus()
              }}
            >
              <CloseIcon width={13} height={13} />
            </button>
          ) : null}
        </label>
        {open ? (
          <Paper elevation={8} className="ob-search-pop">
            <SearchResults
              groups={groups}
              flat={flat}
              activeIndex={activeIndex}
              onPickIndex={pick}
              onHoverIndex={setActiveIndex}
              data={data}
              onRetry={onRetry}
              listboxId={SEARCH_RESULTS_ID}
            />
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ px: 2, py: 1, display: "block" }}
            >
              Destinations, apps, conversation titles and projects — not message
              contents.
            </Typography>
          </Paper>
        ) : null}
      </Box>
    </ClickAwayListener>
  )
}

// ---- Header -----------------------------------------------------------------

export type AppHeaderProps = {
  me: Me
  mobile: boolean
  pageContext: string
  themeMode: "dark" | "light"
  onToggleTheme: () => void
  /** Mobile: open the nav drawer. Desktop: toggle the collapsed rail. */
  onToggleNav: () => void
  /** True when the desktop nav is collapsed (rail). Undefined on mobile. */
  navCollapsed?: boolean
  appTabs: { key: string; title: string; pluginName: string }[]
  onOpenThread: (sessionId: string) => void
  go: (path: string) => void
  onLogout: () => void
}

export function AppHeader({
  me,
  mobile,
  pageContext,
  themeMode,
  onToggleTheme,
  onToggleNav,
  navCollapsed,
  appTabs,
  onOpenThread,
  go,
  onLogout,
}: AppHeaderProps) {
  const { state: data, load } = useSearchData(me.id)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Ctrl/Cmd+K opens search from anywhere in the shell.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (mobile) setSearchOpen(true)
        else
          document
            .querySelector<HTMLInputElement>(".ob-search-box input")
            ?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobile])

  useEffect(() => {
    // Preload search data once the shell is interactive.
    load()
  }, [load])

  const themeLabel =
    themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"

  return (
    <header className="ob-header">
      <Box className="ob-header-left">
        {mobile ? (
          <IconButton
            size="medium"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            onClick={onToggleNav}
          >
            <MenuIcon width={20} height={20} />
          </IconButton>
        ) : (
          <Tip
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            placement="bottom"
          >
            <IconButton
              size="medium"
              aria-label={
                navCollapsed ? "Expand navigation" : "Collapse navigation"
              }
              aria-expanded={!navCollapsed}
              onClick={onToggleNav}
            >
              <MenuIcon width={20} height={20} />
            </IconButton>
          </Tip>
        )}
        <a
          className="ob-header-brand"
          href="/"
          aria-label="open-bot — go to chat"
          onClick={(event) => {
            event.preventDefault()
            go("/")
          }}
        >
          <img src="/logo-mark.png" alt="" width={30} height={30} />
          <span className="ob-header-name">open-bot</span>
        </a>
        {pageContext ? (
          <Typography
            className="ob-header-context"
            component="span"
            variant="body2"
          >
            {pageContext}
          </Typography>
        ) : null}
      </Box>
      {/* Required order, left to right: Profile · Theme · Notifications · Search. */}
      <Box className="ob-header-right">
        <ProfileButton me={me} go={go} onLogout={onLogout} />
        <Tip title={themeLabel} placement="bottom">
          <IconButton
            size="medium"
            aria-label={themeLabel}
            onClick={onToggleTheme}
          >
            {themeMode === "dark" ? (
              <LightModeIcon width={20} height={20} />
            ) : (
              <DarkModeIcon width={20} height={20} />
            )}
          </IconButton>
        </Tip>
        <NoticeBellButton onOpenThread={onOpenThread} />
        <SearchControl
          me={me}
          appTabs={appTabs}
          data={data}
          onRetry={load}
          onOpenThread={onOpenThread}
          go={go}
          mobile={mobile}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          triggerRef={searchTriggerRef}
        />
      </Box>
    </header>
  )
}
