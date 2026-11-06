import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react"
import { type ScreenCardState, type VncFit, vncFrameSrc } from "./chat-view"
import {
  AppsIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CloseIcon,
  ComputerIcon,
  FullscreenIcon,
  KeyboardIcon,
  OpenInNewIcon,
  RefreshIcon,
} from "./icons"
import Stack from "./stack"
import { THREADS_UI } from "./texts"

type VncRfb = {
  sendKey?: (keysym: number, code?: string, down?: boolean) => void
  clipboardPasteFrom?: (text: string) => void
}

export type VncWindow = Window & {
  UI?: {
    forceSetting?: (name: string, value: boolean) => void
    updateViewOnly?: () => void
    rfb?: VncRfb
  }
}

function lockVnc(win: VncWindow | null, interactive: boolean) {
  try {
    win?.UI?.forceSetting?.("view_only", !interactive)
    win?.UI?.updateViewOnly?.()
  } catch {
    // frame not ready, or the page blocked access
  }
}

const XK_ESCAPE = 0xff1b
const XK_CONTROL_L = 0xffe3
const XK_ALT_L = 0xffe9
const XK_DELETE = 0xffff

function sendKey(win: VncWindow | null, keysym: number, code: string) {
  try {
    win?.UI?.rfb?.sendKey?.(keysym, code)
  } catch {
    // frame not ready
  }
}

function sendCtrlAltDel(win: VncWindow | null) {
  try {
    const rfb = win?.UI?.rfb
    rfb?.sendKey?.(XK_CONTROL_L, "ControlLeft", true)
    rfb?.sendKey?.(XK_ALT_L, "AltLeft", true)
    rfb?.sendKey?.(XK_DELETE, "Delete", true)
    rfb?.sendKey?.(XK_DELETE, "Delete", false)
    rfb?.sendKey?.(XK_ALT_L, "AltLeft", false)
    rfb?.sendKey?.(XK_CONTROL_L, "ControlLeft", false)
  } catch {
    // frame not ready
  }
}

export function VncFrame({
  path,
  interactive,
  title,
  className,
  fit = "scale",
  frameRef,
}: {
  path: string
  interactive: boolean
  title: string
  className?: string
  fit?: VncFit
  frameRef?: Ref<HTMLIFrameElement>
}) {
  return (
    <iframe
      ref={frameRef}
      title={title}
      className={className}
      src={vncFrameSrc(path, interactive, fit)}
      onLoad={(event) => {
        const frame = event.currentTarget
        const lock = () =>
          lockVnc(frame.contentWindow as VncWindow | null, interactive)
        lock()
        window.setTimeout(lock, 400)
      }}
    />
  )
}

export function openVnc(
  path: string,
  interactive: boolean,
  fit: VncFit = "scale",
) {
  const pop = window.open(vncFrameSrc(path, interactive, fit), "_blank")
  if (!pop) return
  const lock = () => lockVnc(pop as VncWindow, interactive)
  pop.addEventListener("load", lock)
  window.setTimeout(lock, 800)
}

type PillTone = "live" | "held" | "warn" | "err" | "muted"

function ScreenPill({
  tone,
  children,
}: {
  tone: PillTone
  children: ReactNode
}) {
  return (
    <output className={`ob-screen-pill ob-screen-pill-${tone}`}>
      <span className="ob-screen-dot" aria-hidden="true" />
      {children}
    </output>
  )
}

function ScreenSteps({ phase }: { phase: 1 | 2 }) {
  const step = (n: number, label: string) => (
    <span
      className={`ob-screen-step${
        phase === n ? " ob-screen-step-on" : ""
      }${phase > n ? " ob-screen-step-done" : ""}`}
    >
      <span className="ob-screen-step-n" aria-hidden="true">
        {phase > n ? "✓" : n}
      </span>
      {label}
    </span>
  )
  return (
    <div className="ob-screen-steps">
      {step(
        1,
        phase > 1 ? THREADS_UI.screenStepTaken : THREADS_UI.screenStepTake,
      )}
      <ChevronRightIcon width={13} height={13} aria-hidden="true" />
      {step(2, THREADS_UI.screenStepAct)}
      <ChevronRightIcon width={13} height={13} aria-hidden="true" />
      {step(3, THREADS_UI.screenStepGive)}
    </div>
  )
}

/** Send-keys cluster shown while the user drives (the B-console graft). */
function SendKeys({
  getWindow,
  focusFrame,
  vertical = false,
}: {
  getWindow: () => VncWindow | null
  focusFrame: () => void
  vertical?: boolean
}) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const paste = () => {
    try {
      getWindow()?.UI?.rfb?.clipboardPasteFrom?.(pasteText)
    } catch {
      // frame not ready
    }
    setPasteText("")
    setPasteOpen(false)
    focusFrame()
  }
  return (
    <div className={`ob-screen-keys${vertical ? " ob-screen-keys-v" : ""}`}>
      {vertical ? null : (
        <span className="ob-screen-keys-lab">{THREADS_UI.screenKeys} :</span>
      )}
      <Button
        size="small"
        variant="outlined"
        onClick={() => sendKey(getWindow(), XK_ESCAPE, "Escape")}
      >
        {THREADS_UI.screenKeyEscape}
      </Button>
      <Button
        size="small"
        variant="outlined"
        onClick={() => sendCtrlAltDel(getWindow())}
      >
        {THREADS_UI.screenKeyCtrlAltDel}
      </Button>
      {pasteOpen ? (
        <span className="ob-screen-paste">
          <TextField
            value={pasteText}
            aria-label={THREADS_UI.screenPasteText}
            onChange={(event) => setPasteText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") paste()
            }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!pasteText}
            onClick={paste}
          >
            {THREADS_UI.screenPaste}
          </Button>
        </span>
      ) : (
        <Button
          size="small"
          variant="outlined"
          onClick={() => setPasteOpen(true)}
        >
          {THREADS_UI.screenPasteText}
        </Button>
      )}
      <Button
        size="small"
        variant="outlined"
        startIcon={<KeyboardIcon width={16} height={16} />}
        onClick={focusFrame}
      >
        {THREADS_UI.screenKeyboard}
      </Button>
      {vertical ? null : (
        <span className="ob-screen-keys-lab ob-screen-keys-hint">
          {THREADS_UI.screenKeysHint}
        </span>
      )}
    </div>
  )
}

export type ScreenCardProps = {
  state: ScreenCardState
  path: string
  error: string
  /** Pre-formatted share time for the receipt rows. */
  timeLabel: string
  reloadKey: number
  takeDisabled: boolean
  doneDisabled: boolean
  onTakeControl: () => void
  /** Held: release + tell the agent. Live: done without ever driving. */
  onDone: () => void
  onReleaseSilent: () => void
  onLater: () => void
  onResume: () => void
  onOpenStage: () => void
  onCloseStage: () => void
  onRetry: () => void
  onStartDesktop: () => void
}

/**
 * The guided handoff card in the thread. One primary action per state;
 * finished or postponed shares collapse to one-line receipts so the
 * transcript stays readable and history shows where hands changed.
 */
export function ScreenCard(props: ScreenCardProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const { state } = props
  const openStageButton = (
    <Button
      size="small"
      variant="text"
      startIcon={<OpenInNewIcon width={15} height={15} />}
      onClick={props.onOpenStage}
    >
      {THREADS_UI.screenOpenStage}
    </Button>
  )
  if (state === "older" || state === "done" || state === "later") {
    return (
      <div className="ob-screen-receipt">
        {state === "done" ? (
          <CheckCircleIcon width={18} height={18} aria-hidden="true" />
        ) : (
          <ComputerIcon width={18} height={18} aria-hidden="true" />
        )}
        <span className="ob-screen-receipt-text">
          <strong>
            {state === "done"
              ? THREADS_UI.screenHandedBack
              : THREADS_UI.screenShared}
          </strong>
          {props.timeLabel ? ` · ${props.timeLabel}` : ""} —{" "}
          {state === "done"
            ? THREADS_UI.screenHandedBackBody
            : state === "later"
              ? THREADS_UI.screenSharedLater
              : THREADS_UI.screenSharedOlder}
        </span>
        {state === "later" ? (
          <Button size="small" variant="outlined" onClick={props.onResume}>
            {THREADS_UI.screenResume}
          </Button>
        ) : null}
        {openStageButton}
      </div>
    )
  }
  if (state === "opened") {
    return (
      <div className="ob-screen-receipt">
        <ComputerIcon width={18} height={18} aria-hidden="true" />
        <span className="ob-screen-receipt-text">
          <strong>{THREADS_UI.screenOpenedAside}</strong>
        </span>
        <Button size="small" variant="text" onClick={props.onCloseStage}>
          {THREADS_UI.screenCloseStage}
        </Button>
      </div>
    )
  }
  const held = state === "held"
  const pill =
    state === "live" ? (
      <ScreenPill tone="live">{THREADS_UI.screenLiveView}</ScreenPill>
    ) : held ? (
      <ScreenPill tone="held">{THREADS_UI.screenYouDriveShort}</ScreenPill>
    ) : state === "asleep" ? (
      <ScreenPill tone="warn">{THREADS_UI.screenAsleep}</ScreenPill>
    ) : state === "error" ? (
      <ScreenPill tone="err">{THREADS_UI.screenUnavailable}</ScreenPill>
    ) : (
      <ScreenPill tone="warn">{THREADS_UI.screenOpening}…</ScreenPill>
    )
  return (
    <div className={`ob-screen-card${held ? " ob-screen-card-held" : ""}`}>
      {held ? (
        <div className="ob-screen-ribbon">{THREADS_UI.screenStepActNow}</div>
      ) : null}
      <div className="ob-screen-head">
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" component="span" sx={{ flex: 1 }}>
            {THREADS_UI.screenNeedYou}
          </Typography>
          {pill}
        </Stack>
        {state === "asleep" ? (
          <Typography variant="body2" color="textSecondary">
            {THREADS_UI.screenAsleepCard}
          </Typography>
        ) : state === "error" ? (
          <Typography variant="body2" color="textSecondary">
            {THREADS_UI.screenErrorBody}
            {props.error ? ` (${props.error})` : ""}
          </Typography>
        ) : (
          <ScreenSteps phase={held ? 2 : 1} />
        )}
      </div>
      {state === "live" || held ? (
        <div className="ob-screen-media">
          <VncFrame
            key={`${props.reloadKey}-${held ? "held" : "view"}`}
            title="thread screen"
            path={props.path}
            interactive={held}
            frameRef={frameRef}
          />
        </div>
      ) : state === "opening" ? (
        <div className="ob-screen-media ob-screen-skel">
          <CircularProgress size="20px" />
          <span>{THREADS_UI.screenOpeningNow}</span>
          <span className="ob-screen-skel-hint">
            {THREADS_UI.screenOpeningHint}
          </span>
        </div>
      ) : state === "asleep" ? (
        <div className="ob-screen-media ob-screen-skel ob-screen-skel-short">
          <span>{THREADS_UI.screenAsleep}</span>
        </div>
      ) : null}
      {held ? (
        <SendKeys
          getWindow={() =>
            (frameRef.current?.contentWindow as VncWindow | null) ?? null
          }
          focusFrame={() => {
            frameRef.current?.focus()
            frameRef.current?.contentWindow?.focus()
          }}
        />
      ) : null}
      <div className="ob-screen-foot">
        {held ? (
          <>
            <Button
              size="small"
              variant="contained"
              disabled={props.doneDisabled}
              onClick={props.onDone}
              sx={{ flex: 1 }}
            >
              {THREADS_UI.screenDoneYours}
            </Button>
            <Button size="small" variant="text" onClick={props.onReleaseSilent}>
              {THREADS_UI.screenReleaseSilent}
            </Button>
            {openStageButton}
          </>
        ) : state === "live" ? (
          <>
            <Button
              size="small"
              variant="contained"
              disabled={props.takeDisabled}
              onClick={props.onTakeControl}
              sx={{ flex: 1 }}
            >
              {THREADS_UI.takeControl}
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={props.doneDisabled}
              onClick={props.onDone}
            >
              {THREADS_UI.screenDonePlain}
            </Button>
            <Button size="small" variant="text" onClick={props.onLater}>
              {THREADS_UI.screenLater}
            </Button>
            {openStageButton}
          </>
        ) : state === "asleep" ? (
          <>
            <Button
              size="small"
              variant="contained"
              onClick={props.onStartDesktop}
              sx={{ flex: 1 }}
            >
              {THREADS_UI.screenStartDesktop}
            </Button>
            <Button size="small" variant="text" onClick={props.onLater}>
              {THREADS_UI.screenLater}
            </Button>
          </>
        ) : state === "error" ? (
          <>
            <Button
              size="small"
              variant="contained"
              onClick={props.onRetry}
              sx={{ flex: 1 }}
            >
              {THREADS_UI.screenRetry}
            </Button>
            {openStageButton}
            <Button size="small" variant="text" onClick={props.onLater}>
              {THREADS_UI.screenLater}
            </Button>
          </>
        ) : (
          <>
            <Button size="small" variant="contained" disabled sx={{ flex: 1 }}>
              {THREADS_UI.takeControl}
            </Button>
            <Button size="small" variant="text" onClick={props.onLater}>
              {THREADS_UI.screenCancel}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export type ScreenStageProps = {
  /** Thread title shown in the status pill. */
  title: string
  /** Websockify path; "" while the screen is not live yet. */
  path: string
  error: string
  held: boolean
  reloadKey: number
  controlDisabled: boolean
  onToggleControl: () => void
  onReload: () => void
  /** Pane mode passes its element fullscreen; default: the stage itself. */
  onFullscreen?: () => void
  onClose?: () => void
  /** App launcher node, shown in the dock's Applications popover. */
  apps?: ReactNode
}

const FIT_KEY = "ob-screen-fit"

function readFit(): VncFit {
  try {
    return localStorage.getItem(FIT_KEY) === "native" ? "native" : "scale"
  } catch {
    return "scale"
  }
}

type StagePop = "" | "fit" | "keys" | "apps"

/**
 * The full-bleed screen stage (dedicated Desktop page, split pane,
 * phone overlay): black stage, status pill, one floating dock that
 * melts away after 3 s without a fine pointer. Pop-out carries the
 * current interactivity, so driving in a separate window works.
 */
export function ScreenStage(props: ScreenStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [fit, setFit] = useState<VncFit>(readFit)
  const [pop, setPop] = useState<StagePop>("")
  const [dockIdle, setDockIdle] = useState(false)
  const [frameFocused, setFrameFocused] = useState(false)
  const popRef = useRef<StagePop>("")
  popRef.current = pop
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wakeDock = () => {
    setDockIdle(false)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (
      typeof window === "undefined" ||
      !window.matchMedia?.("(pointer: fine)").matches
    )
      return
    idleTimer.current = setTimeout(() => {
      if (!popRef.current) setDockIdle(true)
    }, 3000)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: arm the idle timer once on mount
  useEffect(() => {
    wakeDock()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!props.held) {
      setFrameFocused(false)
      return
    }
    const check = () =>
      setFrameFocused(
        typeof document !== "undefined" &&
          document.activeElement === frameRef.current,
      )
    check()
    const timer = setInterval(check, 600)
    return () => clearInterval(timer)
  }, [props.held])

  const chooseFit = (next: VncFit) => {
    setFit(next)
    setPop("")
    try {
      localStorage.setItem(FIT_KEY, next)
    } catch {
      // private mode: fit just resets next visit
    }
  }
  const fullscreen = () => {
    if (props.onFullscreen) {
      props.onFullscreen()
      return
    }
    const el = stageRef.current
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {})
  }
  const togglePop = (next: Exclude<StagePop, "">) => {
    wakeDock()
    setPop((current) => (current === next ? "" : next))
  }
  const getWindow = () =>
    (frameRef.current?.contentWindow as VncWindow | null) ?? null

  return (
    <div
      ref={stageRef}
      className="ob-screen-stage"
      onPointerMove={wakeDock}
      onPointerDown={wakeDock}
    >
      {props.path ? (
        <VncFrame
          key={`${props.reloadKey}-${props.held ? "held" : "view"}-${fit}`}
          title="desktop"
          path={props.path}
          interactive={props.held}
          fit={fit}
          frameRef={frameRef}
          className="ob-screen-stage-frame"
        />
      ) : (
        <div className="ob-screen-place">
          <Typography variant="subtitle1" component="p">
            {props.error
              ? THREADS_UI.screenUnavailable
              : THREADS_UI.screenOpening}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {props.error || THREADS_UI.screenOpeningBody}
          </Typography>
          {props.error ? (
            <Button size="small" variant="contained" onClick={props.onReload}>
              {THREADS_UI.screenRetry}
            </Button>
          ) : (
            <CircularProgress size="20px" />
          )}
        </div>
      )}
      <div className="ob-screen-stage-pill">
        {props.held ? (
          <ScreenPill tone="held">{THREADS_UI.screenYouDrive}</ScreenPill>
        ) : props.path ? (
          <ScreenPill tone="live">
            {THREADS_UI.screenViewOnly(props.title)}
          </ScreenPill>
        ) : props.error ? (
          <ScreenPill tone="err">{THREADS_UI.screenUnavailable}</ScreenPill>
        ) : (
          <ScreenPill tone="warn">{THREADS_UI.screenOpening}…</ScreenPill>
        )}
      </div>
      {props.held && frameFocused ? (
        <div className="ob-screen-focusnote">
          <ScreenPill tone="warn">
            {THREADS_UI.screenKeyboardCaptured}
          </ScreenPill>
        </div>
      ) : null}
      {pop ? (
        <button
          type="button"
          className="ob-screen-pop-backdrop"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setPop("")}
        />
      ) : null}
      {pop === "fit" ? (
        <div
          className="ob-screen-pop"
          role="menu"
          aria-label={THREADS_UI.screenDisplay}
        >
          <span className="ob-screen-pop-label">
            {THREADS_UI.screenDisplay}
          </span>
          <Button
            size="small"
            variant={fit === "scale" ? "outlined" : "text"}
            aria-pressed={fit === "scale"}
            onClick={() => chooseFit("scale")}
          >
            {THREADS_UI.screenFitWindow}
          </Button>
          <Button
            size="small"
            variant={fit === "native" ? "outlined" : "text"}
            aria-pressed={fit === "native"}
            onClick={() => chooseFit("native")}
          >
            {THREADS_UI.screenFitNative}
          </Button>
        </div>
      ) : null}
      {pop === "keys" ? (
        <div
          className="ob-screen-pop"
          role="menu"
          aria-label={THREADS_UI.screenKeys}
        >
          <span className="ob-screen-pop-label">{THREADS_UI.screenKeys}</span>
          <SendKeys
            vertical
            getWindow={getWindow}
            focusFrame={() => {
              setPop("")
              frameRef.current?.focus()
              frameRef.current?.contentWindow?.focus()
            }}
          />
        </div>
      ) : null}
      {pop === "apps" && props.apps ? (
        <div className="ob-screen-pop ob-screen-pop-apps">{props.apps}</div>
      ) : null}
      <div
        className={`ob-screen-dock${dockIdle ? " ob-screen-dock-idle" : ""}`}
      >
        <Button
          size="small"
          variant="contained"
          disabled={props.controlDisabled}
          onClick={props.onToggleControl}
        >
          {props.held ? THREADS_UI.screenRelease : THREADS_UI.takeControl}
        </Button>
        {props.held ? (
          <Button
            size="small"
            variant="text"
            aria-expanded={pop === "keys"}
            onClick={() => togglePop("keys")}
          >
            {THREADS_UI.screenKeys} ▾
          </Button>
        ) : null}
        <Button
          size="small"
          variant="text"
          aria-expanded={pop === "fit"}
          onClick={() => togglePop("fit")}
        >
          {THREADS_UI.screenFit} ▾
        </Button>
        {props.apps ? (
          <Button
            size="small"
            variant="text"
            startIcon={<AppsIcon width={16} height={16} />}
            aria-expanded={pop === "apps"}
            onClick={() => togglePop("apps")}
          >
            {THREADS_UI.screenApps}
          </Button>
        ) : null}
        <IconButton
          size="small"
          aria-label={THREADS_UI.reloadScreen}
          title={THREADS_UI.reloadScreen}
          disabled={!props.path}
          onClick={props.onReload}
        >
          <RefreshIcon width={18} height={18} />
        </IconButton>
        <IconButton
          size="small"
          aria-label={THREADS_UI.screenFullscreen}
          title={THREADS_UI.screenFullscreen}
          onClick={fullscreen}
        >
          <FullscreenIcon width={18} height={18} />
        </IconButton>
        <IconButton
          size="small"
          aria-label={THREADS_UI.popOut}
          title={THREADS_UI.popOut}
          disabled={!props.path}
          onClick={() => openVnc(props.path, props.held, fit)}
        >
          <OpenInNewIcon width={18} height={18} />
        </IconButton>
        {props.onClose ? (
          <IconButton
            size="small"
            aria-label={THREADS_UI.screenCloseStage}
            title={THREADS_UI.screenCloseStage}
            onClick={props.onClose}
          >
            <CloseIcon width={18} height={18} />
          </IconButton>
        ) : null}
      </div>
    </div>
  )
}

export function ScreenPane({
  width,
  paneRef,
  onDrag,
  onClose,
  onFullscreen,
  ...stage
}: ScreenStageProps & {
  width: number
  paneRef: Ref<HTMLDivElement>
  onDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  onClose: () => void
  onFullscreen: () => void
}) {
  return (
    <>
      <div className="ob-preview-split" onPointerDown={onDrag} />
      <div ref={paneRef} className="ob-preview-pane" style={{ width }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          className="ob-preview-bar"
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            {THREADS_UI.screenOpenStage}
          </Typography>
          <Button size="small" variant="text" onClick={onClose}>
            {THREADS_UI.screenCloseStage}
          </Button>
        </Stack>
        <ScreenStage {...stage} onClose={onClose} onFullscreen={onFullscreen} />
      </div>
    </>
  )
}

export function ScreenOverlay({
  onClose,
  ...stage
}: ScreenStageProps & { onClose: () => void }) {
  return (
    <div className="ob-preview-overlay">
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" sx={{ flex: 1, color: "#fff" }}>
          {THREADS_UI.screenOpenStage}
        </Typography>
        <Button size="small" variant="contained" onClick={onClose}>
          {THREADS_UI.screenCloseStage}
        </Button>
      </Stack>
      <ScreenStage {...stage} onClose={onClose} />
    </div>
  )
}
