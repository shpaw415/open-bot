import { existsSync, readFileSync } from "node:fs"
import { evaluate, HIT_SCRIPT, pageSocket, type Socket } from "./hittest"

type CaptureState = {
  factor: number
  yFactor: number
  ox: number
  oy: number
  // devicePixelRatio recorded at capture time (browser zoom x display
  // scale). Absent on legacy state files — treated as 1.
  dpr?: number
  ts?: number
  origin?: boolean
}

// Zoom-out legitimately produces sub-1 ratios (dpr 0.5 at 50% zoom, factor
// below 1 on a 1x capture), and zoom-in plus a 3x scaled shot pushes the
// factor well past the old cap of 10 — both used to fall back to identity
// and silently mis-map clicks.
const RATIO_MIN = 0.05
const RATIO_MAX = 40

function ratio(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < RATIO_MIN || n > RATIO_MAX) return null
  return n
}

function loadState(path: string): CaptureState {
  if (!existsSync(path))
    return { factor: 1, yFactor: 1, ox: 0, oy: 0, origin: true }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    const factor = ratio(raw?.factor)
    const ox = Number(raw?.ox)
    const oy = Number(raw?.oy)
    if (factor === null || !Number.isInteger(ox) || !Number.isInteger(oy)) {
      return { factor: 1, yFactor: 1, ox: 0, oy: 0, origin: true }
    }
    const yFactor = ratio(raw?.yFactor) ?? factor
    return {
      factor,
      yFactor,
      ox,
      oy,
      dpr: ratio(raw?.dpr) ?? 1,
      ts: Number(raw?.ts) || undefined,
      origin: raw?.origin !== false,
    }
  } catch {
    return { factor: 1, yFactor: 1, ox: 0, oy: 0, origin: true }
  }
}

// Image px are capture-px per CSS px (factor); live screen px are CSS px
// times dpr, shifted by the (already device-px) window offset. At dpr 1
// this is the plain divide-and-shift it always was.
export function toLive(
  state: CaptureState,
  imageX: number,
  imageY: number,
): { x: number; y: number } {
  const dpr = state.dpr && state.dpr > 0 ? state.dpr : 1
  return {
    x: Math.floor((imageX / state.factor) * dpr) + state.ox,
    y: Math.floor((imageY / state.yFactor) * dpr) + state.oy,
  }
}

async function main() {
  const mode = process.argv[2]
  const port = Number(process.argv[3])
  const statePath = process.argv[4]
  const imageX = Number(process.argv[5])
  const imageY = Number(process.argv[6])
  if (
    (mode !== "map" && mode !== "hit-image") ||
    !Number.isInteger(port) ||
    !statePath ||
    !Number.isFinite(imageX) ||
    !Number.isFinite(imageY)
  ) {
    throw new Error("usage: coord.ts map|hit-image PORT STATE_FILE X Y")
  }
  const state = loadState(statePath)
  if (!state.origin) {
    console.error(
      "warning: the browser window offset could not be measured for that capture; treating the viewport as starting at 0,0",
    )
  }
  if (state.ts && Date.now() - state.ts > 10 * 60_000) {
    console.error(
      `warning: capture state is ${Math.round((Date.now() - state.ts) / 60_000)} minutes old; if the window moved since, capture again`,
    )
  }
  if (
    state.factor === 1 &&
    state.yFactor === 1 &&
    (state.dpr ?? 1) === 1 &&
    state.ox === 0 &&
    state.oy === 0
  ) {
    console.error(
      "note: no scaled capture is recorded for this screen; image coordinates were used as live coordinates",
    )
  }
  if (state.dpr && Math.abs(state.dpr - 1) > 0.01) {
    console.error(
      `note: that capture was taken at browser zoom ~${Math.round(state.dpr * 100) / 100}x (dpr ${Math.round(state.dpr * 100) / 100}); the conversion above already accounts for it — viewport CSS coordinates are not live screen pixels at this zoom`,
    )
  }
  const { x, y } = toLive(state, imageX, imageY)
  console.log(`live ${x} ${y}`)
  if (mode === "map") return
  const socket: Socket = await pageSocket(port)
  try {
    const value = await evaluate(
      socket,
      `(${HIT_SCRIPT})(${JSON.stringify(x)}, ${JSON.stringify(y)})`,
    )
    console.log(JSON.stringify(value ?? { hit: "no result" }))
  } finally {
    socket.close()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "coord failed")
    process.exit(1)
  })
}
