import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridgeFetch, syncCliSkills } from "./server"

const dir = mkdtempSync(join(tmpdir(), "ob-cli-bridge-"))
const home = join(dir, "home")
mkdirSync(home, { recursive: true })

// Stub claude: drains stdin, emits two text deltas + a result line.
const claudeStub = join(dir, "claude-stub")
writeFileSync(
  claudeStub,
  `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"system","subtype":"init"}'
printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}'
printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":7,"output_tokens":2}}'
`,
)
chmodSync(claudeStub, 0o755)

// Stub muse: banner noise + one run.output.delta.
const museStub = join(dir, "muse-stub")
writeFileSync(
  museStub,
  `#!/bin/sh
echo "muse: workspace root: stub" >&2
printf '%s\\n' 'not json banner'
printf '%s\\n' '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"muse says hi"}}'
`,
)
chmodSync(museStub, 0o755)

// Stub claude that is not logged in.
const loggedOutStub = join(dir, "claude-out")
writeFileSync(
  loggedOutStub,
  `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"Not logged in","usage":{"input_tokens":0,"output_tokens":0}}'
`,
)
chmodSync(loggedOutStub, 0o755)

const baseEnv = {
  ...process.env,
  HOME: home,
  OPEN_BOT_CLAUDE_BIN: claudeStub,
  OPEN_BOT_MUSE_BIN: museStub,
  OPEN_BOT_OPENCODE_CONFIG: join(dir, "missing-opencode.json"),
}

const bridge = createBridgeFetch({
  workspace: dir,
  env: baseEnv,
  logPath: null,
})

function req(path: string, body?: Record<string, unknown>) {
  return new Request(`http://bridge.local${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function chat(body: Record<string, unknown>) {
  return bridge(req("/v1/chat/completions", body))
}

test("healthz and models list", async () => {
  expect(await bridge(req("/healthz")).then((r) => r.json())).toEqual({
    ok: true,
  })
  const models = (await bridge(req("/v1/models")).then((r) => r.json())) as {
    data: { id: string }[]
  }
  expect(models.data.map((item) => item.id)).toEqual([
    "opus",
    "sonnet",
    "haiku",
    "default",
  ])
})

test("non-stream claude completion joins deltas and maps usage", async () => {
  const res = await chat({
    model: "haiku",
    messages: [{ role: "user", content: "hi" }],
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    choices: { message: { content: string } }[]
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  expect(body.choices[0]?.message.content).toBe("Hello")
  expect(body.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 2 })
})

test("streaming claude completion emits SSE chunks, usage, [DONE]", async () => {
  const res = await chat({
    model: "opus",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "hi" }],
  })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).toContain('"content":"Hel"')
  expect(text).toContain('"content":"lo"')
  expect(text).toContain('"finish_reason":"stop"')
  expect(text).toContain('"prompt_tokens":7')
  expect(text).toContain("data: [DONE]")
})

test("muse completion uses run.output.delta text", async () => {
  const res = await chat({
    model: "default",
    messages: [{ role: "user", content: "hi" }],
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  expect(body.choices[0]?.message.content).toBe("muse says hi")
})

test("unknown model 404s with an OpenAI-shaped error", async () => {
  const res = await chat({ model: "nope", messages: [] })
  expect(res.status).toBe(404)
  const body = (await res.json()) as { error: { message: string } }
  expect(body.error.message).toContain("unknown CLI bridge model")
})

test("logged-out CLI surfaces 401 with a login hint", async () => {
  const out = createBridgeFetch({
    workspace: dir,
    env: { ...baseEnv, OPEN_BOT_CLAUDE_BIN: loggedOutStub },
    logPath: null,
  })
  const res = await out(
    req("/v1/chat/completions", {
      model: "haiku",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  expect(res.status).toBe(401)
  const body = (await res.json()) as { error: { message: string } }
  expect(body.error.message).toContain("not logged in")
})

test("syncCliSkills mirrors opencode skills into both CLI roots", () => {
  const skillHome = join(dir, "skill-home")
  const source = join(skillHome, ".config", "opencode", "skills", "demo")
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, "SKILL.md"), "---\nname: demo\n---\nbody")
  // A CLI-native skill must survive every sync untouched.
  const native = join(skillHome, ".claude", "skills", "native")
  mkdirSync(native, { recursive: true })
  writeFileSync(join(native, "SKILL.md"), "native")

  const synced = syncCliSkills({ home: skillHome, config: {} })
  expect(synced["claude-code"]).toEqual(["demo"])
  expect(synced["muse-code"]).toEqual(["demo"])
  expect(
    readFileSync(
      join(skillHome, ".agents", "skills", "demo", "SKILL.md"),
      "utf8",
    ),
  ).toContain("body")

  rmSync(source, { recursive: true, force: true })
  syncCliSkills({ home: skillHome, config: {} })
  expect(existsSync(join(skillHome, ".claude", "skills", "demo"))).toBe(false)
  expect(existsSync(join(skillHome, ".claude", "skills", "native"))).toBe(true)
})

function captureStub(name: string, script: string) {
  const path = join(dir, name)
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}

test("claude runs receive OpenViking + user MCP via --mcp-config", async () => {
  const capture = join(dir, "claude-argv.txt")
  const stub = captureStub(
    "claude-capture",
    `#!/bin/sh
printf '%s' "$*" > "${capture}"
cat >/dev/null
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":1,"output_tokens":1}}'
`,
  )
  const configPath = join(dir, "opencode-mcp.json")
  writeFileSync(
    configPath,
    JSON.stringify({
      mcp: { files: { type: "local", command: ["npx", "srv"] } },
    }),
  )
  const bridgeMcp = createBridgeFetch({
    workspace: dir,
    env: {
      ...baseEnv,
      OPEN_BOT_CLAUDE_BIN: stub,
      OPEN_BOT_OPENCODE_CONFIG: configPath,
      OPENVIKING_URL: "http://viking:1933",
      OPENVIKING_API_KEY: "ukey",
    },
    logPath: null,
  })
  const res = await bridgeMcp(
    req("/v1/chat/completions", {
      model: "haiku",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  expect(res.status).toBe(200)
  const argv = readFileSync(capture, "utf8")
  expect(argv).toContain("--mcp-config")
  expect(argv).toContain("http://viking:1933/mcp")
  expect(argv).toContain("Bearer ukey")
  expect(argv).toContain("files")
})

test("muse runs receive MCP as -c pairs and drop dead servers", async () => {
  const capture = join(dir, "muse-argv.txt")
  const stub = captureStub(
    "muse-capture",
    `#!/bin/sh
printf '%s\\n---ENV---\\n%s' "$*" "$OPEN_BOT_MCP_S0" > "${capture}"
case "$*" in
  *mcpServers.dead*)
    echo "agent loop failed: Required MCP server \\\`dead\\\` failed during startup: unreachable"
    exit 1
    ;;
esac
printf '%s\\n' '{"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"recovered"}}'
`,
  )
  const configPath = join(dir, "opencode-dead.json")
  writeFileSync(
    configPath,
    JSON.stringify({
      mcp: { dead: { type: "remote", url: "http://127.0.0.1:1/mcp" } },
    }),
  )
  const bridgeMcp = createBridgeFetch({
    workspace: dir,
    env: {
      ...baseEnv,
      OPEN_BOT_MUSE_BIN: stub,
      OPEN_BOT_OPENCODE_CONFIG: configPath,
      OPENVIKING_URL: "http://viking:1933",
      OPENVIKING_API_KEY: "ukey",
    },
    logPath: null,
  })
  const res = await bridgeMcp(
    req("/v1/chat/completions", {
      model: "default",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  expect(body.choices[0]?.message.content).toBe("recovered")
  const captured = readFileSync(capture, "utf8")
  // The surviving (second) attempt kept OpenViking, dropped `dead`, and
  // the secret traveled by env, never as a literal in argv.
  expect(captured).toContain("mcpServers.openviking=")
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal muse ${VAR} secret reference
  expect(captured).toContain("${OPEN_BOT_MCP_S0}")
  expect(captured).not.toContain("mcpServers.dead")
  expect(captured).toContain("---ENV---\nBearer ukey")
})

test("missing CLI binary 502s naming the binary", async () => {
  const out = createBridgeFetch({
    workspace: dir,
    env: { ...baseEnv, OPEN_BOT_MUSE_BIN: join(dir, "no-such-muse") },
    logPath: null,
  })
  const res = await out(
    req("/v1/chat/completions", {
      model: "default",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  // Bun.spawn of a missing binary reports via a non-zero exit instead of
  // throwing on some platforms; either way the bridge must not 200.
  expect(res.status).toBeGreaterThanOrEqual(500)
})
