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
  expect(toLive({ factor: 2, yFactor: 2, ox: 86, oy: 132 }, 1545, 622)).toEqual(
    {
      x: 858,
      y: 443,
    },
  )
  expect(toLive({ factor: 1, yFactor: 1, ox: 0, oy: 0 }, 772, 311)).toEqual({
    x: 772,
    y: 311,
  })
  expect(toLive({ factor: 3, yFactor: 3, ox: 10, oy: 20 }, 90, 60)).toEqual({
    x: 40,
    y: 40,
  })
})

test("fractional factors map upscaled captures back to live coordinates", () => {
  expect(
    toLive({ factor: 1.34, yFactor: 1.49, ox: 0, oy: 0 }, 2560, 1600),
  ).toEqual({ x: 1910, y: 1073 })
  expect(
    toLive({ factor: 1.5, yFactor: 1.5, ox: 4, oy: 125 }, 1911, 1074),
  ).toEqual({
    x: 1278,
    y: 841,
  })
})

test("a legacy state without yFactor divides both axes by factor", () => {
  expect(toLive({ factor: 2, yFactor: 2, ox: 0, oy: 0 }, 100, 100)).toEqual({
    x: 50,
    y: 50,
  })
})

test("map prints live coordinates from the recorded capture state", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, {
    factor: 2,
    yFactor: 2,
    ox: 40,
    oy: 50,
    ts: Date.now(),
    origin: true,
  })
  const result = await run(home, "map", "1545", "622")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 812 361")
})

test("map honors fractional upscaled factors", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, { factor: 1.34, yFactor: 1.49, ox: 0, oy: 0, origin: true })
  const result = await run(home, "map", "2560", "1600")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 1910 1073")
})

test("map rejects an out-of-range factor and falls back to identity", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, { factor: 40, ox: 0, oy: 0, origin: true })
  const result = await run(home, "map", "772", "311")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 772 311")
})

test("map without a recorded state falls back to identity", async () => {
  const home = mkdtempSync(join(tmpdir(), "coord-"))
  seed(home, null)
  const result = await run(home, "map", "772", "311")
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("live 772 311")
})
