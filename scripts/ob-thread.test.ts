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

const script = join(import.meta.dir, "ob-thread.sh")

function fakeCurl(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
method=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  if [ "$prev" = "-X" ]; then method="$arg"; fi
  prev="$arg"
done
if [ "$method" = "GET" ]; then
  printf '%s\\n' '{"threads":[{"id":"t1","title":"worker:job"},{"id":"t2","title":"Chat"}]}'
else
  printf '%s\\n' '{"id":"ses_1","title":"worker:Scrape prices","display":false}'
fi
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
  return bin
}

async function run(
  home: string,
  args: string[],
  extra: Record<string, string> = {},
) {
  const proc = Bun.spawn(["sh", script, ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPEN_BOT_LLM_TOKEN: "test",
      PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}`,
      CURL_ARGS: join(home, "curl.args"),
      CURL_BODY: join(home, "curl.body"),
      ...extra,
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

async function argsOf(home: string) {
  return (await Bun.file(join(home, "curl.args")).text()).split("\n")
}

async function bodyOf(home: string) {
  return JSON.parse(await Bun.file(join(home, "curl.body")).text())
}

test("start posts the title, display flag, and message", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, [
      "start",
      "--title",
      "Scrape prices",
      "--message",
      "go fetch",
      "--display",
    ])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      id: "ses_1",
      title: "worker:Scrape prices",
      display: false,
    })
    const args = await argsOf(home)
    expect(args).toContain("-X")
    expect(args).toContain("POST")
    expect(args.join(" ")).toContain("/api/threads")
    expect(await bodyOf(home)).toEqual({
      title: "Scrape prices",
      display: true,
      message: "go fetch",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("start without --display omits the flag from the body", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["start", "--title", "Job"])
    expect(result.code).toBe(0)
    expect(await bodyOf(home)).toEqual({ title: "Job" })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("--persona defaults to visible and sends the persona", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, [
      "start",
      "--title",
      "Add export",
      "--persona",
      "Software manager",
      "--message",
      "do it",
    ])
    expect(result.code).toBe(0)
    expect(await bodyOf(home)).toEqual({
      title: "Add export",
      display: true,
      persona: "Software manager",
      message: "do it",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("--hidden overrides the persona visibility default", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, [
      "start",
      "--title",
      "bg",
      "--persona",
      "Software manager",
      "--hidden",
    ])
    expect(result.code).toBe(0)
    expect(await bodyOf(home)).toEqual({
      title: "bg",
      persona: "Software manager",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("prints the matched persona when the control plane returns one", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    const bin = join(home, "bin")
    mkdirSync(bin)
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"id":"ses_2","title":"worker:Add export","display":false,"persona":{"id":"p1","name":"Software manager","matched":"fuzzy"}}'
`,
    )
    chmodSync(join(bin, "curl"), 0o755)
    const result = await run(home, [
      "start",
      "--persona",
      "softwre managr",
      "--hidden",
    ])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      id: "ses_2",
      title: "worker:Add export",
      display: false,
      persona: { id: "p1", name: "Software manager", matched: "fuzzy" },
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("an unknown persona fails with suggestions", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    const bin = join(home, "bin")
    mkdirSync(bin)
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"error":"unknown persona \\"zzz\\"","suggestions":["Software manager","Chef"]}'
`,
    )
    chmodSync(join(bin, "curl"), 0o755)
    const result = await run(home, ["start", "--persona", "zzz"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("unknown persona")
    expect(result.stderr).toContain("did you mean: Software manager, Chef")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("bare start sends an empty body", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["start"])
    expect(result.code).toBe(0)
    expect(await bodyOf(home)).toEqual({})
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("list issues a GET and prints one line per hidden thread", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["list"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("- [t1] worker:job\n- [t2] Chat\n")
    const args = await argsOf(home)
    expect(args).toContain("GET")
    expect(args.join(" ")).toContain("/api/threads")
    expect(await Bun.file(join(home, "curl.body")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("control-plane errors fail with the server message", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    const bin = join(home, "bin")
    mkdirSync(bin)
    writeFileSync(
      join(bin, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"error":"title cannot start with the reserved worker: prefix"}'
`,
    )
    chmodSync(join(bin, "curl"), 0o755)
    const result = await run(home, ["start", "--title", "worker:x"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("reserved worker: prefix")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("unknown options and commands fail before calling curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const badOption = await run(home, ["start", "--stealth"])
    expect(badOption.code).toBe(2)
    expect(badOption.stderr).toContain("unknown option: --stealth")
    const badCmd = await run(home, ["remove", "x"])
    expect(badCmd.code).toBe(2)
    expect(badCmd.stderr).toContain("unknown command: remove")
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("missing token fails before calling curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["list"], { OPEN_BOT_LLM_TOKEN: "" })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("OPEN_BOT_LLM_TOKEN")
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function fakeCurlWithDelete(home: string, emptyList = false) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
prev=""
method=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then printf '%s' "$arg" > "$CURL_BODY"; fi
  if [ "$prev" = "-X" ]; then method="$arg"; fi
  prev="$arg"
done
if [ "$method" = "GET" ]; then
  ${emptyList ? "printf '%s\\n' '{\"threads\":[]}'" : 'printf \'%s\\n\' \'{"threads":[{"id":"t1","title":"worker:job"},{"id":"t2","title":"worker:cleanup"}]}\''}
elif [ "$method" = "DELETE" ]; then
  printf '%s\\n' '{"deleted":["t1"],"skipped":[{"id":"t2","reason":"not a hidden agent thread"}]}'
else
  printf '%s\\n' '{"id":"ses_1","title":"worker:Scrape prices","display":false}'
fi
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
}

test("delete sends the ids and reports skipped threads", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithDelete(home)
    const result = await run(home, ["delete", "t1", "t2"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      "deleted: t1\nskipped [t2]: not a hidden agent thread\n",
    )
    const args = await argsOf(home)
    expect(args).toContain("DELETE")
    expect(args.join(" ")).toContain("/api/threads")
    expect(await bodyOf(home)).toEqual({ ids: ["t1", "t2"] })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("delete --all expands the list into ids", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithDelete(home)
    const result = await run(home, ["delete", "--all"])
    expect(result.code).toBe(0)
    // The ids were never passed on the CLI: they came from the list call.
    expect(await bodyOf(home)).toEqual({ ids: ["t1", "t2"] })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("delete --all with nothing to delete fails before the delete call", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithDelete(home, true)
    const result = await run(home, ["delete", "--all"])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("nothing to delete")
    // Only the list GET ran — no DELETE request carried a body.
    expect(await argsOf(home)).not.toContain("DELETE")
    expect(await Bun.file(join(home, "curl.body")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("delete without ids prints usage", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithDelete(home)
    const result = await run(home, ["delete"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("Usage:")
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("stop posts to the thread stop route", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["stop", "t1"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ses_1")
    const args = await argsOf(home)
    expect(args).toContain("POST")
    expect(args.join(" ")).toContain("/api/threads/t1/stop")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("post sends the message body to the thread post route", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    const result = await run(home, ["post", "t1", "Stop editing", "and report"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ses_1")
    const args = await argsOf(home)
    expect(args.join(" ")).toContain("/api/threads/t1/post")
    expect(await bodyOf(home)).toEqual({
      message: "Stop editing and report",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("stop and post usage errors never call curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurl(home)
    expect((await run(home, ["stop"])).code).toBe(2)
    expect((await run(home, ["post", "t1"])).code).toBe(2)
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function fakeCurlWithStatus(home: string) {
  const bin = join(home, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$CURL_ARGS"
n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0)
n=$((n+1))
printf '%s' "$n" > "$FAKE_COUNT"
if [ "$n" -le 1 ]; then
  printf '%s\\n' '{"id":"t1","running":true,"state":"busy"}'
else
  printf '%s\\n' '{"id":"t1","running":false,"state":"idle"}'
fi
`,
  )
  chmodSync(join(bin, "curl"), 0o755)
}

test("wait polls until the thread goes idle and prints the final state", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithStatus(home)
    const result = await run(home, ["wait", "t1", "--timeout", "1"], {
      FAKE_COUNT: join(home, "count"),
    })
    expect(result.code).toBe(0)
    const out = JSON.parse(result.stdout) as {
      id: string
      running: boolean
      state: string
      waitedSeconds: number
      timeout: boolean
    }
    expect(out).toMatchObject({
      id: "t1",
      running: false,
      state: "idle",
      timeout: false,
    })
    expect(out.waitedSeconds).toBeGreaterThanOrEqual(5)
    expect((await argsOf(home)).join(" ")).toContain("/api/threads/t1/status")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}, 20_000)

test("wait validates the timeout and id before calling curl", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-thread-"))
  try {
    fakeCurlWithStatus(home)
    const noId = await run(home, ["wait"])
    expect(noId.code).toBe(2)
    expect(noId.stderr).toContain("Usage:")
    const badTimeout = await run(home, ["wait", "t1", "--timeout", "abc"])
    expect(badTimeout.code).toBe(2)
    expect(badTimeout.stderr).toContain("whole number of minutes")
    const tooBig = await run(home, ["wait", "t1", "--timeout", "111"])
    expect(tooBig.code).toBe(2)
    expect(tooBig.stderr).toContain("limited to 1-110 minutes")
    expect(await Bun.file(join(home, "curl.args")).exists()).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
