import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "./api"
import {
  type AppRecent,
  favoriteTabs,
  pushRecent,
  readFavorites,
  readRecents,
  recentTabs,
  toggleFavorite,
  writeFavorites,
  writeRecents,
} from "./apps-grid"
import { HomeScreen } from "./home-screen"
import { useMobile } from "./hooks"
import {
  AddIcon,
  AppTileIcon,
  ArrowBackIcon,
  CloseIcon,
  SearchIcon,
  StarBorderIcon,
  StarIcon,
  tileHue,
} from "./icons"
import {
  type InstalledPluginInfo,
  type PluginCardSpec,
  PluginCards,
  type PluginsStatus,
} from "./plugin-ui"
import Stack from "./stack"
import { APPS_UI } from "./texts"

/** What the shell's apps view needs to know about the install-list fetch. */
export type PluginsViewStatus = {
  status: PluginsStatus
  error: string
  refreshing: boolean
  refresh: () => Promise<void>
}

export type PluginTab = {
  key: string
  pluginId: string
  pluginName: string
  /** Plugin manifest description, clamped on the launcher tile. */
  pluginDescription?: string
  tabId: string
  title: string
  // App-tile icon for the mobile home screen: emoji or material icon name.
  icon?: string
  kind: "page" | "iframe" | "app"
  url?: string
  path?: string
  dataUrl?: string
  pollSeconds?: number
  cards?: PluginCardSpec[]
}

export function pluginTabs(plugins: InstalledPluginInfo[]): PluginTab[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) =>
      (plugin.manifest.dashboard?.tabs ?? []).map((tab) => ({
        key: `${plugin.pluginId}:${tab.id}`,
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        pluginDescription: plugin.description,
        tabId: tab.id,
        title: tab.title,
        icon: tab.icon,
        kind: tab.kind,
        url: tab.url,
        path: tab.path,
        dataUrl: tab.dataUrl,
        pollSeconds: tab.pollSeconds,
        cards: tab.cards,
      })),
    )
}

// Case-insensitive side-list filter on the tab title and plugin name.
export function filterTabs(tabs: PluginTab[], query: string): PluginTab[] {
  const q = query.trim().toLowerCase()
  if (!q) return tabs
  return tabs.filter(
    (tab) =>
      tab.title.toLowerCase().includes(q) ||
      tab.pluginName.toLowerCase().includes(q),
  )
}

// Polls the plugin's page server through the control proxy and feeds the
// result to the tab's `$.`-bound cards. Static tabs keep an empty object.
// The last good payload is kept on poll failures — a flaky refresh must not
// blank a working dashboard; the view shows a quiet "stale" note instead.
export type PageDataState = {
  data: Record<string, unknown>
  loading: boolean
  error: string
  reload: () => void
}

function usePageData(tab: PluginTab): PageDataState {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(Boolean(tab.dataUrl))
  const [error, setError] = useState("")
  const [nonce, setNonce] = useState(0)
  const pollSeconds = tab.dataUrl
    ? Math.min(3600, Math.max(5, tab.pollSeconds ?? 30))
    : 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the manual-retry trigger
  useEffect(() => {
    if (!tab.dataUrl) return
    let alive = true
    const url = `/api/pages/${tab.pluginId}${tab.dataUrl}`
    const tick = () => {
      if (document.visibilityState !== "visible") return
      api<Record<string, unknown>>(url)
        .then((body) => {
          if (!alive) return
          if (body && typeof body === "object") {
            setData(body)
            setError("")
          }
        })
        .catch((caught) => {
          if (!alive) return
          // First load blocks; later failures keep the last good cards and
          // surface the message next to them (hasData branch in PageTab).
          setError(
            caught instanceof Error
              ? caught.message
              : "could not reach the app's data",
          )
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }
    tick()
    if (pollSeconds > 0) {
      const id = setInterval(tick, pollSeconds * 1000)
      return () => {
        alive = false
        clearInterval(id)
      }
    }
    return () => {
      alive = false
    }
  }, [tab.pluginId, tab.dataUrl, pollSeconds, nonce])
  const reload = useMemo(() => () => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

function PageTabSkeleton() {
  return (
    <Stack spacing={2} aria-busy="true">
      <Box className="ob-skeleton" sx={{ height: 24, width: 220 }} />
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 2 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            className="ob-skeleton"
            sx={{ height: 96, width: 200, borderRadius: "12px" }}
          />
        ))}
      </Stack>
      <Box className="ob-skeleton" sx={{ height: 120, borderRadius: "12px" }} />
      <output className="ob-sr-status">Loading app</output>
    </Stack>
  )
}

function PageTab({ tab }: { tab: PluginTab }) {
  const { data, loading, error, reload } = usePageData(tab)
  const hasData = Object.keys(data).length > 0
  // First load fails: full error state with retry. A later poll fails while
  // good data is on screen: the cards stay, the failure is a quiet note.
  return (
    <Box
      className="ob-scroll"
      sx={{ p: 2, maxWidth: 860, mx: "auto", width: "100%" }}
    >
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          {tab.title}
        </Typography>
        {loading && !hasData ? <PageTabSkeleton /> : null}
        {!loading && error ? (
          <Alert severity={hasData ? "warning" : "error"}>
            {hasData
              ? `Refresh failed — showing the last loaded data. ${error}`
              : error}
            <Box sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" onClick={reload}>
                Retry
              </Button>
            </Box>
          </Alert>
        ) : null}
        {!loading && (hasData || !error) ? (
          <PluginCards spec={tab.cards ?? []} data={data} />
        ) : null}
        {loading && hasData ? (
          <Typography variant="caption" color="textSecondary">
            Refreshing…
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}

// Dedicated pages origin keeps allow-same-origin (that origin is not the
// dashboard). Same-host frames drop it so plugin JS cannot inherit the session.
export function appTabSandbox(isolated: boolean) {
  return isolated
    ? "allow-scripts allow-forms allow-popups allow-same-origin"
    : "allow-scripts allow-forms allow-popups"
}

// Device permissions delegated to the app frame ('src' = the frame's own
// origin). getUserMedia still needs a secure context, so this only bites in
// isolated mode (OPEN_BOT_PAGES_ORIGIN); the frame shim reports the fallback.
export const APP_TAB_FRAME_ALLOW =
  "microphone 'src'; camera 'src'; autoplay 'src'; geolocation 'src'; midi 'src'; display-capture 'src'"

export function appTabFrameProps(isolated: boolean) {
  return { sandbox: appTabSandbox(isolated), allow: APP_TAB_FRAME_ALLOW }
}

// Media bridge: the frame shim (FRAME_STORAGE_SHIM in control's preview.ts)
// asks the shell to capture, and the shell relays the live tracks over an
// in-page WebRTC loopback, so an opaque-origin frame gets a real MediaStream
// without being a secure context. Location fixes and clipboard writes cross
// the same bridge as plain messages. The shell owns every permission (its
// own trusted origin); the user confirms per app tab and kind.
type MediaAsk = {
  id: string
  kind: "media" | "geo" | "midi"
  display?: boolean
  audio?: boolean
  video?: boolean
  watch?: boolean
  sysex?: boolean
  geoOpts?: PositionOptions
}
type FrameInbound = {
  source?: string
  type?: string
  id?: string
  audio?: boolean
  video?: boolean
  display?: boolean
  sysex?: boolean
  kind?: string
  opts?: Record<string, unknown>
  text?: string
  portId?: string
  op?: string
  data?: number[]
  timestamp?: number
  ts?: number
  sdp?: string
  error?: string
}

// Serialized MIDIPort snapshot for the frame's fake MIDIAccess.
function midiPortInfo(port: MIDIPort) {
  return {
    id: port.id,
    name: port.name,
    manufacturer: port.manufacturer,
    state: port.state,
    connection: port.connection,
    type: port.type,
    version: port.version,
  }
}

// Non-trickle ICE: hold the SDP until candidates are in (bounded — a fake or
// broken PC must not hang the bridge; 3 s because a truncated candidate set
// is how the loopback goes one-way and the app hears silence).
function iceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done()
    }
    const timer = setTimeout(done, 3000)
    pc.addEventListener("icegatheringstatechange", onChange)
  })
}

// Frame tokens live 10 minutes, sliding only on requests, and die with every
// control restart (in-memory grants). A tab parked open — or across a deploy —
// would otherwise show the frame's plain "unauthorized" body forever. While
// the view is mounted, a periodic HEAD slides the token; a 401 remints and
// reloads the frame. 502 (desktop asleep / server down) is skipped so a cold
// desktop does not loop remints. Hidden tabs (background browser tab) skip
// the HEAD so the plugin's page server can idle out; coming back to the tab
// fires an immediate HEAD that revives the frame (and the server) at once.
const APP_TAB_KEEPALIVE_MS = 4 * 60 * 1000

// sessionStorage key holding the shell build this tab is running (from the
// x-open-bot-build frame header). A drift means a newer web deploy landed —
// the running shell can never swap its own JS, so the tab reloads itself once
// instead of going stale (the trap that silently killed the media bridge).
const UI_BUILD_KEY = "ob.build"

function AppTabSkeleton() {
  return (
    <Box
      sx={{ height: "100%", width: "100%", p: 2, boxSizing: "border-box" }}
      aria-busy="true"
    >
      <Stack spacing={1.5}>
        <Box className="ob-skeleton" sx={{ height: 28, width: 200 }} />
        <Box
          className="ob-skeleton"
          sx={{ height: "70%", minHeight: 260, borderRadius: "12px" }}
        />
        <output className="ob-sr-status">Opening app</output>
      </Stack>
    </Box>
  )
}

function AppTabError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ height: "100%", p: 3, textAlign: "center" }}
    >
      <Typography variant="subtitle1" component="h1">
        This app did not open
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ maxWidth: 440 }}>
        {message}
      </Typography>
      <Button variant="outlined" onClick={onRetry}>
        Retry
      </Button>
    </Stack>
  )
}

function AppTab({ tab }: { tab: PluginTab }) {
  const [src, setSrc] = useState("")
  const [isolated, setIsolated] = useState(false)
  const [phase, setPhase] = useState<"minting" | "ready" | "error">("minting")
  const [error, setError] = useState("")
  const [reconnecting, setReconnecting] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [mediaBlocked, setMediaBlocked] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [mediaDenied, setMediaDenied] = useState<{
    req: MediaAsk
    text: string
    retry: boolean
  } | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const tabContextIdRef = useRef<string>("")
  const [mediaAsk, setMediaAsk] = useState<MediaAsk | null>(null)
  const askRef = useRef<MediaAsk | null>(null)
  const askQueue = useRef<MediaAsk[]>([])
  // Session memory per mounted tab: one consent covers repeat requests.
  const decisions = useRef<Map<string, boolean>>(new Map())
  const bridges = useRef<
    Map<
      string,
      {
        pc: RTCPeerConnection
        stream: MediaStream
        cleanup?: () => void
      }
    >
  >(new Map())
  const geoWatches = useRef<Map<string, number>>(new Map())
  const midiBridges = useRef<Map<string, MIDIAccess>>(new Map())
  const postToFrame = (msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(msg, "*")
  }
  const denyPost = (req: MediaAsk, error: string) => {
    if (req.kind === "geo") {
      postToFrame({
        source: "open-bot-shell",
        type: "geo-response",
        id: req.id,
        err: { code: 1, message: error },
      })
      return
    }
    if (req.kind === "midi") {
      postToFrame({
        source: "open-bot-shell",
        type: "midi-denied",
        id: req.id,
        error,
      })
      return
    }
    postToFrame({
      source: "open-bot-shell",
      type: "media-denied",
      id: req.id,
      error,
    })
  }
  const releaseBridge = (id: string) => {
    const bridge = bridges.current.get(id)
    if (!bridge) return
    bridges.current.delete(id)
    bridge.cleanup?.()
    try {
      bridge.pc.close()
    } catch {}
    for (const track of bridge.stream.getTracks()) track.stop()
  }
  // Map a shell-side capture failure to a sentence the user can act on in the
  // same tab — the plugin only ever sees a bare rejection, so without this the
  // dashboard stays silent while the app shows its generic permission banner.
  function deniedCaptureText(error: unknown): { text: string; retry: boolean } {
    const name = error instanceof DOMException ? error.name : ""
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("secure context")) {
      return {
        text: "needs a secure context — open the dashboard over https (the tunnel URL) or localhost",
        retry: false,
      }
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return {
        text: "no microphone or camera was found on this device",
        retry: false,
      }
    }
    if (name === "NotAllowedError" || /permission/i.test(message)) {
      return {
        text: "the browser blocked the device for this site — click the mic/camera icon in the address bar, set it to Allow, then retry",
        retry: true,
      }
    }
    return { text: message || "device capture failed", retry: false }
  }

  const startBridge = async (req: MediaAsk) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "device capture needs a secure context — open the dashboard over https or localhost",
        )
      }
      const stream = req.display
        ? await (
            navigator as Navigator & {
              getDisplayMedia?: (
                constraints?: DisplayMediaStreamOptions,
              ) => Promise<MediaStream>
            }
          ).getDisplayMedia?.({
            video: true,
            audio: req.audio || undefined,
          })
        : await navigator.mediaDevices.getUserMedia({
            audio: req.audio,
            video: req.video,
          })
      if (!stream) throw new Error("screen capture is unavailable")
      const pc = new RTCPeerConnection()
      // The relayed track the frame receives can report muted=true forever on
      // some browsers while audio flows fine, so mirror the source track's
      // muted state over the bridge; the frame shim shadows track.muted with
      // it. Cleaned up with the bridge.
      const postTrackState = () => {
        postToFrame({
          source: "open-bot-shell",
          type: "media-track-state",
          id: req.id,
          tracks: stream
            .getTracks()
            .map((track) => ({ muted: track.muted, enabled: track.enabled })),
        })
      }
      const onTrackState = () => postTrackState()
      for (const track of stream.getTracks()) {
        track.addEventListener("mute", onTrackState)
        track.addEventListener("unmute", onTrackState)
      }
      bridges.current.set(req.id, {
        pc,
        stream,
        cleanup: () => {
          for (const track of stream.getTracks()) {
            track.removeEventListener("mute", onTrackState)
            track.removeEventListener("unmute", onTrackState)
          }
        },
      })
      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          releaseBridge(req.id)
        }
      }
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
      await pc.setLocalDescription(await pc.createOffer())
      await iceComplete(pc)
      const offer = pc.localDescription
      if (!offer) throw new Error("no local description")
      postToFrame({
        source: "open-bot-shell",
        type: "media-offer",
        id: req.id,
        sdp: offer.sdp,
      })
      postTrackState()
    } catch (caught) {
      releaseBridge(req.id)
      const reason = deniedCaptureText(caught)
      if (!req.display) setMediaDenied({ req, ...reason })
      denyPost(
        req,
        caught instanceof Error ? caught.message : "device capture failed",
      )
    }
  }
  const startGeo = (req: MediaAsk) => {
    const opts = req.geoOpts ?? {}
    const deliver = (pos: GeolocationPosition) => {
      postToFrame({
        source: "open-bot-shell",
        type: "geo-response",
        id: req.id,
        pos: {
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          },
          timestamp: pos.timestamp,
        },
      })
    }
    const fail = (err: GeolocationPositionError) => {
      postToFrame({
        source: "open-bot-shell",
        type: "geo-response",
        id: req.id,
        err: { code: err.code, message: err.message },
      })
    }
    if (req.watch) {
      geoWatches.current.set(
        req.id,
        navigator.geolocation.watchPosition(deliver, fail, opts),
      )
    } else {
      navigator.geolocation.getCurrentPosition(deliver, fail, opts)
    }
  }
  const askKey = (req: MediaAsk) =>
    req.kind === "geo"
      ? "geo"
      : req.kind === "midi"
        ? `midi:${req.sysex ? 1 : 0}`
        : req.display
          ? "screen"
          : `m:${req.audio}:${req.video}`
  const startMidi = async (req: MediaAsk) => {
    try {
      const access = await navigator.requestMIDIAccess({ sysex: req.sysex })
      midiBridges.current.set(req.id, access)
      access.onstatechange = () => {
        postToFrame({
          source: "open-bot-shell",
          type: "midi-state",
          id: req.id,
          inputs: [...access.inputs.values()].map(midiPortInfo),
          outputs: [...access.outputs.values()].map(midiPortInfo),
        })
      }
      postToFrame({
        source: "open-bot-shell",
        type: "midi-access",
        id: req.id,
        sysexEnabled: access.sysexEnabled,
        inputs: [...access.inputs.values()].map(midiPortInfo),
        outputs: [...access.outputs.values()].map(midiPortInfo),
      })
    } catch (caught) {
      postToFrame({
        source: "open-bot-shell",
        type: "midi-denied",
        id: req.id,
        error: caught instanceof Error ? caught.message : "MIDI is unavailable",
      })
    }
  }
  const releaseMidi = (id: string) => {
    const access = midiBridges.current.get(id)
    if (!access) return
    midiBridges.current.delete(id)
    access.onstatechange = null
    for (const [, input] of access.inputs) input.onmidimessage = null
  }
  const decide = (req: MediaAsk) => {
    const prior = decisions.current.get(askKey(req))
    if (prior === true) {
      if (req.kind === "geo") startGeo(req)
      else if (req.kind === "midi") void startMidi(req)
      else void startBridge(req)
      return
    }
    if (prior === false) {
      denyPost(req, "user denied")
      return
    }
    if (askRef.current) {
      askQueue.current.push(req)
      return
    }
    askRef.current = req
    setMediaAsk(req)
  }
  const resolveAsk = (allow: boolean) => {
    const req = askRef.current
    if (!req) return
    decisions.current.set(askKey(req), allow)
    askRef.current = null
    setMediaAsk(askQueue.current.shift() ?? null)
    if (!allow) {
      denyPost(req, "user denied")
      return
    }
    if (req.kind === "geo") startGeo(req)
    else if (req.kind === "midi") void startMidi(req)
    else void startBridge(req)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the retry trigger for a failed frame mint
  useEffect(() => {
    let alive = true
    let current = ""
    // #27: one stable, non-secret id per mounted tab, sent on every mint
    // (first, keep-alive remint, retry) so the framed page can tell a
    // remounted self from a different tab. Never an auth credential.
    if (!tabContextIdRef.current) {
      tabContextIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }
    const mint = () =>
      api<{ frameUrl: string; isolated?: boolean }>("/api/pages/frame", {
        method: "POST",
        body: JSON.stringify({
          pluginId: tab.pluginId,
          path: tab.path ?? "/",
          tabContextId: tabContextIdRef.current,
        }),
      }).then((body) => {
        if (!alive) return
        current = body.frameUrl
        setSrc(body.frameUrl)
        setIsolated(Boolean(body.isolated))
        setPhase("ready")
        setError("")
        setReconnecting(false)
        setMediaBlocked(null)
        setMediaDenied(null)
        for (const id of [...bridges.current.keys()]) releaseBridge(id)
        for (const id of [...midiBridges.current.keys()]) releaseMidi(id)
      })
    // First mint (or an explicit retry) blocks the pane on a skeleton. A
    // keep-alive remint failure keeps the last frame on screen and only
    // raises a soft note — never blank a working app.
    const run = (soft: boolean) => {
      if (!soft) {
        setPhase((prev) => (prev === "ready" ? prev : "minting"))
        setError("")
      }
      return mint().catch((caught) => {
        if (!alive) return
        const message =
          caught instanceof Error
            ? caught.message
            : "the app server did not answer"
        if (soft && current) {
          setReconnecting(true)
          return
        }
        setPhase("error")
        setError(message)
      })
    }
    void run(false)
    const check = () => {
      if (!current || document.visibilityState !== "visible") return
      fetch(current, {
        method: "HEAD",
        cache: "no-store",
        credentials: "include",
      })
        .then((res) => {
          if (!alive) return
          const build = res.headers.get("x-open-bot-build")
          if (build) {
            const seen = sessionStorage.getItem(UI_BUILD_KEY)
            if (!seen) {
              sessionStorage.setItem(UI_BUILD_KEY, build)
            } else if (seen !== build) {
              const busy =
                askRef.current !== null ||
                askQueue.current.length > 0 ||
                bridges.current.size > 0 ||
                midiBridges.current.size > 0 ||
                geoWatches.current.size > 0
              if (!busy) {
                sessionStorage.setItem(UI_BUILD_KEY, build)
                setReloading(true)
                setTimeout(() => window.location.reload(), 1500)
                return
              }
            }
          }
          if (res.ok || res.status === 502) return
          void run(true)
        })
        .catch(() => {})
    }
    const timer = setInterval(check, APP_TAB_KEEPALIVE_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [tab.pluginId, tab.path, nonce])
  // Frame messages: consent asks, WebRTC answers, releases, and the shim's
  // blocked notice (see FRAME_STORAGE_SHIM in control's preview.ts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read refs and stable setters only; the listener binds once per mount
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as FrameInbound | null
      if (!data || data.source !== "open-bot-frame") return
      if (data.type === "media-blocked") {
        setMediaBlocked(
          typeof data.error === "string" && data.error
            ? data.error
            : "the app frame could not reach the device bridge",
        )
        return
      }
      if (!data.id) return
      const id = String(data.id)
      if (data.type === "media-request") {
        setMediaDenied(null)
        decide({
          id,
          kind: "media",
          display: Boolean(data.display),
          audio: Boolean(data.audio),
          video: Boolean(data.video),
        })
      } else if (data.type === "geo-request") {
        const raw = (data.opts ?? {}) as Record<string, unknown>
        decide({
          id,
          kind: "geo",
          watch: data.kind === "watch",
          geoOpts: {
            enableHighAccuracy: Boolean(raw.enableHighAccuracy),
            timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
            maximumAge:
              typeof raw.maximumAge === "number" ? raw.maximumAge : undefined,
          },
        })
      } else if (data.type === "geo-clear") {
        const wid = geoWatches.current.get(id)
        if (wid !== undefined) {
          navigator.geolocation.clearWatch(wid)
          geoWatches.current.delete(id)
        }
      } else if (data.type === "clip-write") {
        const text = typeof data.text === "string" ? data.text : ""
        navigator.clipboard
          .writeText(text)
          .then(() =>
            postToFrame({ source: "open-bot-shell", type: "clip-result", id }),
          )
          .catch((caught) =>
            postToFrame({
              source: "open-bot-shell",
              type: "clip-result",
              id,
              err:
                caught instanceof Error
                  ? caught.message
                  : "clipboard unavailable",
            }),
          )
      } else if (data.type === "midi-request") {
        decide({ id, kind: "midi", sysex: Boolean(data.sysex) })
      } else if (data.type === "midi-listen" || data.type === "midi-unlisten") {
        const input = midiBridges.current
          .get(id)
          ?.inputs.get(String(data.portId))
        if (!input) return
        if (data.type === "midi-listen") {
          input.onmidimessage = (event: MIDIMessageEvent) => {
            postToFrame({
              source: "open-bot-shell",
              type: "midi-message",
              id,
              portId: String(data.portId),
              data: Array.from(event.data ?? []),
              ts: Math.round(performance.now()),
            })
          }
        } else {
          input.onmidimessage = null
        }
      } else if (data.type === "midi-send") {
        const output = midiBridges.current
          .get(id)
          ?.outputs.get(String(data.portId))
        if (!output || !Array.isArray(data.data)) return
        try {
          if (typeof data.timestamp === "number") {
            output.send(new Uint8Array(data.data), data.timestamp)
          } else {
            output.send(new Uint8Array(data.data))
          }
        } catch {}
      } else if (data.type === "midi-port") {
        const port =
          midiBridges.current.get(id)?.inputs.get(String(data.portId)) ??
          midiBridges.current.get(id)?.outputs.get(String(data.portId))
        if (!port) return
        if (data.op === "open") void port.open()
        else void port.close()
      } else if (data.type === "media-answer") {
        const bridge = bridges.current.get(id)
        if (bridge && typeof data.sdp === "string") {
          bridge.pc
            .setRemoteDescription({ type: "answer", sdp: data.sdp })
            .catch(() => releaseBridge(id))
        }
      } else if (data.type === "media-release") {
        releaseBridge(id)
      }
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      for (const id of [...bridges.current.keys()]) releaseBridge(id)
      for (const wid of geoWatches.current.values()) {
        navigator.geolocation.clearWatch(wid)
      }
      geoWatches.current.clear()
      for (const id of [...midiBridges.current.keys()]) releaseMidi(id)
    }
  }, [])
  if (phase === "minting") return <AppTabSkeleton />
  if (phase === "error" || !src)
    return (
      <AppTabError
        message={error || "The app server could not be reached."}
        onRetry={() => setNonce((n) => n + 1)}
      />
    )
  return (
    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
      {mediaAsk ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            position: "absolute",
            top: 4,
            left: 8,
            right: 8,
            zIndex: 4,
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.95)",
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          <Typography variant="caption" sx={{ flexGrow: 1 }}>
            {mediaAsk.kind === "geo"
              ? "This app wants access to your location."
              : mediaAsk.kind === "midi"
                ? `This app wants access to your MIDI devices${
                    mediaAsk.sysex ? " (SysEx)" : ""
                  }.`
                : `This app wants access to ${
                    mediaAsk.display
                      ? "your screen"
                      : mediaAsk.video
                        ? mediaAsk.audio
                          ? "your microphone and camera"
                          : "your camera"
                        : "your microphone"
                  }.`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            aria-label="Allow device"
            onClick={() => resolveAsk(true)}
          >
            Allow
          </Button>
          <Button
            size="small"
            aria-label="Deny device"
            onClick={() => resolveAsk(false)}
          >
            Deny
          </Button>
        </Stack>
      ) : null}
      {mediaBlocked ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            position: "absolute",
            top: 4,
            left: 8,
            right: 8,
            zIndex: 3,
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.92)",
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ flexGrow: 1 }}
          >
            {`This app could not reach your devices in this frame. ${mediaBlocked ?? ""}`}
          </Typography>
          <IconButton
            size="small"
            aria-label="Dismiss"
            onClick={() => setMediaBlocked(null)}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      ) : null}
      {mediaDenied ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            position: "absolute",
            top: 4,
            left: 8,
            right: 8,
            zIndex: 3,
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.95)",
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
          }}
        >
          <Typography variant="caption" sx={{ flexGrow: 1 }}>
            {mediaDenied.req.display
              ? "Screen capture failed — "
              : mediaDenied.req.video
                ? mediaDenied.req.audio
                  ? "Microphone and camera — "
                  : "Camera — "
                : "Microphone — "}
            {mediaDenied.text}.
          </Typography>
          {mediaDenied.retry ? (
            <Button
              size="small"
              variant="outlined"
              aria-label="Retry device"
              onClick={() => {
                const denied = mediaDenied
                setMediaDenied(null)
                if (!denied) return
                decisions.current.delete(askKey(denied.req))
                decide(denied.req)
              }}
            >
              Retry
            </Button>
          ) : null}
          <IconButton
            size="small"
            aria-label="Dismiss device error"
            onClick={() => setMediaDenied(null)}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      ) : null}
      {reloading ? (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.85)",
            pointerEvents: "none",
          }}
        >
          Dashboard updated — reloading…
        </Typography>
      ) : null}
      {reconnecting ? (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{
            position: "absolute",
            top: 4,
            right: 8,
            zIndex: 2,
            bgcolor: "rgba(var(--bg-surface, 24, 27, 34), 0.85)",
            px: 1,
            borderRadius: 1,
            pointerEvents: "none",
          }}
        >
          Reconnecting…
        </Typography>
      ) : null}
      {/* The iframe fires `load` for error pages too, so readiness comes from
          the frame mint above — not from this event. No cross-origin probing
          happens here: the frame's interior is the plugin's business. */}
      <iframe
        ref={frameRef}
        title={tab.title}
        src={src}
        {...appTabFrameProps(isolated)}
        referrerPolicy="no-referrer"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </Box>
  )
}

export function PluginTabView({ tab }: { tab: PluginTab }) {
  if (tab.kind === "app") return <AppTab tab={tab} />
  if (tab.kind === "iframe" && tab.url && /^https:\/\//.test(tab.url)) {
    return (
      <Box sx={{ height: "100%", width: "100%" }}>
        <iframe
          title={tab.title}
          src={tab.url}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </Box>
    )
  }
  return <PageTab tab={tab} />
}

function AppsLoadState({ status }: { status: PluginsViewStatus }) {
  return (
    <Stack
      spacing={2}
      sx={{ p: 3, maxWidth: 640, width: "100%", mx: "auto" }}
      aria-busy={status.status !== "ready"}
    >
      {status.status === "loading" ? (
        <>
          <output className="ob-sr-status">Loading apps</output>
          <Stack
            direction="row"
            spacing={2}
            sx={{ flexWrap: "wrap", rowGap: 2 }}
          >
            {[0, 1, 2, 3].map((i) => (
              <Stack key={i} spacing={1} sx={{ width: 96 }}>
                <Box
                  className="ob-skeleton"
                  sx={{ width: 96, height: 96, borderRadius: "18px" }}
                />
                <Box className="ob-skeleton" sx={{ height: 10, width: 72 }} />
              </Stack>
            ))}
          </Stack>
        </>
      ) : null}
      {status.status === "error" ? (
        <>
          <Typography variant="subtitle1" component="h1">
            Apps could not load
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {status.error ||
              "The installed plugin list did not load. Nothing is broken on this page — the request failed."}
          </Typography>
          <Box>
            <Button variant="outlined" onClick={() => void status.refresh()}>
              Retry
            </Button>
          </Box>
        </>
      ) : null}
    </Stack>
  )
}

/**
 * Quiet banner shown above the Apps view when a background refresh of the
 * install list fails: the previously loaded tabs stay usable, the failure
 * never replaces them.
 */
function AppsStaleBanner({ status }: { status: PluginsViewStatus }) {
  if (status.status !== "error") return null
  return (
    <Alert severity="warning" sx={{ m: 1 }}>
      {status.error || "The installed plugin list could not refresh."}
      <Box sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void status.refresh()}
        >
          Retry
        </Button>
      </Box>
    </Alert>
  )
}

function kindLabel(tab: PluginTab): string {
  if (tab.kind === "app") return APPS_UI.kindApp
  if (tab.kind === "iframe") return APPS_UI.kindIframe
  return APPS_UI.kindPage
}

function tileGradient(key: string): string {
  const hue = tileHue(key)
  return `linear-gradient(145deg, hsl(${hue} 62% 56%), hsl(${(hue + 28) % 360} 58% 44%))`
}

function AppTileButton({
  tab,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  tab: PluginTab
  favorite: boolean
  onOpen: (tab: PluginTab) => void
  onToggleFavorite: (tab: PluginTab) => void
}) {
  return (
    <div className="ob-app-tile-wrap">
      <button type="button" className="ob-app-tile" onClick={() => onOpen(tab)}>
        <Box
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: "12px",
            background: tileGradient(tab.key),
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,.25)",
          }}
        >
          <AppTileIcon icon={tab.icon} name={tab.title} size={22} />
        </Box>
        <Typography
          variant="subtitle2"
          component="span"
          sx={{
            display: "block",
            maxWidth: "100%",
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tab.title}
        </Typography>
        <Typography
          variant="caption"
          component="span"
          color="textSecondary"
          sx={{
            display: "block",
            maxWidth: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tab.pluginName}
        </Typography>
        {tab.pluginDescription ? (
          <Typography
            variant="caption"
            component="span"
            color="textSecondary"
            sx={{
              display: "-webkit-box",
              overflow: "hidden",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.35,
            }}
          >
            {tab.pluginDescription}
          </Typography>
        ) : null}
        <Typography
          variant="caption"
          component="span"
          color="textSecondary"
          sx={{ display: "block", mt: "auto" }}
        >
          {kindLabel(tab)}
        </Typography>
      </button>
      <button
        type="button"
        className="ob-app-fav"
        data-favorite={favorite ? "true" : "false"}
        aria-pressed={favorite}
        aria-label={
          favorite
            ? APPS_UI.removeFavorite(tab.title)
            : APPS_UI.addFavorite(tab.title)
        }
        onClick={() => onToggleFavorite(tab)}
      >
        {favorite ? (
          <StarIcon width={18} height={18} />
        ) : (
          <StarBorderIcon width={18} height={18} />
        )}
      </button>
    </div>
  )
}

function LauncherSection({
  title,
  tabs,
  favorites,
  onOpen,
  onToggleFavorite,
}: {
  title: string
  tabs: PluginTab[]
  favorites: string[]
  onOpen: (tab: PluginTab) => void
  onToggleFavorite: (tab: PluginTab) => void
}) {
  if (tabs.length === 0) return null
  return (
    <Box>
      <Typography
        variant="subtitle2"
        component="h2"
        sx={{
          // mui-lite restyles any tag-level h2 at the h2 scale; section
          // headers must stay secondary to the page's h1.
          fontSize: "0.875rem",
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {title}
      </Typography>
      <div className="ob-app-grid" style={{ marginTop: 8 }}>
        {tabs.map((tab) => (
          <AppTileButton
            key={tab.key}
            tab={tab}
            favorite={favorites.includes(tab.key)}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </Box>
  )
}

/**
 * Desktop front door for /apps: search, favorites, recents, then every app
 * in one grid. Nothing opens until a tile is picked — the old layout
 * silently opened the first app, so there was never an overview to scan.
 */
function AppsLauncher({
  tabs,
  status,
  favorites,
  recents,
  onOpen,
  onToggleFavorite,
  onAddPlugin,
  onManagePlugins,
}: {
  tabs: PluginTab[]
  status: PluginsViewStatus
  favorites: string[]
  recents: AppRecent[]
  onOpen: (tab: PluginTab) => void
  onToggleFavorite: (tab: PluginTab) => void
  onAddPlugin: () => void
  onManagePlugins: () => void
}) {
  const [query, setQuery] = useState("")
  const shown = useMemo(() => filterTabs(tabs, query), [tabs, query])
  const searching = query.trim().length > 0
  const favoritesShown = useMemo(
    () => favoriteTabs(tabs, favorites),
    [tabs, favorites],
  )
  const recentsShown = useMemo(() => recentTabs(tabs, recents), [tabs, recents])
  return (
    <Box className="ob-scroll" sx={{ height: "100%", minHeight: 0 }}>
      <Stack
        spacing={2.5}
        sx={{ p: 3, maxWidth: 1160, mx: "auto", width: "100%" }}
      >
        <AppsStaleBanner status={status} />
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap", rowGap: 1 }}
        >
          <Typography variant="h5" component="h1">
            Applications
          </Typography>
          <Typography variant="caption" color="textSecondary">
            {searching ? `${shown.length} / ${tabs.length}` : tabs.length}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            startIcon={<AddIcon width={18} height={18} />}
            onClick={() => onAddPlugin()}
          >
            {APPS_UI.addApp}
          </Button>
          <Button variant="outlined" onClick={() => onManagePlugins()}>
            {APPS_UI.manageExtensions}
          </Button>
        </Stack>
        {/* Native field like the threads filter: mui-lite hides
            ::placeholder, so a label-less TextField shows nothing. Enter
            opens the first match. */}
        <label className="ob-filter-field">
          <SearchIcon width={16} height={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shown[0]) onOpen(shown[0])
              if (event.key === "Escape") setQuery("")
            }}
            placeholder={APPS_UI.filter}
            aria-label={APPS_UI.filter}
            type="search"
          />
          {query ? (
            <button
              type="button"
              className="ob-filter-clear"
              aria-label={APPS_UI.clearFilter}
              onClick={() => setQuery("")}
            >
              <CloseIcon width={13} height={13} />
            </button>
          ) : null}
        </label>
        {searching ? (
          shown.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              {APPS_UI.noMatch(query.trim())}
            </Typography>
          ) : (
            <div className="ob-app-grid">
              {shown.map((tab) => (
                <AppTileButton
                  key={tab.key}
                  tab={tab}
                  favorite={favorites.includes(tab.key)}
                  onOpen={onOpen}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          )
        ) : (
          <>
            <LauncherSection
              title={APPS_UI.favorites}
              tabs={favoritesShown}
              favorites={favorites}
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
            />
            <LauncherSection
              title={APPS_UI.recents}
              tabs={recentsShown}
              favorites={favorites}
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
            />
            {/* One grid for everything: most plugins ship a single tab,
                so a section per plugin degenerated into a vertical list
                of lone tiles. The tile itself names its plugin. */}
            <LauncherSection
              title={APPS_UI.allApps}
              tabs={tabs}
              favorites={favorites}
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
            />
          </>
        )}
        {status.refreshing ? (
          <Typography variant="caption" color="textSecondary">
            Actualisation…
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}

/** Header over an open app: back to the launcher + favorite toggle. */
function OpenAppHeader({
  tab,
  favorite,
  onClose,
  onToggleFavorite,
}: {
  tab: PluginTab
  favorite: boolean
  onClose: () => void
  onToggleFavorite: (tab: PluginTab) => void
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ px: 1, py: 0.75, flexShrink: 0 }}
    >
      <IconButton
        aria-label={APPS_UI.backToApps}
        onClick={onClose}
        size="small"
      >
        <ArrowBackIcon width={20} height={20} />
      </IconButton>
      <Box
        sx={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: "9px",
          background: tileGradient(tab.key),
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AppTileIcon icon={tab.icon} name={tab.title} size={16} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          sx={{
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tab.title}
        </Typography>
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ lineHeight: 1.2 }}
        >
          {tab.pluginName} · {kindLabel(tab)}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }} />
      <IconButton
        aria-label={
          favorite
            ? APPS_UI.removeFavorite(tab.title)
            : APPS_UI.addFavorite(tab.title)
        }
        aria-pressed={favorite}
        onClick={() => onToggleFavorite(tab)}
        size="small"
      >
        {favorite ? (
          <StarIcon width={20} height={20} />
        ) : (
          <StarBorderIcon width={20} height={20} />
        )}
      </IconButton>
    </Stack>
  )
}

// The main navigation's Apps view. Desktop opens on the launcher grid
// and gives an open app the full pane; mobile renders a phone-style
// home screen (apps, swipe pages, long-press to move, drop on an entry
// to create a folder).
//
// The selection lives in the URL, not in local state: opening an app
// navigates to its canonical /<pluginId>:<tabId> route, so reload, a
// copied link and Back/Forward all restore the same identity, and the
// document title names the open app. selectedKey "" (the /apps route)
// shows the launcher grid on desktop and the home screen on mobile;
// an open app gets the full pane under OpenAppHeader either way.
export function PluginAppsView({
  tabs,
  status,
  selectedKey,
  onOpen,
  onClose,
  onAddPlugin,
  onManagePlugins,
}: {
  tabs: PluginTab[]
  status: PluginsViewStatus
  /** Key of the route-selected tab ("" when none — the /apps route). */
  selectedKey: string
  onOpen: (tab: PluginTab) => void
  onClose: () => void
  /** Where "Ajouter une application" leads (the extensions manager). */
  onAddPlugin: () => void
  onManagePlugins: () => void
}) {
  const mobile = useMobile()
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites())
  const [recents, setRecents] = useState<AppRecent[]>(() => readRecents())
  const active = useMemo(
    () => tabs.find((tab) => tab.key === selectedKey) ?? null,
    [tabs, selectedKey],
  )
  // Opening an app (tile, deep link, search hit) makes it the newest
  // recent; the launcher reads the same list. Guarded on the head entry so
  // re-renders and refreshes never churn storage.
  const activeKey = active?.key
  useEffect(() => {
    if (!activeKey || recents[0]?.key === activeKey) return
    const next = pushRecent(recents, activeKey, Date.now())
    setRecents(next)
    writeRecents(next)
  }, [activeKey, recents])
  const onToggleFavorite = (tab: PluginTab) => {
    const next = toggleFavorite(favorites, tab.key)
    setFavorites(next)
    writeFavorites(next)
  }

  // Full-screen load/error states only when there is nothing to show yet.
  // A failed refresh (or a loading one) with tabs already on screen keeps
  // the view: the tabs are the last good data, the state becomes a banner.
  if (tabs.length === 0 && status.status !== "ready") {
    return (
      <Box
        className="ob-scroll"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        <AppsLoadState status={status} />
      </Box>
    )
  }
  if (tabs.length === 0) {
    return (
      <Box
        className="ob-scroll"
        sx={{ p: 3, maxWidth: 640, mx: "auto", width: "100%" }}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2" color="textSecondary">
            Aucune application pour l’instant. Les extensions qui livrent une
            page de tableau de bord apparaissent ici une fois installées et
            activées; certaines extensions fonctionnent directement dans les
            conversations, sans interface.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              variant="contained"
              startIcon={<AddIcon width={18} height={18} />}
              onClick={() => onAddPlugin()}
            >
              Ajouter une application
            </Button>
            <Button variant="outlined" onClick={() => onManagePlugins()}>
              Gérer les extensions
            </Button>
          </Stack>
          {status.refreshing ? (
            <Typography variant="caption" color="textSecondary">
              Actualisation…
            </Typography>
          ) : null}
        </Stack>
      </Box>
    )
  }
  if (mobile) {
    if (active) {
      return (
        <Stack sx={{ height: "100%", minHeight: 0 }}>
          <OpenAppHeader
            tab={active}
            favorite={favorites.includes(active.key)}
            onClose={onClose}
            onToggleFavorite={onToggleFavorite}
          />
          <AppsStaleBanner status={status} />
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <PluginTabView key={active.key} tab={active} />
          </Box>
        </Stack>
      )
    }
    return (
      <HomeScreen
        tabs={tabs}
        onOpen={(key) => {
          const found = tabs.find((entry) => entry.key === key)
          if (found) onOpen(found)
        }}
        onAddPlugin={onAddPlugin}
        onManagePlugins={onManagePlugins}
      />
    )
  }
  if (!active) {
    return (
      <AppsLauncher
        tabs={tabs}
        status={status}
        favorites={favorites}
        recents={recents}
        onOpen={onOpen}
        onToggleFavorite={onToggleFavorite}
        onAddPlugin={onAddPlugin}
        onManagePlugins={onManagePlugins}
      />
    )
  }
  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <OpenAppHeader
        tab={active}
        favorite={favorites.includes(active.key)}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
      />
      <AppsStaleBanner status={status} />
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <PluginTabView key={active.key} tab={active} />
      </Box>
    </Stack>
  )
}
