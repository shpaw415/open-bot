import { existsSync, readFileSync } from "node:fs"
import { evaluate, HIT_SCRIPT, pageSocket, type Socket } from "./hittest"

type CaptureState = {
  factor: number
  ox: number
  oy: number
  ts?: number
  origin?: boolean
}

function loadState(path: string): CaptureState {
  if (!existsSync(path)) return { factor: 1, ox: 0, oy: 0, origin: true }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"))
    const factor = Number(raw?.factor)
    const ox = Number(raw?.ox)
    const oy = Number(raw?.oy)
    if (
      !Number.isInteger(factor) ||
      factor < 1 ||
      factor > 3 ||
      !Number.isInteger(ox) ||
      !Number.isInteger(oy)
    ) {
      return { factor: 1, ox: 0, oy: 0, origin: true }
    }
    return {
      factor,
      ox,
      oy,
      ts: Number(raw?.ts) || undefined,
      origin: raw?.origin !== false,
    }
  } catch {
    return { factor: 1, ox: 0, oy: 0, origin: true }
  }
}

export function toLive(
  state: CaptureState,
  imageX: number,
  imageY: number,
): { x: number; y: number } {
  return {
    x: Math.floor(imageX / state.factor) + state.ox,
    y: Math.floor(imageY / state.factor) + state.oy,
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
  if (state.factor === 1 && state.ox === 0 && state.oy === 0) {
    console.error(
      "note: no scaled capture is recorded for this screen; image coordinates were used as live coordinates",
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
