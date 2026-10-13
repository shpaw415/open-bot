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
cat "$CURL_RESPONSE"
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
      CURL_RESPONSE: join(home, "curl.response"),
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
    writeFileSync(
      join(home, "curl.response"),
      '{"item":{"id":"i1","name":"logo.png","kind":"image"},"skipped":false}',
    )
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
    writeFileSync(
      join(home, "curl.response"),
      '{"item":{"id":"i1","name":"logo.png","kind":"image"},"skipped":false}',
    )
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

test("remove keeps the desktop file by default", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"ok":true,"sourceDeleted":0,"warnings":[]}',
    )
    const result = await run(home, ["remove", "i1"])
    expect(result.code).toBe(0)
    const args = await Bun.file(join(home, "curl.args")).text()
    expect(args).toContain("DELETE")
    expect(args).toContain("/api/media/items/i1")
    expect(args).not.toContain("source=1")
    expect(result.stdout).toContain("desktop file was kept")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("remove --source deletes the desktop file", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"ok":true,"sourceDeleted":1,"warnings":[]}',
    )
    const result = await run(home, ["remove", "--source", "i1"])
    expect(result.code).toBe(0)
    const args = await Bun.file(join(home, "curl.args")).text()
    expect(args).toContain("/api/media/items/i1?source=1")
    expect(result.stdout).toContain("deleted the desktop file")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("remove --source reports warnings and fails", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"ok":true,"sourceDeleted":0,"warnings":["the desktop is not running — desktop files were kept"]}',
    )
    const result = await run(home, ["remove", "--source", "i1"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("not running")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("remove-album --source reports how many desktop files went", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-media-"))
  try {
    fakeCurl(home)
    writeFileSync(
      join(home, "curl.response"),
      '{"ok":true,"sourceDeleted":3,"warnings":[]}',
    )
    const result = await run(home, ["remove-album", "--source", "a1"])
    expect(result.code).toBe(0)
    const args = await Bun.file(join(home, "curl.args")).text()
    expect(args).toContain("/api/media/albums/a1?source=1")
    expect(result.stdout).toContain("deleted 3 desktop file(s)")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
