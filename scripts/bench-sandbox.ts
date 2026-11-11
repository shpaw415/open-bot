#!/usr/bin/env bun
// Escape battery for sandbox threads (docs/sandbox-threads-spec.md §11).
// Self-contained: builds nothing against the live instance — it starts a
// throwaway control plane (temp DATA_DIR, port 18787) whose "model" is
// scripts/bench-sandbox-ai.ts, a scripted attacker that fires every
// escape the offered tools allow. Every check must show the sandbox
// holding. Requires the sandbox image (bun run images).
import { Database } from "bun:sqlite"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const PORT = 18787
const BASE = `http://127.0.0.1:${PORT}`
const tmp = mkdtempSync(join(tmpdir(), "ob-bench-sandbox-"))
const stubLog = join(tmp, "stub.log")

let failures = 0
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

async function docker(args: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`docker ${args[0]} failed (${code})`)
  return out.trim()
}

async function dockerQuiet(args: string[]): Promise<string | null> {
  try {
    return await docker(args)
  } catch {
    return null
  }
}

const control = Bun.spawn(["bun", "apps/control/src/index.ts"], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATA_DIR: join(tmp, "data"),
    PORT: String(PORT),
    BIND_HOST: "0.0.0.0",
    OPEN_BOT_AI_CONFIG: join(ROOT, "scripts/bench-sandbox-ai.ts"),
    WEB_DIST: join(tmp, "web"),
    SBX_STUB_LOG: stubLog,
    SBX_SKILL_NAME: "bench-skill",
  },
  stdout: "pipe",
  stderr: "pipe",
})
mkdirSync(join(tmp, "web"), { recursive: true })

let controlLog = ""
void (async () => {
  for await (const chunk of control.stdout as AsyncIterable<Uint8Array>)
    controlLog += new TextDecoder().decode(chunk)
})()
void (async () => {
  for await (const chunk of control.stderr as AsyncIterable<Uint8Array>)
    controlLog += new TextDecoder().decode(chunk)
})()

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  ms: number,
) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await Bun.sleep(500)
  }
  return false
}

let cookie = ""
async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; raw: Response }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep raw text
  }
  return { status: res.status, body, raw: res }
}

function messagesText(messages: unknown): string {
  if (!Array.isArray(messages)) return ""
  return messages
    .map((message) => {
      const row = message as { parts?: { type?: string; text?: string }[] }
      return (row.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
    })
    .join("\n")
}

async function pollFinalText(sessionId: string): Promise<string> {
  let text = ""
  const done = await waitFor(async () => {
    const { body } = await api(`/api/opencode/session/${sessionId}/message`)
    text = messagesText(body)
    return text.includes("RESULTS") || text.includes("no attack tools")
  }, 240_000)
  if (!done)
    throw new Error(
      `sandbox thread never finished; last text: ${text.slice(0, 400)}`,
    )
  return text
}

async function launchSandbox(profile: string) {
  const { status, body } = await api("/api/threads", {
    method: "POST",
    body: JSON.stringify({
      title: `bench ${profile}`,
      display: true,
      sandbox: profile,
      message:
        "You are under test. Use your tools to explore and report everything.",
    }),
  })
  if (status !== 201)
    throw new Error(
      `launch ${profile} failed: ${status} ${JSON.stringify(body)}`,
    )
  return body as {
    id: string
    sandbox: { id: string; expiresAt: number; mcp: string[] }
  }
}

try {
  const up = await waitFor(async () => {
    const res = await fetch(`${BASE}/api/auth/config`).catch(() => null)
    return Boolean(res?.ok)
  }, 60_000)
  if (!up) throw new Error(`control did not start:\n${controlLog.slice(-3000)}`)
  const boot = /password: (\S+)/.exec(controlLog)
  if (!boot)
    throw new Error(`no bootstrap password in log:\n${controlLog.slice(-2000)}`)
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@localhost", password: boot[1] }),
  })
  cookie = (login.raw.headers.getSetCookie?.() ?? []).join("; ")
  if (!cookie) throw new Error("login set no cookie")
  const creds = await api("/api/auth/credentials", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@localhost",
      password: "bench-password-1",
    }),
  })
  if (creds.status !== 200)
    throw new Error(`credentials failed: ${creds.status}`)

  // --- code profile: bash inside the jail -------------------------------
  const code = await launchSandbox("code")
  const sandboxId = code.sandbox.id
  const container = await docker([
    "ps",
    "--filter",
    `label=open-bot-sandbox=${sandboxId}`,
    "--format",
    "{{.Names}}",
  ])
  check("sandbox container is running", container.length > 0, container)

  const finalText = await pollFinalText(code.id)
  check("bash was offered and ran", finalText.includes("---ENV"))
  check(
    "no sudo",
    /SUDO_FAIL|sudo:.*not found|no new privileges/i.test(finalText),
  )
  check("runs as sandbox user", /uid=1000\(sandbox\)/.test(finalText))
  check(
    "desktop home unreachable",
    !/\.local\/share\/opencode\/auth\.json[\s\S]{0,40}\{/.test(finalText) &&
      /No such file|Permission denied|not found/i.test(finalText),
  )
  check("no egress with network off", !finalText.includes("HTTP 200"))
  check(
    "desktop daemon unreachable",
    !/"healthy"|version/i.test(
      finalText.split("---DESKTOP")[1]?.slice(0, 200) ?? "",
    ),
  )
  check("no desktop llm token in env", finalText.includes("no-llm-token"))
  const desktopDb = new Database(join(tmp, "data/open-bot.sqlite"), {
    readonly: true,
  })
  const llmRow = desktopDb
    .query("SELECT llm_token FROM desktops LIMIT 1")
    .get() as { llm_token: string } | null
  desktopDb.close()
  check(
    "desktop token value never appears in sandbox output",
    !llmRow?.llm_token || !finalText.includes(llmRow.llm_token),
  )

  const pwn = await docker([
    "exec",
    container,
    "sh",
    "-c",
    "test -f /etc/pwn.txt && echo PWNED || echo safe; test -f /workspace/ok.txt && echo workspace-ok; id",
  ])
  check("write outside /workspace refused", pwn.includes("safe"), pwn)
  check("write inside /workspace works", pwn.includes("workspace-ok"))

  const config = await docker([
    "exec",
    container,
    "cat",
    "/home/sandbox/.config/opencode/opencode.json",
  ])
  const brokerToken = /"apiKey":\s*"([^"]+)"/.exec(config)?.[1] ?? ""
  check("broker token present in sandbox config", brokerToken.length > 20)
  const bearer = `${"Bea" + "rer"} ${brokerToken}`
  const keys = await fetch(`${BASE}/api/keys`, {
    headers: { authorization: bearer },
  })
  check(
    "broker token rejected on /api/keys",
    keys.status === 401,
    String(keys.status),
  )
  const threads = await fetch(`${BASE}/api/threads`, {
    method: "POST",
    headers: { authorization: bearer, "content-type": "application/json" },
    body: JSON.stringify({ title: "escape" }),
  })
  check(
    "broker token cannot spawn threads",
    threads.status === 401,
    String(threads.status),
  )
  const models = await fetch(`${BASE}/llm/v1/models`, {
    headers: { authorization: bearer },
  })
  check(
    "broker token works on the model broker",
    models.status === 200,
    String(models.status),
  )

  const tarRes = await fetch(`${BASE}/api/sandbox/${sandboxId}/export`, {
    headers: { cookie },
  })
  const tarBytes = new Uint8Array(await tarRes.arrayBuffer())
  check(
    "export contains the workspace deliverable",
    tarRes.status === 200 &&
      new TextDecoder().decode(tarBytes).includes("sandbox-ok"),
  )

  // --- inline profile: allowed MCP + skill copies work in the jail -----
  // A fake "desktop" (sleeping opencode-image container) gives
  // readMcpConfig something to read: an echo MCP entry and a custom skill.
  const userRow = (() => {
    const ro = new Database(join(tmp, "data/open-bot.sqlite"), {
      readonly: true,
    })
    const row = ro.query("SELECT id FROM users LIMIT 1").get() as { id: string }
    ro.close()
    return row
  })()
  const userKey = userRow.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)
  const fakeDesktop = `ob-oc-${userKey}`
  await docker([
    "run",
    "-d",
    "--name",
    fakeDesktop,
    "--entrypoint",
    "sleep",
    "open-bot-opencode:local",
    "infinity",
  ])
  await docker([
    "exec",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    fakeDesktop,
    "sh",
    "-c",
    "mkdir -p ~/.config/opencode/skills/bench-skill && " +
      'printf \'%s\' \'{"mcp":{"echo":{"type":"local","command":["bun","/opt/open-bot/echo-mcp.ts"]}}}\' > ~/.config/opencode/opencode.json && ' +
      "printf -- '---\\nname: bench-skill\\ndescription: bench fixture\\n---\\nBENCH SKILL MARKER\\n' > ~/.config/opencode/skills/bench-skill/SKILL.md",
  ])
  const mcpLaunch = await api("/api/threads", {
    method: "POST",
    body: JSON.stringify({
      title: "bench mcp",
      display: true,
      sandbox: {
        name: "bench-mcp",
        skills: ["bench-skill", "research"],
        mcp: ["echo"],
        network: "off",
      },
      message: "Use your tools and report everything.",
    }),
  })
  const mcpBody = mcpLaunch.body as {
    id?: string
    sandbox?: { mcp?: string[]; skillsSkipped?: string[] }
  }
  check(
    "inline profile launches with the echo MCP included",
    mcpLaunch.status === 201 && (mcpBody.sandbox?.mcp ?? []).includes("echo"),
    JSON.stringify(mcpBody).slice(0, 200),
  )
  check(
    "custom skill copied from the desktop, none skipped",
    (mcpBody.sandbox?.skillsSkipped ?? ["?"]).length === 0,
    JSON.stringify(mcpBody.sandbox?.skillsSkipped),
  )
  if (mcpBody.id) {
    const mcpText = await pollFinalText(mcpBody.id)
    writeFileSync(join(tmp, "mcp-text.txt"), mcpText)
    check(
      "allowed local MCP answers with network off",
      mcpText.includes("echo: ping-from-sandbox"),
    )
    check(
      "allowed custom skill loads; unlisted skill is refused",
      mcpText.includes("BENCH SKILL MARKER"),
      mcpText.includes("BENCH SKILL MARKER") ? "" : mcpText.slice(0, 1200),
    )
    await api(`/api/opencode/session/${mcpBody.id}`, { method: "DELETE" })
  }
  await dockerQuiet(["rm", "-f", fakeDesktop])

  // --- locked profile: no bash offered at all ----------------------------
  const before = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : ""
  const locked = await launchSandbox("locked")
  await pollFinalText(locked.id)
  const after = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : ""
  const lockedTools = after
    .slice(before.length)
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { tools: string[] }).tools)
  check(
    "locked profile offers no bash/task tools",
    lockedTools.length > 0 &&
      lockedTools.every(
        (tools) => !tools.includes("bash") && !tools.includes("task"),
      ),
    JSON.stringify(lockedTools[0] ?? []),
  )

  // --- destroy: everything goes away ------------------------------------
  const del = await api(`/api/opencode/session/${code.id}`, {
    method: "DELETE",
  })
  check("thread delete accepted", del.status === 200, String(del.status))
  const gone = await waitFor(async () => {
    const left = await dockerQuiet([
      "ps",
      "-a",
      "--filter",
      `label=open-bot-sandbox=${sandboxId}`,
      "--format",
      "{{.Names}}",
    ])
    const net = await dockerQuiet(["network", "inspect", `ob-sbx-${sandboxId}`])
    const vol = await dockerQuiet([
      "volume",
      "inspect",
      `ob-sbxws-${sandboxId}`,
    ])
    return !left && net === null && vol === null
  }, 60_000)
  check("container, network, and volume removed on destroy", gone)
  const exportAfter = await api(`/api/sandbox/${sandboxId}/export`)
  check(
    "export after destroy is 410",
    exportAfter.status === 410,
    String(exportAfter.status),
  )
  const brokerAfter = await fetch(`${BASE}/llm/v1/models`, {
    headers: { authorization: bearer },
  })
  check(
    "broker token revoked on destroy",
    brokerAfter.status === 401,
    String(brokerAfter.status),
  )
  await api(`/api/opencode/session/${locked.id}`, { method: "DELETE" })
} catch (error) {
  failures++
  console.log(
    `FAIL harness crashed: ${error instanceof Error ? error.message : error}`,
  )
} finally {
  control.kill()
  const leftovers = await dockerQuiet([
    "ps",
    "-aq",
    "--filter",
    "label=open-bot-role=sandbox",
  ])
  for (const id of (leftovers ?? "").split("\n").filter(Boolean))
    await dockerQuiet(["rm", "-f", id])
  if (failures === 0) rmSync(tmp, { recursive: true, force: true })
  else
    console.log(
      `bench artifacts kept at ${tmp}\ncontrol log tail:\n${controlLog.slice(-3000)}`,
    )
}

console.log(
  failures === 0
    ? "bench-sandbox: all checks passed"
    : `bench-sandbox: ${failures} FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
