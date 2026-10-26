// CLI bridge — runs inside the desktop container (bun, entrypoint
// supervisor loop), serving an OpenAI-compatible API on 127.0.0.1:4760
// that opencode calls as the claude-code / muse-code custom providers.
// Each chat request spawns the CLI headless (claude -p stream-json,
// muse exec --json) in /home/agent/workspace with the flattened thread
// history and streams its text back as chat completion chunks. Aborting
// the HTTP request (opencode's stop button) kills the CLI process.
//
// The bridge never sees credentials: both CLIs read their own
// subscription login under HOME. Runs are logged (no prompt content) to
// ~/.open-bot/cli-bridge.log.
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  bridgeMcpServers,
  CLI_BRIDGE_PORT,
  type CliEvent,
  type CliId,
  type CliRoute,
  claudeMcpConfig,
  cliProviders,
  completionBody,
  completionChunk,
  flattenMessages,
  looksLoggedOut,
  type MuseMcpPlan,
  museFailedMcpServer,
  museMcpPlan,
  opencodeSkillPaths,
  parseClaudeLine,
  parseMuseLine,
  routeCliModel,
  usageChunk,
} from "./providers"

type Usage = { promptTokens: number; completionTokens: number }

export type BridgeOptions = {
  port?: number
  hostname?: string
  workspace?: string
  env?: Record<string, string | undefined>
  logPath?: string | null
}

function logLine(path: string | null, row: Record<string, unknown>) {
  if (!path) return
  try {
    mkdirSync(join(homedir(), ".open-bot"), { recursive: true })
    appendFileSync(path, `${JSON.stringify({ ts: Date.now(), ...row })}\n`)
  } catch {
    // logging must never fail a request
  }
}

function binFor(route: CliRoute, env: Record<string, string | undefined>) {
  return env[route.provider.binEnv] || route.provider.bin
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
}

type PreparedRun = {
  args: string[]
  stdin?: string
  // Extra spawn env (muse MCP secret leaves referenced from -c values).
  env?: Record<string, string>
  cleanup: () => void
}

function tempFile(tag: string, ext: string, bytes: Uint8Array | string) {
  const path = join(
    "/tmp",
    `ob-cli-bridge-${tag}-${process.pid}-${Math.floor(Math.random() * 1e9)}.${ext}`,
  )
  writeFileSync(path, bytes)
  return path
}

function opencodeConfigPath(env: Record<string, string | undefined>) {
  return (
    env.OPEN_BOT_OPENCODE_CONFIG ??
    join(homedir(), ".config", "opencode", "opencode.json")
  )
}

function readOpencodeConfig(env: Record<string, string | undefined>): unknown {
  try {
    return JSON.parse(readFileSync(opencodeConfigPath(env), "utf8"))
  } catch {
    return null
  }
}

// Each CLI discovers skills in its own root; the desktop's skills live
// in opencode's roots (seed skills, user skills, plugin-registered
// paths). Mirror them over so trigger-word discovery works the same in
// every agent. Custom skills stored in OpenViking are not on disk by
// design — those load through the OpenViking MCP tools, as in opencode.
const CLI_SKILL_ROOTS: Record<CliId, string> = {
  "claude-code": ".claude/skills",
  "muse-code": ".agents/skills",
}

export function syncCliSkills(opts: {
  home: string
  config: unknown
  only?: CliId
}): Partial<Record<CliId, string[]>> {
  const sources = [
    join(opts.home, ".config", "opencode", "skills"),
    ...opencodeSkillPaths(opts.config),
  ]
  const available = new Map<string, string>()
  for (const source of sources) {
    let entries: string[] = []
    try {
      entries = readdirSync(source)
    } catch {
      continue
    }
    for (const name of entries) {
      if (existsSync(join(source, name, "SKILL.md"))) {
        available.set(name, join(source, name))
      }
    }
  }
  const statePath = join(opts.home, ".open-bot", "cli-skill-sync.json")
  let previous: Record<string, string[]> = {}
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
      targets?: Record<string, string[]>
    }
    if (parsed.targets) previous = parsed.targets
  } catch {
    previous = {}
  }
  const targets: Record<string, string[]> = { ...previous }
  const synced: Partial<Record<CliId, string[]>> = {}
  for (const provider of cliProviders) {
    if (opts.only && provider.id !== opts.only) continue
    const root = join(opts.home, CLI_SKILL_ROOTS[provider.id])
    const names: string[] = []
    for (const [name, from] of available) {
      try {
        mkdirSync(root, { recursive: true })
        cpSync(from, join(root, name), { recursive: true, force: true })
        names.push(name)
      } catch {
        // one unreadable skill must not block the rest (or the turn)
      }
    }
    // Drop skills the sync used to manage that left the source roots;
    // skills the user installed natively in the CLI root stay untouched.
    for (const stale of previous[root] ?? []) {
      if (!available.has(stale)) {
        rmSync(join(root, stale), { recursive: true, force: true })
      }
    }
    targets[root] = names
    synced[provider.id] = names
  }
  try {
    mkdirSync(join(opts.home, ".open-bot"), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ targets }))
  } catch {
    // state is an optimization for deletions, never load-bearing
  }
  return synced
}

function prepareClaude(
  route: CliRoute,
  flat: ReturnType<typeof flattenMessages>,
  effort: string | undefined,
  env: Record<string, string | undefined>,
  config: unknown,
): PreparedRun {
  const temps: string[] = []
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "bypassPermissions",
  ]
  if (route.model.cliModel) args.push("--model", route.model.cliModel)
  if (effort) args.push("--effort", effort)
  if (flat.system) {
    const file = tempFile("system", "txt", flat.system)
    temps.push(file)
    args.push("--system-prompt-file", file)
  }
  const mcp = claudeMcpConfig(config, env)
  if (mcp) args.push("--mcp-config", mcp)
  let prompt = flat.prompt
  flat.images.forEach((image, index) => {
    const file = tempFile(
      `image-${index}`,
      IMAGE_EXT[image.mediaType] ?? "png",
      Buffer.from(image.dataBase64, "base64"),
    )
    temps.push(file)
    prompt += `\n\n[attached image ${index + 1}: ${file} — open it with your file reading tool]`
  })
  return {
    args,
    stdin: prompt,
    cleanup: () => {
      for (const file of temps) rmSync(file, { force: true })
    },
  }
}

function prepareMuse(
  route: CliRoute,
  flat: ReturnType<typeof flattenMessages>,
  effort: string | undefined,
  workspace: string,
  plan: MuseMcpPlan,
): PreparedRun {
  const temps: string[] = []
  const args = [
    "exec",
    "--json",
    "--yolo",
    "--no-session-log",
    "--disable-reminders",
    "--workspace",
    workspace,
    ...plan.args,
  ]
  if (route.model.cliModel) args.push("--model", route.model.cliModel)
  if (effort) args.push("--reasoning-effort", effort)
  for (const [index, image] of flat.images.entries()) {
    const file = tempFile(
      `image-${index}`,
      IMAGE_EXT[image.mediaType] ?? "png",
      Buffer.from(image.dataBase64, "base64"),
    )
    temps.push(file)
    args.push("--image", file)
  }
  // muse exec has no system-prompt flag; the system text leads the prompt.
  const prompt = flat.system
    ? `System instructions:\n${flat.system}\n\n---\n\n${flat.prompt}`
    : flat.prompt
  const file = tempFile("prompt", "txt", prompt)
  temps.push(file)
  args.push("--prompt-file", file)
  return {
    args,
    env: plan.env,
    cleanup: () => {
      for (const item of temps) rmSync(item, { force: true })
    },
  }
}

type RunHandlers = {
  onDelta: (text: string) => void
  signal: AbortSignal
}

type RunOutcome = {
  text: string
  usage?: Usage
}

class BridgeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type RunOpts = Required<Pick<BridgeOptions, "workspace">> & {
  env: Record<string, string | undefined>
}

async function runCli(
  route: CliRoute,
  body: Record<string, unknown>,
  opts: RunOpts,
  handlers: RunHandlers,
): Promise<RunOutcome> {
  const flat = flattenMessages(body.messages)
  const effortRaw =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort
      : undefined
  const effort =
    effortRaw && route.model.variants.includes(effortRaw)
      ? effortRaw
      : undefined
  const config = readOpencodeConfig(opts.env)
  // Skills first: the CLI inventories its skill roots at startup.
  try {
    syncCliSkills({
      home: opts.env.HOME || homedir(),
      config,
      only: route.provider.id,
    })
  } catch {
    // discovery degrades to the transcript; never fail the turn
  }
  const bin = binFor(route, opts.env)
  if (route.provider.id === "claude-code") {
    return runOnce(
      prepareClaude(route, flat, effort, opts.env, config),
      bin,
      route,
      opts,
      handlers,
    )
  }
  // Muse fails the whole run when a configured MCP server cannot
  // start; drop the named server and retry while nothing streamed yet.
  const servers = bridgeMcpServers(config, opts.env)
  const dropped = new Set<string>()
  for (;;) {
    const plan = museMcpPlan(servers, dropped)
    let emitted = 0
    try {
      return await runOnce(
        prepareMuse(route, flat, effort, opts.workspace, plan),
        bin,
        route,
        opts,
        {
          signal: handlers.signal,
          onDelta: (text) => {
            emitted++
            handlers.onDelta(text)
          },
        },
      )
    } catch (error) {
      const failed =
        error instanceof BridgeError ? museFailedMcpServer(error.message) : null
      if (
        emitted > 0 ||
        !failed ||
        !plan.names.includes(failed) ||
        dropped.has(failed)
      ) {
        throw error
      }
      dropped.add(failed)
    }
  }
}

async function runOnce(
  prepared: PreparedRun,
  bin: string,
  route: CliRoute,
  opts: RunOpts,
  handlers: RunHandlers,
): Promise<RunOutcome> {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">
  try {
    proc = Bun.spawn({
      cmd: [bin, ...prepared.args],
      cwd: opts.workspace,
      env: { ...opts.env, ...prepared.env } as Record<string, string>,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch {
    prepared.cleanup()
    throw new BridgeError(
      502,
      `${route.provider.label} CLI (${bin}) is not installed in this desktop. Rebuild images, then sleep and start the desktop.`,
    )
  }
  const onAbort = () => {
    try {
      proc.kill()
    } catch {
      // already exited
    }
  }
  handlers.signal.addEventListener("abort", onAbort, { once: true })
  const parse =
    route.provider.id === "claude-code" ? parseClaudeLine : parseMuseLine
  let streamed = ""
  let sawDelta = false
  const assistantTexts: string[] = []
  let result: CliEvent["result"]
  let stderrTail = ""
  // Non-event stdout (CLI banners, fatal startup lines) — the failure
  // detail when a run dies before producing events.
  let stdoutTail = ""
  const stderrDone = (async () => {
    if (proc.stderr instanceof ReadableStream) {
      stderrTail = (await new Response(proc.stderr).text()).slice(-2000)
    }
  })().catch(() => {})
  try {
    if (prepared.stdin !== undefined) {
      proc.stdin?.write(prepared.stdin)
    }
    await proc.stdin?.end()
    if (!(proc.stdout instanceof ReadableStream)) {
      throw new BridgeError(
        502,
        `${route.provider.label} CLI gave no output stream`,
      )
    }
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const eat = (chunk: string) => {
      buffer += chunk
      let at = buffer.indexOf("\n")
      while (at >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        const event = parse(line)
        if (!event && line.trim()) {
          stdoutTail = `${stdoutTail}${line}\n`.slice(-2000)
        }
        if (event?.delta) {
          sawDelta = true
          streamed += event.delta
          handlers.onDelta(event.delta)
        } else if (event?.assistantText) {
          assistantTexts.push(event.assistantText)
        } else if (event?.result) {
          result = event.result
        }
        at = buffer.indexOf("\n")
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      eat(decoder.decode(value, { stream: true }))
    }
    eat(decoder.decode())
    if (buffer.trim()) {
      const event = parse(buffer)
      if (event?.result) result = event.result
    }
    const code = await proc.exited
    await stderrDone
    if (handlers.signal.aborted) throw new BridgeError(499, "request aborted")
    const fallback = sawDelta
      ? streamed
      : assistantTexts.join("") || result?.text || ""
    if (result?.isError) {
      throw new BridgeError(
        502,
        result.text || `${route.provider.label} run failed`,
      )
    }
    if (code !== 0) {
      const detail = (stderrTail.trim() || stdoutTail.trim() || fallback).slice(
        -500,
      )
      throw new BridgeError(
        502,
        detail || `${route.provider.label} CLI exited with code ${code}`,
      )
    }
    if (!fallback && looksLoggedOut(stderrTail)) {
      throw new BridgeError(
        401,
        `${route.provider.label} is not logged in. Open Config → Providers and log in.`,
      )
    }
    if (looksLoggedOut(fallback) && !result?.usage?.completionTokens) {
      throw new BridgeError(
        401,
        `${route.provider.label} is not logged in. Open Config → Providers and log in.`,
      )
    }
    if (!sawDelta && fallback) handlers.onDelta(fallback)
    return { text: fallback, usage: result?.usage }
  } finally {
    handlers.signal.removeEventListener("abort", onAbort)
    prepared.cleanup()
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof BridgeError ? error.status : 502
  const message = error instanceof Error ? error.message : "cli bridge failed"
  return Response.json(
    { error: { message, type: "cli_bridge_error" } },
    { status },
  )
}

// The request handler, split from Bun.serve so tests drive it directly
// (real HTTP in tests breaks under the web suite's DOM globals).
export function createBridgeFetch(options: BridgeOptions = {}) {
  const env = options.env ?? (process.env as Record<string, string | undefined>)
  const workspace =
    options.workspace ?? env.OPEN_BOT_WORKSPACE ?? "/home/agent/workspace"
  const logPath =
    options.logPath === undefined
      ? join(homedir(), ".open-bot", "cli-bridge.log")
      : options.logPath
  const encoder = new TextEncoder()

  async function chatCompletions(req: Request) {
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return Response.json(
        { error: { message: "invalid JSON body", type: "cli_bridge_error" } },
        { status: 400 },
      )
    }
    const modelId = typeof body.model === "string" ? body.model : ""
    const route = routeCliModel(modelId)
    if (!route) {
      return Response.json(
        {
          error: {
            message: `unknown CLI bridge model: ${modelId || "(empty)"}`,
            type: "cli_bridge_error",
          },
        },
        { status: 404 },
      )
    }
    const id = `chatcmpl-${crypto.randomUUID()}`
    const started = Date.now()
    const stream = body.stream === true
    const includeUsage = Boolean(
      (body.stream_options as { include_usage?: unknown } | undefined)
        ?.include_usage,
    )
    const finish = (ok: boolean, error?: string) =>
      logLine(logPath, {
        provider: route.provider.id,
        model: route.model.id,
        ms: Date.now() - started,
        ok,
        ...(error ? { error: error.slice(0, 240) } : {}),
      })

    if (!stream) {
      try {
        const outcome = await runCli(
          route,
          body,
          { workspace, env },
          { onDelta: () => {}, signal: req.signal },
        )
        finish(true)
        return Response.json(
          completionBody(id, route.model.id, outcome.text, outcome.usage),
        )
      } catch (error) {
        finish(false, error instanceof Error ? error.message : String(error))
        return errorResponse(error)
      }
    }

    // Errors surface before the first token as a real HTTP error when the
    // CLI fails fast (missing binary, instant auth failure) only if they
    // happen before we start streaming; runCli is lazy, so stream errors
    // after headers go out become an SSE error frame + [DONE] without a
    // finish chunk, which opencode reports as a failed turn.
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const sse = new ReadableStream<Uint8Array>({
      start(item) {
        controller = item
      },
    })
    const send = (payload: unknown) => {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        )
      } catch {
        // client gone
      }
    }
    void (async () => {
      let sentRole = false
      try {
        const outcome = await runCli(
          route,
          body,
          { workspace, env },
          {
            signal: req.signal,
            onDelta: (text) => {
              if (!sentRole) {
                sentRole = true
                send(completionChunk(id, route.model.id, { role: "assistant" }))
              }
              send(completionChunk(id, route.model.id, { content: text }))
            },
          },
        )
        if (!sentRole)
          send(completionChunk(id, route.model.id, { role: "assistant" }))
        send(completionChunk(id, route.model.id, {}, "stop"))
        if (includeUsage && outcome.usage) {
          send(usageChunk(id, route.model.id, outcome.usage))
        }
        finish(true)
      } catch (error) {
        finish(false, error instanceof Error ? error.message : String(error))
        send({
          error: {
            message:
              error instanceof Error ? error.message : "cli bridge failed",
            type: "cli_bridge_error",
          },
        })
      } finally {
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        } catch {
          // already closed
        }
      }
    })()
    return new Response(sse, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    })
  }

  return async function bridgeFetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === "/healthz") return Response.json({ ok: true })
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return Response.json({
        object: "list",
        data: cliProviders.flatMap((provider) =>
          provider.models.map((model) => ({
            id: model.id,
            object: "model",
            owned_by: provider.id,
          })),
        ),
      })
    }
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      return chatCompletions(req)
    }
    return Response.json(
      { error: { message: "not found", type: "cli_bridge_error" } },
      { status: 404 },
    )
  }
}

export function createBridge(options: BridgeOptions = {}) {
  const bridgeFetch = createBridgeFetch(options)
  return Bun.serve({
    port: options.port ?? CLI_BRIDGE_PORT,
    hostname: options.hostname ?? "127.0.0.1",
    idleTimeout: 255,
    fetch(req, srv) {
      srv.timeout(req, 0)
      return bridgeFetch(req)
    },
  })
}

if (import.meta.main) {
  const server = createBridge()
  console.log(`cli-bridge listening on ${server.hostname}:${server.port}`)
}
