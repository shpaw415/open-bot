import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toLive } from "./coord"

const script = join(import.meta.dir, "coord.ts")

function seed(home: string, state: object | null) {
  const dir = join(home, ".open-bot")
  mkdirSync(dir, { recursive: true })
  if (state !== null) {
    writeFileSync(join(dir, "capture-9223.json"), JSON.stringify(state))
  }
}

async function run(home: string, mode: string, x: string, y: string) {
  const proc = Bun.spawn(
    [
      "bun",
      script,
      mode,
      "9223",
      join(home, ".open-bot/capture-9223.json"),
      x,
      y,
    ],
    {
      env: { ...process.env, HOME: home },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  return { code, stdout }
}

test("image-to-live conversion divides by factor and adds the offset", () => {
  expect(toLive({ factor: 2, ox: 86, oy: 132 }, 1545, 622)).toEqual({
    x: 858,
    y: 443,
  })
  expect(toLive({ factor: 1, ox: 0, oy: 0 }, 772, 311)).toEqual({
    x: 772,
    y: 311,
  })
  expect(toLive({ factor: 3, ox: 10, oy: 20 }, 90, 60)).toEqual({
    x: 40,
    y: 40,
  })
})

test("map prints live coordinates from the recorded capture state", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, { factor: 2, ox: 40, oy: 50, ts: Date.now(), origin: true })
  const result = await run(home, "map", "1545", "622")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 812 361")
})

test("map without a recorded state falls back to identity", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, null)
  const result = await run(home, "map", "772", "311")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 772 311")
})
