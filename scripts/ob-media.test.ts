import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "ob-media.sh")

function fakeCurl(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  prev="$arg"
done
printf '%s\\n' '{"item":{"id":"i1","name":"logo.png","kind":"image"},"skipped":false}'
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
  return bin
}

async function run(home: string, args: string[]) {
  const proc = Bun.spawn(["sh", script, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_LLM_TOKEN: "test",
      OPEN_BOT_MEDIA_ROOT: home,
      PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}`,
      CURL_ARGS: join(home, "curl.args"),
      CURL_BODY: join(home, "curl.body"),
    },
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

test("a missing file fails before the control plane", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    const missing = join(home, "nope.png")
    const result = await run(home, [
      "push",
      "--album",
      "Logos",
      "--path",
      missing,
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`file does not exist: ${missing}`)
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("tilde expands and the canonical path is sent", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    const file = join(home, "logo.png")
    writeFileSync(file, "png")
    const result = await run(home, [
      "push",
      "--album",
      "Logos",
      "--path",
      "~/logo.png",
      "--title",
      "Cabin",
    ])
    expect(result.code).toBe(0)
    const body = await Bun.file(join(home, "curl.body")).text()
    expect(JSON.parse(body)).toEqual({
      album: "Logos",
      path: file,
      title: "Cabin",
    })
    expect(result.stdout).toContain("logo.png")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
