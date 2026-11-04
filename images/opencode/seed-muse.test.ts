import { expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "seed-muse.sh")

function layout() {
  const root = mkdtempSync(join(tmpdir(), "ob-seed-muse-"))
  const home = join(root, "home")
  const seed = join(root, "seed")
  const links = join(root, "bin")
  mkdirSync(home, { recursive: true })
  mkdirSync(seed, { recursive: true })
  mkdirSync(links, { recursive: true })
  writeFileSync(join(seed, "muse"), "#!/bin/sh\n# seed launcher\n")
  writeFileSync(join(seed, ".muse-version"), "1.2.3-R4\n")
  writeFileSync(join(seed, "muse-bin-1.2.3-R4"), "binary")
  return { root, home, seed, links }
}

async function run(home: string, seed: string, links: string) {
  const proc = Bun.spawn(["sh", script, links], {
    env: { ...process.env, HOME: home, MUSE_SEED_DIR: seed },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

test("seeds launcher + binary into home and symlinks the bin dir", async () => {
  const { home, seed, links } = layout()
  const result = await run(home, seed, links)
  expect(result.code).toBe(0)
  const target = join(home, ".local/bin/muse")
  expect(readFileSync(target, "utf8")).toContain("seed launcher")
  expect(existsSync(join(home, ".local/bin/muse-bin-1.2.3-R4"))).toBe(true)
  expect(readFileSync(join(home, ".local/bin/.muse-version"), "utf8")).toBe(
    "1.2.3-R4\n",
  )
  expect(lstatSync(join(links, "muse")).isSymbolicLink()).toBe(true)
  expect(readlinkSync(join(links, "muse"))).toBe(target)
})

test("never clobbers a home launcher or its downloaded binary", async () => {
  const { home, seed, links } = layout()
  const targetDir = join(home, ".local/bin")
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, "muse"), "#!/bin/sh\n# updated launcher\n")
  writeFileSync(join(targetDir, ".muse-version"), "9.9.9-R9\n")
  writeFileSync(join(targetDir, "muse-bin-9.9.9-R9"), "newer binary")
  const result = await run(home, seed, links)
  expect(result.code).toBe(0)
  expect(readFileSync(join(targetDir, "muse"), "utf8")).toContain(
    "updated launcher",
  )
  expect(readFileSync(join(targetDir, ".muse-version"), "utf8")).toBe(
    "9.9.9-R9\n",
  )
})

test("adopts a stale regular-file launcher from the link dir", async () => {
  const { home, seed, links } = layout()
  // No seed launcher: the pre-fix desktop layout (regular file in bin).
  const { rmSync } = await import("node:fs")
  rmSync(join(seed, "muse"))
  rmSync(join(seed, ".muse-version"))
  writeFileSync(join(links, "muse"), "#!/bin/sh\n# stale launcher\n")
  const result = await run(home, seed, links)
  expect(result.code).toBe(0)
  expect(readFileSync(join(home, ".local/bin/muse"), "utf8")).toContain(
    "stale launcher",
  )
  expect(lstatSync(join(links, "muse")).isSymbolicLink()).toBe(true)
})
