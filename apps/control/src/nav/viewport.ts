// Mobile / custom viewport emulation for ob-chrome screens — the DevTools
// device toolbar as a CLI verb, for design development (responsive checks
// at phone sizes without opening DevTools).
//
// CDP emulation overrides belong to the CDP session that set them: they die
// with its socket. Every ob-chrome call opens and closes its own socket, so
// the CLI cannot hold an override itself — it writes the desired spec to a
// per-screen file (see devtools.ts) and the screen's long-lived DevTools
// recorder applies it on the socket it already holds open, re-applying on
// tab switches and re-attaches. This module is the shared, pure half:
// presets, request parsing, validation, and the CDP parameter shapes both
// sides use.

export type ViewportSpec = {
  // Preset name when one was picked, "" for a custom WxH size.
  preset: string
  width: number
  height: number
  // deviceScaleFactor (page devicePixelRatio under emulation).
  dpr: number
  // The CDP `mobile` metrics flag: mobile viewport behavior (meta viewport
  // scaling, overlay scrollbars) plus touch emulation when true.
  mobile: boolean
  // "" keeps the browser's own user agent.
  userAgent: string
}

export const VIEWPORT_MIN = 200
export const VIEWPORT_WIDTH_MAX = 3840
export const VIEWPORT_HEIGHT_MAX = 2400
export const VIEWPORT_DPR_MAX = 4

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const PIXEL_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
const GALAXY_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

// The DevTools device list, trimmed to the sizes design work actually
// checks. Width/height are CSS pixels in portrait.
export const VIEWPORT_PRESETS: (ViewportSpec & { label: string })[] = [
  {
    preset: "iphone-se",
    label: "iPhone SE",
    width: 375,
    height: 667,
    dpr: 2,
    mobile: true,
    userAgent: IPHONE_UA,
  },
  {
    preset: "iphone-14",
    label: "iPhone 14",
    width: 390,
    height: 844,
    dpr: 3,
    mobile: true,
    userAgent: IPHONE_UA,
  },
  {
    preset: "iphone-14-pro-max",
    label: "iPhone 14 Pro Max",
    width: 430,
    height: 932,
    dpr: 3,
    mobile: true,
    userAgent: IPHONE_UA,
  },
  {
    preset: "pixel-7",
    label: "Pixel 7",
    width: 412,
    height: 915,
    dpr: 2.625,
    mobile: true,
    userAgent: PIXEL_UA,
  },
  {
    preset: "galaxy-s23",
    label: "Samsung Galaxy S23",
    width: 360,
    height: 780,
    dpr: 3,
    mobile: true,
    userAgent: GALAXY_UA,
  },
  {
    preset: "ipad-mini",
    label: "iPad Mini",
    width: 768,
    height: 1024,
    dpr: 2,
    mobile: true,
    userAgent: IPAD_UA,
  },
]

export const DEFAULT_PRESET = "iphone-14"

export function presetNames(): string {
  return VIEWPORT_PRESETS.map((row) => row.preset).join(", ")
}

export function findPreset(raw: string): ViewportSpec | null {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
  const hit = VIEWPORT_PRESETS.find((row) => row.preset === name)
  if (!hit) return null
  const { label: _label, ...spec } = hit
  return spec
}

export function validSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= VIEWPORT_MIN &&
    height >= VIEWPORT_MIN &&
    width <= VIEWPORT_WIDTH_MAX &&
    height <= VIEWPORT_HEIGHT_MAX
  )
}

export function validDpr(dpr: number): boolean {
  return Number.isFinite(dpr) && dpr >= 1 && dpr <= VIEWPORT_DPR_MAX
}

export function parseSize(
  raw: string,
): { width: number; height: number } | null {
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(raw.trim())
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

// The recorder reads the desired-spec file the CLI wrote; it must never
// crash or apply a half-written or hand-edited blob. Anything that does not
// fully validate reads as "no emulation".
export function shapeSpec(raw: unknown): ViewportSpec | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const width = Number(row.width)
  const height = Number(row.height)
  const dpr = Number(row.dpr)
  if (!validSize(width, height) || !validDpr(dpr)) return null
  return {
    preset: typeof row.preset === "string" ? row.preset.slice(0, 40) : "",
    width,
    height,
    dpr,
    mobile: row.mobile === true,
    userAgent:
      typeof row.userAgent === "string" ? row.userAgent.slice(0, 300) : "",
  }
}

// Two specs with the same effective metrics are the same override, preset
// name aside; the signature is what the recorder reports as applied and the
// CLI waits to see.
export function viewportSignature(spec: ViewportSpec | null): string {
  if (!spec) return "off"
  return [
    spec.width,
    spec.height,
    spec.dpr,
    spec.mobile ? 1 : 0,
    spec.userAgent,
  ].join("|")
}

export function emulationAction(
  appliedSignature: string,
  desired: ViewportSpec | null,
): "apply" | "clear" | "none" {
  if (desired)
    return viewportSignature(desired) === appliedSignature ? "none" : "apply"
  return appliedSignature === "off" ? "none" : "clear"
}

export function orientationOf(spec: Pick<ViewportSpec, "width" | "height">) {
  return spec.width >= spec.height ? "landscape" : "portrait"
}

// ---- CDP parameter shapes (recorder-side application) ----

export function metricsOverride(spec: ViewportSpec) {
  const landscape = orientationOf(spec) === "landscape"
  return {
    width: spec.width,
    height: spec.height,
    deviceScaleFactor: spec.dpr,
    mobile: spec.mobile,
    screenOrientation: {
      type: landscape ? "landscapePrimary" : "portraitPrimary",
      angle: landscape ? 90 : 0,
    },
  }
}

// Plain UA only: a partial userAgentMetadata ({mobile, platform} without
// brands) is rejected as Invalid parameters by Chromium, which would sink
// the whole override — verified live against the desktop's Chromium. The
// UA string itself is what mobile checks read; client hints stay default.
export function userAgentOverride(spec: ViewportSpec) {
  return { userAgent: spec.userAgent }
}

// ---- CLI request parsing ----

export type ViewportRequest =
  | { kind: "status" }
  | { kind: "list" }
  | { kind: "off" }
  | { kind: "set"; spec: ViewportSpec }

const OFF_WORDS = new Set(["off", "reset", "desktop", "clear"])
const LIST_WORDS = new Set(["list", "presets", "devices", "ls"])

// Parses the tokens after `viewport`. Bare flags (--landscape, --portrait,
// --desktop, --no-mobile) never consume the next token; --dpr takes a value
// (`--dpr 3` or `--dpr=3`). `current` is the spec already in effect, which
// `rotate` needs.
export function parseViewportRequest(
  argv: string[],
  current: ViewportSpec | null,
): ViewportRequest {
  const words: string[] = []
  let dprFlag: number | null = null
  let landscape = false
  let portrait = false
  let desktop = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--landscape") landscape = true
    else if (token === "--portrait") portrait = true
    else if (token === "--desktop" || token === "--no-mobile") desktop = true
    else if (token === "--mobile") desktop = false
    else if (token === "--dpr") {
      dprFlag = Number(argv[index + 1])
      index += 1
    } else if (token.startsWith("--dpr=")) dprFlag = Number(token.slice(6))
    else if (token.startsWith("--"))
      throw new Error(
        `unknown viewport flag ${token} — use --dpr N, --landscape, --portrait, or --desktop`,
      )
    else words.push(token)
  }
  if (dprFlag !== null && !validDpr(dprFlag))
    throw new Error("bad --dpr — use a number from 1 to 4")

  // `mobile` alone is the default device; `mobile PRESET|WxH` reads like the
  // bare forms.
  if (words[0] === "mobile") words.shift()
  const head = (words[0] ?? "").toLowerCase()
  if (words.length === 0 && dprFlag === null && !landscape && !portrait)
    return argv.length === 0 ? { kind: "status" } : setSpec(defaultSpec(), {})
  if (words.length === 0) {
    // Only flags: adjust the device already in effect, else the default.
    return setSpec(current ?? defaultSpec(), {
      dprFlag,
      landscape,
      portrait,
      desktop,
    })
  }
  if (OFF_WORDS.has(head)) return { kind: "off" }
  if (LIST_WORDS.has(head)) return { kind: "list" }
  if (head === "status") return { kind: "status" }
  if (head === "rotate") {
    if (!current)
      throw new Error(
        `no mobile viewport to rotate — set one first (viewport mobile, a preset, or a size like 390x844)`,
      )
    return setSpec(
      { ...current, width: current.height, height: current.width },
      { dprFlag, desktop },
    )
  }
  const preset = findPreset(words[0])
  if (preset) return setSpec(preset, { dprFlag, landscape, portrait, desktop })
  const size = parseSize(words[0])
  if (size) {
    if (!validSize(size.width, size.height))
      throw new Error(
        `bad viewport size ${words[0]} — width ${VIEWPORT_MIN}-${VIEWPORT_WIDTH_MAX}, height ${VIEWPORT_MIN}-${VIEWPORT_HEIGHT_MAX}`,
      )
    // A bare size is a design-development ask: mobile metrics and touch at
    // phone/tablet widths, unless --desktop says it is just a resize. The
    // dpr default 2 matches phones; CSS media queries see WxH either way.
    return setSpec(
      {
        preset: "",
        width: size.width,
        height: size.height,
        dpr: desktop ? 1 : 2,
        mobile: !desktop,
        userAgent: "",
      },
      { dprFlag, landscape, portrait, desktop },
    )
  }
  throw new Error(
    `unknown device '${words[0]}' — viewport list names the presets (${presetNames()}), or pass a size like 390x844`,
  )
}

function defaultSpec(): ViewportSpec {
  return findPreset(DEFAULT_PRESET) as ViewportSpec
}

function setSpec(
  base: ViewportSpec,
  opts: {
    dprFlag?: number | null
    landscape?: boolean
    portrait?: boolean
    desktop?: boolean
  },
): ViewportRequest {
  const spec = { ...base }
  if (opts.dprFlag) spec.dpr = opts.dprFlag
  if (opts.desktop) spec.mobile = false
  if (opts.landscape && spec.width < spec.height)
    [spec.width, spec.height] = [spec.height, spec.width]
  if (opts.portrait && spec.height < spec.width)
    [spec.width, spec.height] = [spec.height, spec.width]
  if (!validSize(spec.width, spec.height))
    throw new Error(
      `bad viewport size ${spec.width}x${spec.height} — width ${VIEWPORT_MIN}-${VIEWPORT_WIDTH_MAX}, height ${VIEWPORT_MIN}-${VIEWPORT_HEIGHT_MAX}`,
    )
  return { kind: "set", spec }
}
