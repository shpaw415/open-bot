import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize } from "node:path"
import type { AiConfig } from "@open-bot/ai"
import {
  type CronJob,
  type CronScheduleKind,
  type Db,
  type ImageProvider,
  type User,
  type VikingProvider,
  vikingProviderReady,
} from "@open-bot/db"
import { handleAdmin } from "./admin"
import { fireCronJob, nextRunMs, parseCron } from "./cron"
import {
  desktopPhase,
  endpoint,
  isRunning,
  opencodeExec,
  restartOpencode,
  spawnLogin,
  startDesktop,
  startError,
  stopDesktop,
  syncImageAuth,
} from "./docker"
import { cookieSecure, names, webDist } from "./env"
import { HttpError, httpErrorResponse } from "./http-error"
import {
  imageAuthReady,
  imageProviderById,
  imageProviderPublic,
  imageProviders,
} from "./image-providers"
import { handleLlm } from "./llm"
import { hashPassword, randomToken, sha256, verifyPassword } from "./passwords"
import {
  ASSISTANT_ID,
  handlePersonas,
  mergeSystem,
  personaSystem,
  resolvePersona,
} from "./personas"
import {
  ensureThreadScreen,
  resolveRootSession,
  stopThreadScreen,
} from "./screens"
import { parseTtyControl, ttyExitFrame, ttySizeOr } from "./tty"
import {
  assertSkillInput,
  createVikingSkills,
  skillNameError,
} from "./viking-skills"
import { vikingUserKey } from "./viking-user"
import {
  IMAGE_REPLY,
  workspaceImagePath,
  workspaceImageResponse,
} from "./workspace-image"

type ProxySocket = {
  kind: "proxy"
  target: string
  upstream: WebSocket | null
  queue: (string | Buffer)[]
}

type LoginSocket = {
  kind: "login"
  sessionId: string
  cols: number
  rows: number
}

type SocketData = ProxySocket | LoginSocket

type LoginSession = {
  id: string
  userId: string
  provider?: string
  method?: string
  started: boolean
  done: boolean
  cancelled: boolean
  code: number | null
  proc: ReturnType<typeof spawnLogin> | null
  sockets: Set<Bun.ServerWebSocket<SocketData>>
  expire: ReturnType<typeof setTimeout> | null
}

const logins = new Map<string, LoginSession>()

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers })
}

function cookie(token: string, maxAge: number) {
  const secure = cookieSecure ? "; Secure" : ""
  return `ob_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function readCookie(req: Request) {
  const raw = req.headers.get("cookie") ?? ""
  const part = raw
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("ob_session="))
  return part?.slice("ob_session=".length) ?? ""
}

function userFrom(req: Request, db: Db) {
  const token = readCookie(req)
  if (!token) return null
  const session = db.sessionByHash(sha256(token))
  if (!session || session.expiresAt < Date.now()) return null
  return db.userById(session.userId)
}

function userFromLlmToken(req: Request, db: Db) {
  const header = req.headers.get("authorization") ?? ""
  if (!/^Bearer\s+/i.test(header)) return null
  const userId = db.userIdByLlmToken(header.replace(/^Bearer\s+/i, ""))
  if (!userId) return null
  const user = db.userById(userId)
  if (!user || user.disabled) return null
  return user
}

async function readJson(req: Request) {
  return (await req.json()) as Record<string, unknown>
}

function basic(password: string) {
  return {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  }
}

async function proxy(
  req: Request,
  targetBase: string,
  strip: string,
  extra?: HeadersInit,
  body?: string,
) {
  const url = new URL(req.url)
  const path = (strip ? url.pathname.replace(strip, "") : url.pathname) || "/"
  const dest = new URL(
    `${path.startsWith("/") ? path : `/${path}`}${url.search}`,
    targetBase,
  )
  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.delete("accept-encoding")
  if (body !== undefined) headers.delete("content-length")
  if (extra) {
    for (const [key, value] of new Headers(extra)) headers.set(key, value)
  }
  const upstream = await fetch(dest, {
    method: req.method,
    headers,
    body:
      body !== undefined
        ? body
        : req.method === "GET" || req.method === "HEAD"
          ? undefined
          : req.body,
    duplex: body !== undefined ? undefined : "half",
  } as RequestInit)
  const out = new Headers(upstream.headers)
  out.delete("content-encoding")
  out.delete("content-length")
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}

async function createOpencodeSession(
  req: Request,
  base: string,
  auth: HeadersInit,
  db: Db,
  userId: string,
) {
  const parsed = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  const personaId =
    typeof raw.personaId === "string" ? raw.personaId.trim() : ""
  if (personaId && !resolvePersona(db, userId, personaId))
    return json({ error: "unknown personality" }, 400)
  const rest = { ...raw }
  delete rest.personaId
  const headers = new Headers(auth)
  headers.set("content-type", "application/json")
  const upstream = await fetch(new URL("/session", base), {
    method: "POST",
    headers,
    body: JSON.stringify(rest),
  })
  const text = await upstream.text()
  if (upstream.ok && personaId && personaId !== ASSISTANT_ID) {
    try {
      const created = JSON.parse(text) as { id?: string }
      if (created.id) db.setThreadPersona(userId, created.id, personaId)
    } catch {
      // return the upstream body even if the id cannot be stored
    }
  }
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  })
}

async function applyImageAuth(userId: string, value: ImageProvider) {
  try {
    const applied = await syncImageAuth(userId, {
      provider: value.provider,
      accountId: value.accountId,
      token: value.apiKey,
      model: value.model,
    })
    return { ok: true, applied }
  } catch (error) {
    const message = error instanceof Error ? error.message : "apply failed"
    throw new HttpError(
      502,
      `Saved, but the desktop did not receive credentials: ${message}`,
      "image_auth_apply",
    )
  }
}

async function skillsClient(user: User, db: Db) {
  const desktop = await ensure(user, db)
  const base = await endpoint(user.id, "viking", 1933)
  return createVikingSkills(base, vikingUserKey(desktop.vikingKey))
}

async function ensure(user: User, db: Db) {
  if (user.disabled) {
    throw new HttpError(403, "account disabled", "disabled")
  }
  const desktop = db.desktop(user.id)
  if (!desktop) throw new Error("desktop record missing")
  await startDesktop(
    user.id,
    desktop,
    db.getVikingProvider(user.id),
    db.getImageProvider(user.id),
  )
  db.touchDesktop(user.id)
  return desktop
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
}

async function staticFile(pathname: string) {
  const rel = pathname === "/" ? "/index.html" : pathname
  const file = normalize(join(webDist, rel))
  if (!file.startsWith(webDist))
    return new Response("bad path", { status: 400 })
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error("missing")
    const ext = file.slice(file.lastIndexOf("."))
    return new Response(createReadStream(file) as unknown as BodyInit, {
      headers: {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control":
          ext === ".html" ? "no-cache" : "public, max-age=31536000",
      },
    })
  } catch {
    const index = join(webDist, "index.html")
    try {
      await stat(index)
      return new Response(createReadStream(index) as unknown as BodyInit, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
    } catch {
      return new Response("UI is not built", { status: 503 })
    }
  }
}

export function createServer(db: Db, ai: AiConfig, hostname: string) {
  return Bun.serve<SocketData>({
    port: Number(process.env.PORT ?? 8787),
    hostname,
    async fetch(req, server) {
      const url = new URL(req.url)
      try {
        if (url.pathname.startsWith("/llm/"))
          return await handleLlm(req, url, ai, db)
        if (
          req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
          url.pathname.startsWith("/api/providers/login/")
        ) {
          return await loginTtyUpgrade(req, url, db, server)
        }
        if (url.pathname.startsWith("/api/")) return await api(req, url, db)
        if (url.pathname.startsWith("/desktop/"))
          return await desktopProxy(req, url, server, db)
        return await staticFile(url.pathname)
      } catch (error) {
        return httpErrorResponse(error)
      }
    },
    error(error) {
      return httpErrorResponse(error)
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === "login") {
          openLogin(ws)
          return
        }
        const data = ws.data
        const upstream = new WebSocket(data.target)
        upstream.binaryType = "arraybuffer"
        data.upstream = upstream
        upstream.addEventListener("open", () => {
          for (const item of data.queue) upstream.send(item)
          data.queue = []
        })
        upstream.addEventListener("message", (event) => {
          ws.send(event.data)
        })
        upstream.addEventListener("close", () => ws.close())
      },
      message(ws, message) {
        if (ws.data.kind === "login") {
          writeLogin(ws, message)
          return
        }
        const upstream = ws.data.upstream
        if (!upstream || upstream.readyState !== WebSocket.OPEN) {
          ws.data.queue.push(message)
          return
        }
        upstream.send(message)
      },
      close(ws) {
        if (ws.data.kind === "login") {
          closeLogin(ws)
          return
        }
        ws.data.upstream?.close()
      },
    },
  })
}

async function api(req: Request, url: URL, db: Db) {
  if (url.pathname === "/api/health") return json({ ok: true })
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req)
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase()
    const password = String(body.password ?? "")
    const user = db.userByEmail(email)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return json({ error: "invalid login" }, 401)
    }
    if (user.disabled) return json({ error: "account disabled" }, 403)
    return sessionResponse(db, user)
  }
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    const body = await readJson(req)
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase()
    const password = String(body.password ?? "")
    const code = String(body.code ?? "")
    if (!email || password.length < 8)
      return json({ error: "email and 8+ character password required" }, 400)
    if (!db.takeInvite(code)) return json({ error: "invalid invite" }, 400)
    if (db.userByEmail(email))
      return json({ error: "email already registered" }, 409)
    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash: hashPassword(password),
      role: "user" as const,
      createdAt: Date.now(),
      mustChangePassword: false,
      disabled: false,
    }
    db.createUser(user)
    db.ensureDesktop(freshDesktop(user.id))
    return sessionResponse(db, user)
  }
  const isCronPath =
    url.pathname === "/api/cron" || url.pathname.startsWith("/api/cron/")
  const isPersonaPath =
    url.pathname === "/api/personas" ||
    url.pathname.startsWith("/api/personas/")
  if (isCronPath || isPersonaPath) {
    const agent = userFromLlmToken(req, db)
    if (agent) {
      if (isPersonaPath) {
        const handled = handlePersonas(req, url, db, agent)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isCronPath) return handleCron(req, url, db, agent)
    }
  }
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  if (isPersonaPath) {
    const handled = handlePersonas(req, url, db, user)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isCronPath) return handleCron(req, url, db, user)
  if (url.pathname === "/api/auth/credentials" && req.method === "POST") {
    if (!user.mustChangePassword)
      return json({ error: "credentials already set" }, 400)
    const body = await readJson(req)
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase()
    const password = String(body.password ?? "")
    if (!email.includes("@") || password.length < 8) {
      return json({ error: "email and 8+ character password required" }, 400)
    }
    if (password === "changeme") {
      return json({ error: "choose a password other than changeme" }, 400)
    }
    const existing = db.userByEmail(email)
    if (existing && existing.id !== user.id) {
      return json({ error: "email already registered" }, 409)
    }
    db.setCredentials(user.id, email, hashPassword(password))
    const next = db.userById(user.id)
    if (!next) return json({ error: "user missing" }, 500)
    return json(publicUser(next))
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = readCookie(req)
    const session = db.sessionByHash(sha256(token))
    if (session) db.deleteSession(session.id)
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) })
  }
  if (url.pathname === "/api/me") {
    const phase = await desktopPhase(user.id)
    const desktop = db.desktop(user.id)
    return json({
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      desktop: phase,
      model: desktop
        ? {
            providerID: desktop.selectedProvider,
            modelID: desktop.selectedModel,
          }
        : null,
    })
  }
  if (url.pathname.startsWith("/api/admin/")) {
    return handleAdmin(req, url, db, user)
  }
  if (url.pathname === "/api/invites" && req.method === "POST") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    const code = randomToken().slice(0, 16)
    db.createInvite(code, null)
    return json({ code })
  }
  if (url.pathname === "/api/desktop")
    return json({
      phase: await desktopPhase(user.id),
      error: startError(user.id),
    })
  if (url.pathname === "/api/desktop/start" && req.method === "POST") {
    if ((await desktopPhase(user.id)) !== "running") {
      const desktop = db.desktop(user.id)
      if (!desktop) throw new Error("desktop record missing")
      void startDesktop(
        user.id,
        desktop,
        db.getVikingProvider(user.id),
        db.getImageProvider(user.id),
      ).catch(() => {})
      db.touchDesktop(user.id)
    }
    return json({ phase: "starting" })
  }
  if (url.pathname === "/api/desktop/stop" && req.method === "POST") {
    await stopDesktop(user.id)
    return json({ phase: "sleeping" })
  }
  if (url.pathname === "/api/desktop/screen" && req.method === "POST") {
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      String(body.sessionId ?? ""),
    )
    const screen = await ensureThreadScreen(db, user.id, root)
    return json({
      sessionId: screen.sessionId,
      path: screen.path,
      host: screen.host,
    })
  }
  if (url.pathname === "/api/viking" && req.method === "GET") {
    const saved = db.getVikingProvider(user.id)
    return json({
      baseURL: saved?.baseURL ?? "",
      hasKey: Boolean(saved?.apiKey),
      embedModel: saved?.embedModel ?? "",
      embedDimension: saved?.embedDimension || 1536,
      vlmModel: saved?.vlmModel ?? "",
    })
  }
  if (url.pathname === "/api/viking" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getVikingProvider(user.id)
    const typedKey = String(body.apiKey ?? "").trim()
    const next: VikingProvider = {
      baseURL: String(body.baseURL ?? "").trim(),
      apiKey: typedKey || current?.apiKey || "",
      embedModel: String(body.embedModel ?? "").trim(),
      embedDimension: Number(body.embedDimension),
      vlmModel: String(body.vlmModel ?? "").trim(),
    }
    if (!vikingProviderReady(next)) {
      return json(
        {
          error:
            "base URL, API key, embed model, dimension, and VLM model are required",
        },
        400,
      )
    }
    db.setUserVikingProvider(user.id, next)
    return json({ ok: true })
  }
  if (url.pathname === "/api/image" && req.method === "GET") {
    const saved = db.getImageProvider(user.id)
    const selected =
      imageProviderById(saved?.provider ?? "") ?? imageProviders[0]
    return json({
      providers: imageProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      accountId: saved?.accountId ?? "",
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: Boolean(saved?.apiKey),
    })
  }
  if (url.pathname === "/api/image" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getImageProvider(user.id)
    const spec = imageProviderById(String(body.provider ?? "").trim())
    if (!spec) return json({ error: "unsupported image provider" }, 400)
    const typedKey = String(body.apiKey ?? "").trim()
    const next: ImageProvider = {
      provider: spec.id,
      accountId: String(body.accountId ?? "").trim(),
      apiKey: typedKey || (current?.provider === spec.id ? current.apiKey : ""),
      model: String(body.model ?? "").trim() || spec.defaultModel,
    }
    if (!imageAuthReady(next)) {
      return json(
        { error: "the fields required by this provider are missing" },
        400,
      )
    }
    db.setImageProvider(user.id, next)
    return json(await applyImageAuth(user.id, next))
  }
  if (url.pathname === "/api/image" && req.method === "DELETE") {
    db.clearImageProvider(user.id)
    try {
      await syncImageAuth(user.id, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing cf-ai setup")) {
        return json(
          {
            error: message || "removed, but the desktop still has credentials",
          },
          502,
        )
      }
    }
    return json({ ok: true })
  }
  if (url.pathname === "/api/skills" && req.method === "GET") {
    const name = url.searchParams.get("name")?.trim() ?? ""
    if (name) {
      const nameError = skillNameError(name)
      if (nameError) return json({ error: nameError }, 400)
    }
    const skills = await skillsClient(user, db)
    if (name) return json(await skills.get(name))
    return json({ skills: await skills.list() })
  }
  if (url.pathname === "/api/skills" && req.method === "PUT") {
    const body = await readJson(req)
    const input = {
      name: String(body.name ?? "").trim(),
      description: String(body.description ?? "").trim(),
      body: String(body.body ?? ""),
    }
    const previousName = String(body.previousName ?? "").trim()
    assertSkillInput(input)
    if (previousName) {
      const previousError = skillNameError(previousName)
      if (previousError) return json({ error: previousError }, 400)
    }
    const skills = await skillsClient(user, db)
    await skills.save(input, previousName)
    return json({ ok: true })
  }
  if (url.pathname === "/api/skills" && req.method === "DELETE") {
    const body = await readJson(req)
    const name = String(body.name ?? "").trim()
    const nameError = skillNameError(name)
    if (nameError) return json({ error: nameError }, 400)
    const skills = await skillsClient(user, db)
    await skills.remove(name)
    return json({ ok: true })
  }
  if (url.pathname === "/api/providers" && req.method === "GET") {
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const headers = basic(desktop.opencodePassword)
    const [providers, auth] = await Promise.all([
      fetch(`${base}/provider`, { headers }).then((res) => res.json()),
      fetch(`${base}/provider/auth`, { headers }).then((res) => res.json()),
    ])
    const saved = db.desktop(user.id)
    return json({ providers, auth, selected: saved })
  }
  if (url.pathname === "/api/providers/login" && req.method === "POST") {
    await ensure(user, db)
    const body = await readJson(req)
    const id = crypto.randomUUID()
    const session: LoginSession = {
      id,
      userId: user.id,
      provider: body.provider ? String(body.provider) : undefined,
      method: body.method ? String(body.method) : undefined,
      started: false,
      done: false,
      cancelled: false,
      code: null,
      proc: null,
      sockets: new Set(),
      expire: null,
    }
    session.expire = setTimeout(() => {
      if (!session.started) logins.delete(id)
    }, 30_000)
    logins.set(id, session)
    return json({ id })
  }
  if (url.pathname === "/api/providers/logout" && req.method === "POST") {
    const body = await readJson(req)
    await ensure(user, db)
    const result = await opencodeExec(user.id, [
      "opencode",
      "auth",
      "logout",
      String(body.provider ?? ""),
    ])
    return json({
      ok: result.code === 0,
      output: result.stdout || result.stderr,
    })
  }
  if (url.pathname === "/api/model" && req.method === "PUT") {
    const body = await readJson(req)
    const providerID = String(body.providerID ?? "")
    const modelID = String(body.modelID ?? "")
    if (!providerID || !modelID)
      return json({ error: "provider and model required" }, 400)
    db.setModel(user.id, providerID, modelID)
    if (await isRunning(names(user.id).opencode)) {
      await opencodeExec(user.id, [
        "sh",
        "-c",
        `jq --arg p ${shellQuote(providerID)} --arg m ${shellQuote(modelID)} '.model = ($p + "/" + $m) | .small_model = ($p + "/" + $m)' $HOME/.config/opencode/opencode.json > /tmp/oc.json && mv /tmp/oc.json $HOME/.config/opencode/opencode.json`,
      ])
      await restartOpencode(user.id)
    }
    return json({ ok: true })
  }
  if (url.pathname === "/api/models" && req.method === "GET") {
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const headers = basic(desktop.opencodePassword)
    const response = await fetch(`${base}/provider`, { headers })
    if (!response.ok) {
      throw new HttpError(
        502,
        `provider list failed (${response.status})`,
        "provider_list_failed",
      )
    }
    const body = (await response.json()) as {
      all?: { id?: string; models?: Record<string, { name?: string }> }[]
      connected?: unknown
    }
    const connected = Array.isArray(body.connected)
      ? body.connected.filter((id): id is string => typeof id === "string")
      : []
    const connectedSet = new Set(connected)
    const models: { providerID: string; modelID: string; name?: string }[] = []
    for (const provider of body.all ?? []) {
      if (!provider.id || !connectedSet.has(provider.id)) continue
      for (const [modelID, info] of Object.entries(provider.models ?? {})) {
        models.push({ providerID: provider.id, modelID, name: info?.name })
      }
    }
    models.sort((a, b) =>
      `${a.providerID}/${a.modelID}`.localeCompare(
        `${b.providerID}/${b.modelID}`,
      ),
    )
    return json({ models, connected })
  }
  if (url.pathname === "/api/workspace/image" && req.method === "GET") {
    const path = workspaceImagePath(url.searchParams.get("path") ?? "")
    if (!path) return json({ error: "not found" }, 404)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const upstream = await fetch(
      `${base}/file/content?path=${encodeURIComponent(path)}`,
      { headers: basic(desktop.opencodePassword) },
    )
    if (!upstream.ok) return json({ error: "not found" }, 404)
    const image = workspaceImageResponse(
      await upstream.json().catch(() => null),
    )
    if (!image) return json({ error: "not found" }, 404)
    return image
  }
  if (url.pathname.startsWith("/api/opencode/")) {
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const auth = basic(desktop.opencodePassword)
    if (url.pathname === "/api/opencode/session" && req.method === "POST")
      return createOpencodeSession(req, base, auth, db, user.id)
    const deleted = url.pathname.match(/^\/api\/opencode\/session\/([^/]+)$/)
    if (deleted && req.method === "DELETE") {
      const id = decodeURIComponent(deleted[1] ?? "")
      const res = await proxy(req, base, "/api/opencode", auth)
      if (res.ok) {
        db.clearThreadPersona(user.id, id)
        await stopThreadScreen(db, user.id, id)
      }
      return res
    }
    const prompted = url.pathname.match(
      /^\/api\/opencode\/session\/([^/]+)\/(?:prompt_async|message)$/,
    )
    if (prompted && req.method === "POST") {
      const promptedId = decodeURIComponent(prompted[1] ?? "")
      const root = await resolveRootSession(base, auth, promptedId)
      const screen = await ensureThreadScreen(db, user.id, root)
      const line = [
        personaSystem(
          resolvePersona(
            db,
            user.id,
            db.threadPersona(user.id, promptedId)?.personaId ?? ASSISTANT_ID,
          ),
        ),
        screen.system,
        IMAGE_REPLY,
      ]
        .filter((item): item is string => Boolean(item))
        .join("\n\n")
      const parsed = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      const body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {}
      return proxy(
        req,
        base,
        "/api/opencode",
        auth,
        JSON.stringify({ ...body, system: mergeSystem(body.system, line) }),
      )
    }
    return proxy(req, base, "/api/opencode", auth)
  }
  return json({ error: "not found" }, 404)
}

const CRON_LOOKAHEAD_MS = 4 * 366 * 24 * 60 * 60 * 1000

async function handleCron(req: Request, url: URL, db: Db, user: User) {
  const idMatch = url.pathname.match(/^\/api\/cron\/([^/]+)(\/run)?$/)

  if (url.pathname === "/api/cron/notices" && req.method === "GET")
    return json(db.unreadCronNotices(user.id))

  if (url.pathname === "/api/cron/notices/view" && req.method === "POST") {
    const body = await readJson(req)
    const id = String(body.id ?? "").trim()
    const sessionId = String(body.sessionId ?? "").trim()
    if (id) db.viewCronNotice(id, user.id)
    else if (sessionId) db.viewCronNoticesBySession(user.id, sessionId)
    else return json({ error: "id or sessionId is required" }, 400)
    return json({ ok: true })
  }

  if (url.pathname === "/api/cron" && req.method === "GET")
    return json(db.cronJobs(user.id))

  if (url.pathname === "/api/cron" && req.method === "POST") {
    const body = await readJson(req)
    const name = String(body.name ?? "").trim()
    const message = String(body.message ?? "").trim()
    if (!name || !message)
      return json({ error: "name and message are required" }, 400)
    const kind = body.kind as CronScheduleKind | undefined
    let cronExpr: string | null = null
    let everySeconds: number | null = null
    let atMs: number | null = null
    let deleteAfterRun = false
    if (kind === "cron") {
      cronExpr = String(body.cronExpr ?? "").trim()
      try {
        parseCron(cronExpr)
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? `invalid cron expression: ${error.message}`
                : "invalid cron expression",
          },
          400,
        )
      }
    } else if (kind === "every") {
      everySeconds = Number(body.everySeconds)
      if (
        !Number.isInteger(everySeconds) ||
        everySeconds < 60 ||
        everySeconds > 31_536_000
      )
        return json(
          { error: "everySeconds must be an integer between 60 and 31536000" },
          400,
        )
    } else if (kind === "at") {
      atMs = Number(body.atMs)
      if (
        !Number.isInteger(atMs) ||
        atMs < Date.now() ||
        atMs > Date.now() + CRON_LOOKAHEAD_MS
      )
        return json({ error: "atMs must be a future time within 4 years" }, 400)
      deleteAfterRun = true
    } else {
      return json({ error: "kind must be cron, every, or at" }, 400)
    }
    const job: CronJob = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: name.slice(0, 80),
      message: message.slice(0, 4000),
      kind,
      cronExpr,
      everySeconds,
      atMs,
      enabled: true,
      deleteAfterRun,
      sessionId: null,
      createdAt: Date.now(),
      lastRunAt: null,
      nextRunAt: null,
      runCount: 0,
      lastError: null,
    }
    job.nextRunAt = nextRunMs(job)
    db.createCronJob(job)
    return json(job, 201)
  }

  if (idMatch && !idMatch[2] && req.method === "PATCH") {
    const job = db.cronJobById(decodeURIComponent(idMatch[1] ?? ""), user.id)
    if (!job) return json({ error: "job not found" }, 404)
    const body = await readJson(req)
    const changes: {
      name?: string
      message?: string
      enabled?: boolean
      nextRunAt?: number | null
    } = {}
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim()
      if (!name) return json({ error: "name cannot be empty" }, 400)
      changes.name = name.slice(0, 80)
    }
    if (body.message !== undefined) {
      const message = String(body.message ?? "").trim()
      if (!message) return json({ error: "message cannot be empty" }, 400)
      changes.message = message.slice(0, 4000)
    }
    if (body.enabled !== undefined) {
      const enabled = Boolean(body.enabled)
      changes.enabled = enabled
      if (enabled) changes.nextRunAt = nextRunMs(job)
    }
    return json(db.updateCronJob(job.id, user.id, changes))
  }

  if (idMatch && !idMatch[2] && req.method === "DELETE") {
    const removed = db.deleteCronJob(
      decodeURIComponent(idMatch[1] ?? ""),
      user.id,
    )
    if (!removed) return json({ error: "job not found" }, 404)
    return json({ ok: true })
  }

  if (idMatch?.[2] === "/run" && req.method === "POST") {
    const job = db.cronJobById(decodeURIComponent(idMatch[1] ?? ""), user.id)
    if (!job) return json({ error: "job not found" }, 404)
    const error = await fireCronJob(db, job, true)
    if (error) return json({ ok: false, error }, 502)
    return json({ ok: true })
  }

  return json({ error: "not found" }, 404)
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function loginTtyUpgrade(
  req: Request,
  url: URL,
  db: Db,
  server: Bun.Server<SocketData>,
): Promise<Response | undefined> {
  const match = url.pathname.match(/^\/api\/providers\/login\/([^/]+)\/tty$/)
  if (!match) return json({ error: "not found" }, 404)
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  const session = logins.get(match[1] ?? "")
  if (!session || session.userId !== user.id)
    return json({ error: "not found" }, 404)
  const ok = server.upgrade(req, {
    data: {
      kind: "login",
      sessionId: session.id,
      cols: ttySizeOr(url.searchParams.get("cols"), 80),
      rows: ttySizeOr(url.searchParams.get("rows"), 24),
    },
  })
  return ok ? undefined : new Response("upgrade failed", { status: 400 })
}

function openLogin(ws: Bun.ServerWebSocket<SocketData>) {
  if (ws.data.kind !== "login") return
  const session = logins.get(ws.data.sessionId)
  if (!session || session.done) {
    ws.send(ttyExitFrame(session?.code ?? null))
    ws.close()
    return
  }
  if (session.started) {
    ws.send(ttyExitFrame(null, "login already attached"))
    ws.close()
    return
  }
  session.sockets.add(ws)
  try {
    startLogin(session, ws.data.cols, ws.data.rows)
  } catch (error) {
    session.done = true
    session.sockets.delete(ws)
    ws.send(
      ttyExitFrame(1, error instanceof Error ? error.message : "login failed"),
    )
    ws.close()
    logins.delete(session.id)
  }
}

function startLogin(session: LoginSession, cols: number, rows: number) {
  session.started = true
  if (session.expire) {
    clearTimeout(session.expire)
    session.expire = null
  }
  session.proc = spawnLogin(session.userId, {
    provider: session.provider,
    method: session.method,
    cols,
    rows,
    onData(data) {
      for (const sock of session.sockets) {
        try {
          sock.send(data)
        } catch {
          // socket already closed
        }
      }
    },
  })
  void finishLogin(session)
}

function writeLogin(
  ws: Bun.ServerWebSocket<SocketData>,
  message: string | Buffer,
) {
  if (ws.data.kind !== "login") return
  const session = logins.get(ws.data.sessionId)
  const terminal = session?.proc?.terminal
  if (!session || !terminal || session.done) return
  if (typeof message === "string") {
    const resize = parseTtyControl(message)
    if (resize) terminal.resize(resize.cols, resize.rows)
    return
  }
  terminal.write(new Uint8Array(message))
}

function closeLogin(ws: Bun.ServerWebSocket<SocketData>) {
  if (ws.data.kind !== "login") return
  const session = logins.get(ws.data.sessionId)
  if (!session) return
  session.sockets.delete(ws)
  if (session.done || session.cancelled) return
  session.cancelled = true
  try {
    session.proc?.kill()
  } catch {
    // already exited
  }
  try {
    session.proc?.terminal.close()
  } catch {
    // already closed
  }
  logins.delete(session.id)
}

async function finishLogin(session: LoginSession) {
  const proc = session.proc
  if (!proc) return
  const code = await proc.exited
  if (session.cancelled) return
  session.code = code
  session.done = true
  let note: string | undefined
  if (code === 0) {
    try {
      await restartOpencode(session.userId)
    } catch {
      note = "provider saved, but OpenCode did not restart"
    }
  }
  if (session.cancelled) return
  const frame = ttyExitFrame(code, note)
  for (const sock of session.sockets) {
    try {
      sock.send(frame)
      sock.close()
    } catch {
      // socket already closed
    }
  }
  session.sockets.clear()
  try {
    proc.terminal.close()
  } catch {
    // already closed
  }
  logins.delete(session.id)
}

function freshDesktop(userId: string) {
  return {
    userId,
    llmToken: randomToken(),
    opencodePassword: randomToken(),
    vikingKey: randomToken(),
    selectedProvider: null,
    selectedModel: null,
    lastActiveAt: Date.now(),
  }
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}

function sessionResponse(db: Db, user: User) {
  db.ensureDesktop(freshDesktop(user.id))
  const token = randomToken()
  db.createSession({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })
  return json(publicUser(user), 200, {
    "set-cookie": cookie(token, 30 * 24 * 60 * 60),
  })
}

async function desktopProxy(
  req: Request,
  url: URL,
  server: Bun.Server<SocketData>,
  db: Db,
) {
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  await ensure(user, db)
  db.touchDesktop(user.id)
  const view = url.pathname.startsWith("/desktop/view")
  const base = await endpoint(
    user.id,
    view ? "computer" : "opencode",
    view ? 6080 : 7681,
  )
  const targetPath = view
    ? url.pathname.replace("/desktop/view", "") || "/"
    : url.pathname
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const wsBase = base.replace(/^http/, "ws")
    const ok = server.upgrade(req, {
      data: {
        kind: "proxy",
        target: `${wsBase}${targetPath}${url.search}`,
        upstream: null,
        queue: [],
      },
    })
    return ok ? undefined : new Response("upgrade failed", { status: 400 })
  }
  return proxy(
    req,
    base,
    view ? "/desktop/view" : "",
    view ? undefined : undefined,
  )
}
