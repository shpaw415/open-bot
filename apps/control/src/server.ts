import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize } from "node:path"
import type { AiConfig } from "@open-bot/ai"
import {
  type CronJob,
  type CronScheduleKind,
  type Db,
  type ImageProvider,
  type Model3dProvider,
  type System1Provider,
  type User,
  type UserKeyFields,
  type VideoProvider,
  type VikingProvider,
  vikingProviderReady,
} from "@open-bot/db"
import { handleAdmin } from "./admin"
import { handleBackupApi } from "./backup-api"
import {
  cronModelFields,
  cronPersonaFields,
  fireCronJob,
  nextRunMs,
  normalizeCronRun,
  parseCron,
  parseRunKind,
} from "./cron"
import {
  blenderStatus,
  type ChatKeyEntry,
  desktopPhase,
  endpoint,
  isRunning,
  opencodeExec,
  restartOpencode,
  spawnLogin,
  spawnProjectShell,
  startDesktop,
  startError,
  stopDesktop,
  syncBlenderMcp,
  syncChatAuth,
  syncImageAuth,
  syncModel3dAuth,
  syncSystem1,
  syncVideoAuth,
  writeAgentUpload,
  writeProjectFile,
} from "./docker"
import { cookieSecure, devMode, names, webDist } from "./env"
import type { EventHub, EventsSocketData, Upstream } from "./events"
import { HttpError, httpErrorResponse } from "./http-error"
import {
  imageAuthReady,
  imageProviderById,
  imageProviderPublic,
  imageProviders,
} from "./image-providers"
import { handleImprovementPost } from "./improvements"
import { JOINED_REPLY, prepareJoinedPrompt } from "./join-file"
import {
  fillImageFromVault,
  fillModel3dFromVault,
  fillSystem1FromVault,
  fillVideoFromVault,
  imageVaultSlug,
  keyVaultFieldError,
  keyVaultPublic,
  keyVaultSpecById,
  model3dVaultSlug,
  resolveDesktopProviders,
  resolveImageProvider,
  resolveModel3dProvider,
  resolveSystem1,
  resolveVideoProvider,
  system1VaultSlug,
  videoVaultSlug,
} from "./key-vault"
import { handleLlm } from "./llm"
import {
  model3dAuthReady,
  model3dProviderById,
  model3dProviderPublic,
  model3dProviders,
} from "./model3d-providers"
import { hashPassword, randomToken, sha256, verifyPassword } from "./passwords"
import {
  ASSISTANT_ID,
  handlePersonas,
  mergeSystem,
  personaSystem,
  resolvePersona,
} from "./personas"
import { handlePlugins } from "./plugins"
import {
  projectDir,
  projectName,
  projectSubpath,
  slugifyName,
} from "./projects"
import { resolveReferenceLine } from "./references"
import { startReset } from "./reset"
import { ResetApprovals } from "./reset-approvals"
import {
  ensureThreadScreen,
  holdSystemLine,
  resolveRootSession,
  screenHeld,
  setScreenHold,
  stopThreadScreen,
} from "./screens"
import {
  system1EndpointError,
  system1FieldError,
  system1ProviderById,
  system1ProviderPublic,
  system1Providers,
} from "./system1"
import { claimThreadTitle, promptText, refineThreadTitle } from "./thread-title"
import { parseTtyControl, ttyExitFrame, ttySizeOr } from "./tty"
import {
  videoAuthReady,
  videoModelCatalog,
  videoModelLooksLikeImage,
  videoProviderById,
  videoProviderPublic,
  videoProviders,
} from "./video-providers"
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
import {
  MODEL3D_REPLY,
  workspaceModel3dPath,
  workspaceModel3dResponse,
} from "./workspace-model3d"
import {
  VIDEO_REPLY,
  workspaceVideoPath,
  workspaceVideoResponse,
} from "./workspace-video"

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

type TermSocket = {
  kind: "term"
  userId: string
  path: string
  cols: number
  rows: number
  proc: ReturnType<typeof spawnProjectShell> | null
  done: boolean
}

type EventsSocket = EventsSocketData

type SocketData = ProxySocket | LoginSocket | TermSocket | EventsSocket

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

const approvals = new ResetApprovals()
setInterval(() => approvals.sweep(), 60_000).unref?.()

const MAX_PROJECT_FILE_CHARS = 4 * 1024 * 1024

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

async function applySystem1(userId: string, value: System1Provider | null) {
  try {
    const applied = await syncSystem1(userId, value)
    return { ok: true, applied }
  } catch (error) {
    const message = error instanceof Error ? error.message : "apply failed"
    throw new HttpError(
      502,
      `Saved, but the desktop did not receive the provider: ${message}`,
      "system1_apply",
    )
  }
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

async function applyVideoAuth(userId: string, value: VideoProvider) {
  try {
    const applied = await syncVideoAuth(userId, {
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
      "video_auth_apply",
    )
  }
}

async function applyModel3dAuth(userId: string, value: Model3dProvider) {
  try {
    const applied = await syncModel3dAuth(userId, {
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
      "model3d_auth_apply",
    )
  }
}

async function applyVaultChange(
  user: User,
  db: Db,
  changed: { slug: string; key: string },
  revoke: ChatKeyEntry[] = [],
) {
  const applied: Record<string, unknown> = {}
  const image = resolveImageProvider(db, user.id)
  if (image && imageVaultSlug(image.value.provider) === changed.slug) {
    try {
      applied.image = await syncImageAuth(
        user.id,
        image.value.apiKey
          ? {
              provider: image.value.provider,
              accountId: image.value.accountId,
              token: image.value.apiKey,
              model: image.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing cf-ai setup")) applied.imageError = message
    }
  }
  const video = resolveVideoProvider(db, user.id)
  if (video && videoVaultSlug(video.value.provider) === changed.slug) {
    try {
      applied.video = await syncVideoAuth(
        user.id,
        video.value.apiKey
          ? {
              provider: video.value.provider,
              accountId: video.value.accountId,
              token: video.value.apiKey,
              model: video.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing video setup")) applied.videoError = message
    }
  }
  const model3d = resolveModel3dProvider(db, user.id)
  if (model3d && model3dVaultSlug(model3d.value.provider) === changed.slug) {
    try {
      applied.model3d = await syncModel3dAuth(
        user.id,
        model3d.value.apiKey
          ? {
              provider: model3d.value.provider,
              accountId: model3d.value.accountId,
              token: model3d.value.apiKey,
              model: model3d.value.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing model3d setup")) {
        applied.model3dError = message
      }
    }
  }
  const system1 = resolveSystem1(db, user.id)
  if (system1 && system1VaultSlug(system1.value.provider) === changed.slug) {
    const spec = system1ProviderById(system1.value.provider)
    const usable = Boolean(system1.value.apiKey) || !spec?.keyRequired
    try {
      applied.system1 = await syncSystem1(
        user.id,
        usable ? system1.value : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing system1 setup")) {
        applied.system1Error = message
      }
    }
  }
  if (keyVaultSpecById(changed.slug)?.chatProvider) {
    const desktop = db.desktop(user.id)
    if (desktop) {
      try {
        const chat = await syncChatAuth(
          user.id,
          basic(desktop.opencodePassword).authorization,
          changed.key ? [{ slug: changed.slug, key: changed.key }] : [],
          revoke,
        )
        applied.chat = chat
        if (chat.applied) await restartOpencode(user.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (!message.includes("missing chat setup")) {
          applied.chatError = message
        }
      }
    }
  }
  return applied
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
  const auth = resolveDesktopProviders(db, user.id)
  await startDesktop(
    user.id,
    desktop,
    auth.viking,
    auth.image,
    auth.system1,
    auth.video,
    auth.model3d,
    auth.chatKeys,
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
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
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

export function createServer(
  db: Db,
  ai: AiConfig,
  hostname: string,
  hub: EventHub,
) {
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
          url.pathname === "/api/events"
        ) {
          return await eventsUpgrade(req, db, server)
        }
        if (
          req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
          url.pathname.startsWith("/api/providers/login/")
        ) {
          return await loginTtyUpgrade(req, url, db, server)
        }
        if (
          req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
          url.pathname.startsWith("/api/projects/")
        ) {
          return await termUpgrade(req, url, db, server)
        }
        if (url.pathname.startsWith("/api/"))
          return await api(req, url, db, hub)
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
        if (ws.data.kind === "events") {
          hub.attach(ws, ws.data.userId)
          return
        }
        if (ws.data.kind === "login") {
          openLogin(ws)
          return
        }
        if (ws.data.kind === "term") {
          openTerm(ws)
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
        if (ws.data.kind === "events") return
        if (ws.data.kind === "login") {
          writeLogin(ws, message)
          return
        }
        if (ws.data.kind === "term") {
          writeTerm(ws, message)
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
        if (ws.data.kind === "events") {
          hub.detach(ws)
          return
        }
        if (ws.data.kind === "login") {
          closeLogin(ws)
          return
        }
        if (ws.data.kind === "term") {
          closeTerm(ws)
          return
        }
        ws.data.upstream?.close()
      },
    },
  })
}

async function api(req: Request, url: URL, db: Db, hub: EventHub) {
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
  if (url.pathname === "/api/improvements") {
    if (!devMode) return json({ error: "not found" }, 404)
    const agent = userFromLlmToken(req, db)
    if (!agent) return json({ error: "unauthorized" }, 401)
    return handleImprovementPost(req, db, agent)
  }
  if (url.pathname === "/api/agent-config" && req.method === "PUT") {
    const agent = userFromLlmToken(req, db)
    if (!agent) return json({ error: "unauthorized" }, 401)
    const body = await readJson(req)
    const kind = String(body.kind ?? "")
    const model = String(body.model ?? "").trim()
    if (!model) return json({ error: "model is required" }, 400)
    if (kind === "image") {
      const resolved = resolveImageProvider(db, agent.id)
      if (!resolved) return json({ error: "no image provider configured" }, 400)
      const raw = db.getRawImageProvider(agent.id)
      db.setImageProvider(agent.id, { ...(raw ?? resolved.value), model })
      const next = { ...resolved.value, model }
      return json({
        provider: next.provider,
        model: next.model,
        keySource: resolved.keySource,
        ...(await applyImageAuth(agent.id, next)),
      })
    }
    if (kind === "video") {
      const resolved = resolveVideoProvider(db, agent.id)
      if (!resolved) return json({ error: "no video provider configured" }, 400)
      if (videoModelLooksLikeImage(model)) {
        return json(
          { error: `${model} is an image model, not a video model` },
          400,
        )
      }
      const raw = db.getRawVideoProvider(agent.id)
      db.setVideoProvider(agent.id, { ...(raw ?? resolved.value), model })
      const next = { ...resolved.value, model }
      return json({
        provider: next.provider,
        model: next.model,
        keySource: resolved.keySource,
        ...(await applyVideoAuth(agent.id, next)),
      })
    }
    if (kind === "model3d") {
      const resolved = resolveModel3dProvider(db, agent.id)
      if (!resolved) {
        return json({ error: "no 3d model provider configured" }, 400)
      }
      const raw = db.getRawModel3dProvider(agent.id)
      db.setModel3dProvider(agent.id, { ...(raw ?? resolved.value), model })
      const next = { ...resolved.value, model }
      return json({
        provider: next.provider,
        model: next.model,
        keySource: resolved.keySource,
        ...(await applyModel3dAuth(agent.id, next)),
      })
    }
    return json({ error: "kind must be image, video, or model3d" }, 400)
  }
  const isBackupPath =
    url.pathname.startsWith("/api/backup") ||
    url.pathname.startsWith("/api/reset-requests") ||
    url.pathname.startsWith("/api/reset-ops") ||
    url.pathname === "/api/desktop/reset" ||
    url.pathname === "/api/factory-reset"
  if (isBackupPath) {
    const agent = userFromLlmToken(req, db)
    if (agent) {
      const handled = await handleBackupApi(
        req,
        url,
        db,
        hub,
        { actor: agent, scope: "agent" },
        approvals,
      )
      if (handled) return handled
    }
  }
  const isCronPath =
    url.pathname === "/api/cron" || url.pathname.startsWith("/api/cron/")
  const isPersonaPath =
    url.pathname === "/api/personas" ||
    url.pathname.startsWith("/api/personas/")
  const isPluginPath =
    url.pathname === "/api/plugins" || url.pathname.startsWith("/api/plugins/")
  if (isCronPath || isPersonaPath || isPluginPath) {
    const agent = userFromLlmToken(req, db)
    if (agent) {
      if (isPersonaPath) {
        const handled = handlePersonas(req, url, db, agent)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isPluginPath) {
        const handled = handlePlugins(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isCronPath) return handleCron(req, url, db, agent, hub)
    }
  }
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  if (isPersonaPath) {
    const handled = handlePersonas(req, url, db, user)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isPluginPath) {
    const handled = handlePlugins(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isCronPath) return handleCron(req, url, db, user, hub)
  if (isBackupPath) {
    const handled = await handleBackupApi(
      req,
      url,
      db,
      hub,
      { actor: user, scope: user.role === "admin" ? "admin" : "user" },
      approvals,
    )
    if (handled) return handled
  }
  const adminResetMatch = url.pathname.match(
    /^\/api\/admin\/users\/([^/]+)\/reset-desktop$/,
  )
  if (adminResetMatch && req.method === "POST") {
    if (user.role !== "admin") return json({ error: "admin only" }, 403)
    const target = db.userById(decodeURIComponent(adminResetMatch[1] ?? ""))
    if (!target) return json({ error: "user not found" }, 404)
    const body = await readJson(req)
    const op = startReset(db, hub, target.id, {
      backup: body.backup !== false,
    })
    return json({ opId: op.id }, 202)
  }
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
      const auth = resolveDesktopProviders(db, user.id)
      void startDesktop(
        user.id,
        desktop,
        auth.viking,
        auth.image,
        auth.system1,
        auth.video,
        auth.model3d,
        auth.chatKeys,
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
      held: await screenHeld(user.id, root),
    })
  }
  if (url.pathname === "/api/desktop/screen/hold" && req.method === "GET") {
    if ((await desktopPhase(user.id)) !== "running") {
      return json({ sessionId: "", held: false })
    }
    const desktop = db.desktop(user.id)
    if (!desktop) return json({ sessionId: "", held: false })
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      url.searchParams.get("sessionId") ?? "",
    )
    return json({ sessionId: root, held: await screenHeld(user.id, root) })
  }
  if (url.pathname === "/api/desktop/screen/hold" && req.method === "POST") {
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      String(body.sessionId ?? ""),
    )
    const screen = await ensureThreadScreen(db, user.id, root)
    await setScreenHold(user.id, root, true)
    return json({
      sessionId: screen.sessionId,
      path: screen.path,
      held: true,
    })
  }
  if (url.pathname === "/api/desktop/screen/hold" && req.method === "DELETE") {
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      String(body.sessionId ?? ""),
    )
    await setScreenHold(user.id, root, false)
    return json({ sessionId: root, held: false })
  }
  if (url.pathname === "/api/keys" && req.method === "GET") {
    const entries = db.getUserKeys(user.id).map((key) => ({
      slug: key.slug,
      accountId: key.accountId,
      gatewayId: key.gatewayId,
      gatewaySlug: key.gatewaySlug,
      baseUrl: key.baseUrl,
      hasKey: key.apiKey !== "",
      hasGatewayToken: key.gatewayToken !== "",
      updatedAt: key.updatedAt,
    }))
    return json({
      catalog: keyVaultPublic(),
      entries,
      sources: {
        image: resolveImageProvider(db, user.id)?.keySource ?? null,
        video: resolveVideoProvider(db, user.id)?.keySource ?? null,
        model3d: resolveModel3dProvider(db, user.id)?.keySource ?? null,
        system1: resolveSystem1(db, user.id)?.keySource ?? null,
      },
    })
  }
  if (url.pathname === "/api/keys" && req.method === "PUT") {
    const body = await readJson(req)
    const slug = String(body.slug ?? "").trim()
    const spec = keyVaultSpecById(slug)
    if (!spec) return json({ error: "unknown key entry" }, 400)
    const current = db.getUserKey(user.id, slug)
    const field = (name: keyof UserKeyFields) =>
      String(body[name] ?? "").trim() || current?.[name] || ""
    const fields: UserKeyFields = {
      apiKey: field("apiKey"),
      accountId: field("accountId"),
      gatewayId: field("gatewayId"),
      gatewayToken: field("gatewayToken"),
      gatewaySlug: field("gatewaySlug"),
      baseUrl: field("baseUrl"),
    }
    for (const name of ["gatewayId", "gatewaySlug"] as const) {
      const error = keyVaultFieldError(slug, name, fields[name])
      if (error) return json({ error }, 400)
    }
    if (Object.values(fields).every((value) => value === "")) {
      return json({ error: "at least one field is required" }, 400)
    }
    db.setUserKey(user.id, slug, fields)
    const applied = await applyVaultChange(user, db, {
      slug,
      key: fields.apiKey,
    })
    return json({ ok: true, applied })
  }
  if (url.pathname === "/api/keys" && req.method === "DELETE") {
    const slug = url.searchParams.get("slug") ?? ""
    const spec = keyVaultSpecById(slug)
    if (!spec) return json({ error: "unknown key entry" }, 400)
    const current = db.getUserKey(user.id, slug)
    db.clearUserKey(user.id, slug)
    const revoke: ChatKeyEntry[] =
      spec.chatProvider && current?.apiKey
        ? [{ slug, key: current.apiKey }]
        : []
    const applied = await applyVaultChange(user, db, { slug, key: "" }, revoke)
    return json({ ok: true, applied })
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
      keySource: resolveImageProvider(db, user.id)?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/image" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getRawImageProvider(user.id)
    const spec = imageProviderById(String(body.provider ?? "").trim())
    if (!spec) return json({ error: "unsupported image provider" }, 400)
    const typedKey = String(body.apiKey ?? "").trim()
    const next: ImageProvider = {
      provider: spec.id,
      accountId: String(body.accountId ?? "").trim(),
      apiKey: typedKey || (current?.provider === spec.id ? current.apiKey : ""),
      model: String(body.model ?? "").trim() || spec.defaultModel,
    }
    const vault = db.getUserKey(user.id, imageVaultSlug(spec.id))
    if (!imageAuthReady(fillImageFromVault(next, vault))) {
      return json(
        { error: "the fields required by this provider are missing" },
        400,
      )
    }
    db.setImageProvider(user.id, next)
    const resolved = resolveImageProvider(db, user.id)
    return json({
      keySource: resolved?.keySource ?? null,
      ...(await applyImageAuth(user.id, resolved?.value ?? next)),
    })
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
  if (url.pathname === "/api/video" && req.method === "GET") {
    const saved = db.getVideoProvider(user.id)
    const selected =
      videoProviderById(saved?.provider ?? "") ?? videoProviders[0]
    return json({
      providers: videoProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      accountId: saved?.accountId ?? "",
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: Boolean(saved?.apiKey),
      keySource: resolveVideoProvider(db, user.id)?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/video" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getRawVideoProvider(user.id)
    const spec = videoProviderById(String(body.provider ?? "").trim())
    if (!spec) return json({ error: "unsupported video provider" }, 400)
    const typedKey = String(body.apiKey ?? "").trim()
    const next: VideoProvider = {
      provider: spec.id,
      accountId: String(body.accountId ?? "").trim(),
      apiKey: typedKey || (current?.provider === spec.id ? current.apiKey : ""),
      model: String(body.model ?? "").trim() || spec.defaultModel,
    }
    const vault = db.getUserKey(user.id, videoVaultSlug(spec.id))
    const resolvedNext = fillVideoFromVault(next, vault)
    if (!videoAuthReady(resolvedNext)) {
      return json(
        { error: "the fields required by this provider are missing" },
        400,
      )
    }
    if (videoModelLooksLikeImage(next.model)) {
      return json(
        {
          error: `${next.model} is an image model, not a video model. Pick a video model for ${spec.label} (examples: ${(videoModelCatalog[spec.id] ?? []).join(", ")}).`,
        },
        400,
      )
    }
    db.setVideoProvider(user.id, next)
    const resolved = resolveVideoProvider(db, user.id)
    return json({
      keySource: resolved?.keySource ?? null,
      ...(await applyVideoAuth(user.id, resolved?.value ?? next)),
    })
  }
  if (url.pathname === "/api/video" && req.method === "DELETE") {
    db.clearVideoProvider(user.id)
    try {
      await syncVideoAuth(user.id, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing video setup")) {
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
  if (url.pathname === "/api/mcp" && req.method === "GET") {
    return json(await blenderStatus(user.id))
  }
  if (url.pathname === "/api/mcp" && req.method === "PUT") {
    const body = await readJson(req)
    const enabled = Boolean(body.enabled)
    const applied = await syncBlenderMcp(user.id, enabled)
    if (applied) await restartOpencode(user.id)
    return json({ applied, ...(await blenderStatus(user.id)) })
  }
  if (url.pathname === "/api/model3d" && req.method === "GET") {
    const saved = db.getModel3dProvider(user.id)
    const selected =
      model3dProviderById(saved?.provider ?? "") ?? model3dProviders[0]
    return json({
      providers: model3dProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      accountId: saved?.accountId ?? "",
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: Boolean(saved?.apiKey),
      keySource: resolveModel3dProvider(db, user.id)?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/model3d" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getRawModel3dProvider(user.id)
    const spec = model3dProviderById(String(body.provider ?? "").trim())
    if (!spec) return json({ error: "unsupported 3d model provider" }, 400)
    const typedKey = String(body.apiKey ?? "").trim()
    const next: Model3dProvider = {
      provider: spec.id,
      accountId: String(body.accountId ?? "").trim(),
      apiKey: typedKey || (current?.provider === spec.id ? current.apiKey : ""),
      model: String(body.model ?? "").trim() || spec.defaultModel,
    }
    const vault = db.getUserKey(user.id, model3dVaultSlug(spec.id))
    if (!model3dAuthReady(fillModel3dFromVault(next, vault))) {
      return json(
        { error: "the fields required by this provider are missing" },
        400,
      )
    }
    db.setModel3dProvider(user.id, next)
    const resolved = resolveModel3dProvider(db, user.id)
    return json({
      keySource: resolved?.keySource ?? null,
      ...(await applyModel3dAuth(user.id, resolved?.value ?? next)),
    })
  }
  if (url.pathname === "/api/model3d" && req.method === "DELETE") {
    db.clearModel3dProvider(user.id)
    try {
      await syncModel3dAuth(user.id, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing model3d setup")) {
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
  if (url.pathname === "/api/system1" && req.method === "GET") {
    const saved = db.getSystem1(user.id)
    const selected =
      system1ProviderById(saved?.provider ?? "") ?? system1Providers[0]
    const resolved = resolveSystem1(db, user.id)
    return json({
      providers: system1ProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      endpoint: saved?.endpoint ?? "",
      model: saved?.model ?? selected?.defaultModel ?? "",
      accountId: saved?.accountId ?? "",
      gatewayId: saved?.gatewayId ?? "",
      slug: saved?.slug ?? "jev",
      hasKey: Boolean(saved?.apiKey),
      hasGatewayToken: Boolean(saved?.gatewayToken),
      keySource: resolved?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/system1" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getSystem1(user.id)
    const spec = system1ProviderById(String(body.provider ?? "").trim())
    if (!spec) return json({ error: "unsupported provider" }, 400)
    const endpoint = String(body.endpoint ?? "").trim()
    const endpointError = system1EndpointError(spec.id, endpoint)
    if (endpointError) return json({ error: endpointError }, 400)
    const accountId = String(body.accountId ?? "").trim()
    const gatewayId = String(body.gatewayId ?? "").trim()
    const slug = String(body.slug ?? "").trim()
    for (const [name, value] of [
      ["account", accountId],
      ["gateway", gatewayId],
      ["slug", slug],
    ] as const) {
      const fieldError = system1FieldError(name, value)
      if (fieldError) return json({ error: fieldError }, 400)
    }
    const typedKey = String(body.apiKey ?? "").trim()
    const typedGateway = String(body.gatewayToken ?? "").trim()
    const next: System1Provider = {
      provider: spec.id,
      endpoint,
      apiKey: typedKey || (current?.provider === spec.id ? current.apiKey : ""),
      gatewayToken: spec.gatewayToken
        ? typedGateway ||
          (current?.provider === spec.id ? current.gatewayToken : "")
        : "",
      model: String(body.model ?? "").trim() || spec.defaultModel,
      accountId,
      gatewayId,
      slug,
    }
    const vault = db.getUserKey(user.id, system1VaultSlug(spec.id))
    const resolvedNext = fillSystem1FromVault(next, vault)
    if (spec.keyRequired && !resolvedNext.apiKey) {
      return json({ error: "API key is required" }, 400)
    }
    db.setSystem1(user.id, next)
    const resolved = resolveSystem1(db, user.id)
    return json({
      keySource: resolved?.keySource ?? null,
      ...(await applySystem1(user.id, resolved?.value ?? next)),
    })
  }
  if (url.pathname === "/api/system1" && req.method === "DELETE") {
    db.clearSystem1(user.id)
    try {
      await syncSystem1(user.id, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing system1 setup")) {
        return json(
          {
            error: message || "removed, but the desktop still has the provider",
          },
          502,
        )
      }
    }
    return json({ ok: true })
  }
  if (url.pathname === "/api/projects" && req.method === "GET") {
    return json({
      projects: db.projects(user.id).map(({ id, name, path, createdAt }) => ({
        id,
        name,
        path,
        createdAt,
      })),
    })
  }
  if (url.pathname === "/api/projects" && req.method === "POST") {
    const body = await readJson(req)
    const name = projectName(body.name)
    if (!name) return json({ error: "a project name is required" }, 400)
    const slug = slugifyName(name)
    if (!slug) return json({ error: "a project name is required" }, 400)
    if (db.projectByName(user.id, name))
      return json({ error: "a project with this name already exists" }, 409)
    const path = projectDir(slug)
    await ensure(user, db)
    const made = await opencodeExec(user.id, ["mkdir", "-p", "--", path])
    if (made.code !== 0)
      return json({ error: "could not create the project directory" }, 502)
    const project = {
      id: crypto.randomUUID(),
      userId: user.id,
      name,
      path,
      createdAt: Date.now(),
    }
    db.createProject(project)
    return json({
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        createdAt: project.createdAt,
      },
    })
  }
  const projectIdMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
  if (projectIdMatch && req.method === "DELETE") {
    const id = decodeURIComponent(projectIdMatch[1] ?? "")
    if (!db.deleteProject(id, user.id)) return json({ error: "not found" }, 404)
    return json({ ok: true })
  }
  const projectRef = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/(files|file)$/,
  )
  if (projectRef && (req.method === "GET" || req.method === "PUT")) {
    const project = db.projectById(
      decodeURIComponent(projectRef[1] ?? ""),
      user.id,
    )
    if (!project) return json({ error: "not found" }, 404)
    const kind = projectRef[2]
    if (kind === "files" && req.method === "GET") {
      const path = projectSubpath(
        project.path,
        url.searchParams.get("path") || project.path,
      )
      if (!path) return json({ error: "not found" }, 404)
      const desktop = await ensure(user, db)
      const base = await endpoint(user.id, "opencode", 4096)
      const upstream = await fetch(
        `${base}/file?path=${encodeURIComponent(path)}`,
        { headers: basic(desktop.opencodePassword) },
      )
      if (!upstream.ok) return json({ error: "listing failed" }, 502)
      return new Response(upstream.body, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      })
    }
    if (kind === "file" && req.method === "GET") {
      const path = projectSubpath(
        project.path,
        url.searchParams.get("path") ?? "",
      )
      if (!path) return json({ error: "not found" }, 404)
      const desktop = await ensure(user, db)
      const base = await endpoint(user.id, "opencode", 4096)
      const upstream = await fetch(
        `${base}/file/content?path=${encodeURIComponent(path)}`,
        { headers: basic(desktop.opencodePassword) },
      )
      if (!upstream.ok) return json({ error: "not found" }, 404)
      const body = (await upstream.json().catch(() => null)) as {
        type?: unknown
        encoding?: unknown
        content?: unknown
      } | null
      if (!body || typeof body.content !== "string")
        return json({ error: "not found" }, 404)
      if (body.content.length > MAX_PROJECT_FILE_CHARS)
        return json({ error: "file is too large to open" }, 413)
      return json({
        type: body.type,
        encoding: body.encoding,
        content: body.content,
      })
    }
    if (kind === "file" && req.method === "PUT") {
      const path = projectSubpath(
        project.path,
        url.searchParams.get("path") ?? "",
      )
      if (!path) return json({ error: "not found" }, 404)
      const raw = await req.text()
      if (raw.length > MAX_PROJECT_FILE_CHARS)
        return json({ error: "file is too large to save" }, 413)
      if (raw.includes("\0"))
        return json({ error: "binary files cannot be saved here" }, 400)
      await ensure(user, db)
      await writeProjectFile(user.id, path, new TextEncoder().encode(raw))
      return json({ ok: true })
    }
  }
  const projectSearch = url.pathname.match(/^\/api\/projects\/([^/]+)\/search$/)
  if (projectSearch && req.method === "GET") {
    const project = db.projectById(
      decodeURIComponent(projectSearch[1] ?? ""),
      user.id,
    )
    if (!project) return json({ error: "not found" }, 404)
    await ensure(user, db)
    const find = await opencodeExec(user.id, [
      "sh",
      "-c",
      `find ${shellQuote(project.path)} -type f -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | head -n 2000`,
    ])
    const files = find.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${project.path}/`))
    return json({ files })
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
    const catalog = (providers?.all ?? [])
      .filter(
        (item: { id?: unknown; name?: unknown }) =>
          typeof item?.id === "string",
      )
      .map((item: { id: string; name?: unknown }) => ({
        id: item.id,
        name: typeof item.name === "string" && item.name ? item.name : item.id,
      }))
    const saved = db.desktop(user.id)
    return json({
      providers: {
        catalog,
        connected: providers?.connected ?? [],
      },
      auth,
      selected: saved,
    })
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
  if (url.pathname === "/api/models" && req.method === "GET")
    return json(await connectedModels(user, db))
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
  if (url.pathname === "/api/workspace/video" && req.method === "GET") {
    const path = workspaceVideoPath(url.searchParams.get("path") ?? "")
    if (!path) return json({ error: "not found" }, 404)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const upstream = await fetch(
      `${base}/file/content?path=${encodeURIComponent(path)}`,
      { headers: basic(desktop.opencodePassword) },
    )
    if (!upstream.ok) return json({ error: "not found" }, 404)
    const video = workspaceVideoResponse(
      await upstream.json().catch(() => null),
    )
    if (!video) return json({ error: "not found" }, 404)
    return video
  }
  if (url.pathname === "/api/workspace/model3d" && req.method === "GET") {
    const path = workspaceModel3dPath(url.searchParams.get("path") ?? "")
    if (!path) return json({ error: "not found" }, 404)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const upstream = await fetch(
      `${base}/file/content?path=${encodeURIComponent(path)}`,
      { headers: basic(desktop.opencodePassword) },
    )
    if (!upstream.ok) return json({ error: "not found" }, 404)
    const model = workspaceModel3dResponse(
      await upstream.json().catch(() => null),
    )
    if (!model) return json({ error: "not found" }, 404)
    return model
  }
  if (url.pathname.startsWith("/api/opencode/")) {
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const auth = basic(desktop.opencodePassword)
    if (url.pathname === "/api/opencode/session" && req.method === "POST")
      return createOpencodeSession(req, base, auth, db, user.id)
    const sessionRef = url.pathname.match(/^\/api\/opencode\/session\/([^/]+)$/)
    if (sessionRef && req.method === "DELETE") {
      const id = decodeURIComponent(sessionRef[1] ?? "")
      const res = await proxy(req, base, "/api/opencode", auth)
      if (res.ok) {
        db.clearThreadPersona(user.id, id)
        db.clearThreadTitle(user.id, id)
        await stopThreadScreen(db, user.id, id)
      }
      return res
    }
    if (sessionRef && req.method === "PATCH") {
      const id = decodeURIComponent(sessionRef[1] ?? "")
      const raw = await req.text()
      let parsed: { title?: unknown } | null = null
      try {
        parsed = JSON.parse(raw) as { title?: unknown }
      } catch {
        parsed = null
      }
      const title =
        parsed && typeof parsed.title === "string" ? parsed.title.trim() : ""
      if (title) {
        const root = await resolveRootSession(base, auth, id).catch(() => id)
        db.setThreadTitle({
          userId: user.id,
          sessionId: root,
          title,
          author: "user",
          createdAt: Date.now(),
        })
      }
      return proxy(req, base, "/api/opencode", auth, raw)
    }
    const prompted = url.pathname.match(
      /^\/api\/opencode\/session\/([^/]+)\/(?:prompt_async|message)$/,
    )
    if (prompted && req.method === "POST") {
      const promptedId = decodeURIComponent(prompted[1] ?? "")
      const parsed = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      const body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {}
      const prepared = prepareJoinedPrompt(body)
      for (const upload of prepared.uploads)
        await writeAgentUpload(user.id, upload.path, upload.bytes)
      const outbound = prepared.body
      const text = promptText(body)
      const root = await resolveRootSession(base, auth, promptedId)
      const screen = await Promise.race([
        ensureThreadScreen(db, user.id, root).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ])
      const line = [
        personaSystem(
          resolvePersona(
            db,
            user.id,
            db.threadPersona(user.id, promptedId)?.personaId ?? ASSISTANT_ID,
          ),
        ),
        screen?.system ??
          "This thread's screen is still starting. Do not guess a VNC port. Do not call vncdo.",
        screen &&
        (await Promise.race([
          screenHeld(user.id, root),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 2000),
          ),
        ]))
          ? holdSystemLine()
          : "",
        prepared.uploads.length ? JOINED_REPLY : "",
        IMAGE_REPLY,
        VIDEO_REPLY,
        MODEL3D_REPLY,
        await resolveReferenceLine(db, user, text),
      ]
        .filter((item): item is string => Boolean(item))
        .join("\n\n")
      if (text) {
        const claimed = await claimThreadTitle(
          base,
          auth,
          db,
          user.id,
          root,
          text,
        )
        if (claimed) void refineThreadTitle(base, auth, db, user.id, root, text)
      }
      return proxy(
        req,
        base,
        "/api/opencode",
        auth,
        JSON.stringify({
          ...outbound,
          system: mergeSystem(outbound.system, line),
        }),
      )
    }
    return proxy(req, base, "/api/opencode", auth)
  }
  return json({ error: "not found" }, 404)
}

const CRON_LOOKAHEAD_MS = 4 * 366 * 24 * 60 * 60 * 1000

async function connectedModels(user: User, db: Db) {
  const desktop = await ensure(user, db)
  const base = await endpoint(user.id, "opencode", 4096)
  const response = await fetch(`${base}/provider`, {
    headers: basic(desktop.opencodePassword),
  })
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
  return { models, connected }
}

async function handleCron(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
) {
  const idMatch = url.pathname.match(/^\/api\/cron\/([^/]+)(\/run)?$/)

  if (url.pathname === "/api/cron/notices" && req.method === "GET")
    return json(db.recentCronNotices(user.id, 20))

  if (url.pathname === "/api/cron/notices/view" && req.method === "POST") {
    const body = await readJson(req)
    const id = String(body.id ?? "").trim()
    if (!id) return json({ error: "id is required" }, 400)
    db.viewCronNotice(id, user.id)
    hub.emit(user.id, { type: "cron.notices" })
    return json({ ok: true })
  }

  if (url.pathname === "/api/cron/models" && req.method === "GET")
    return json(await connectedModels(user, db))

  if (url.pathname === "/api/cron" && req.method === "GET")
    return json(db.cronJobs(user.id))

  if (url.pathname === "/api/cron" && req.method === "POST") {
    const body = await readJson(req)
    const name = String(body.name ?? "").trim()
    if (!name) return json({ error: "name is required" }, 400)
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
    const runKind =
      body.runKind === undefined ? "prompt" : parseRunKind(body.runKind)
    if (!runKind)
      return json({ error: "runKind must be prompt, script, or both" }, 400)
    const normalized = normalizeCronRun({
      runKind,
      message: String(body.message ?? ""),
      script:
        body.script == null || body.script === "" ? null : String(body.script),
    })
    if ("error" in normalized) return json({ error: normalized.error }, 400)
    const job: CronJob = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: name.slice(0, 80),
      message: normalized.message,
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
      providerId: null,
      modelId: null,
      personaId: null,
      runKind,
      script: normalized.script,
    }
    const model = cronModelFields(body)
    if ("error" in model) return json({ error: model.error }, 400)
    if (!("omitted" in model)) {
      job.providerId = model.providerId
      job.modelId = model.modelId
    }
    const persona = cronPersonaFields(body, (id) =>
      Boolean(resolvePersona(db, user.id, id)),
    )
    if ("error" in persona) return json({ error: persona.error }, 400)
    if (!("omitted" in persona)) job.personaId = persona.personaId
    job.nextRunAt = nextRunMs(job)
    db.createCronJob(job)
    hub.emit(user.id, { type: "cron.changed" })
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
      providerId?: string | null
      modelId?: string | null
      personaId?: string | null
      runKind?: CronJob["runKind"]
      script?: string | null
    } = {}
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim()
      if (!name) return json({ error: "name cannot be empty" }, 400)
      changes.name = name.slice(0, 80)
    }
    if (
      body.runKind !== undefined ||
      body.message !== undefined ||
      body.script !== undefined
    ) {
      const runKind =
        body.runKind === undefined ? job.runKind : parseRunKind(body.runKind)
      if (!runKind)
        return json({ error: "runKind must be prompt, script, or both" }, 400)
      const message =
        body.message === undefined ? job.message : String(body.message ?? "")
      const script =
        body.script === undefined
          ? job.script
          : body.script == null
            ? null
            : String(body.script)
      const normalized = normalizeCronRun({ runKind, message, script })
      if ("error" in normalized) return json({ error: normalized.error }, 400)
      changes.runKind = runKind
      changes.message = normalized.message
      changes.script = normalized.script
    }
    if (body.enabled !== undefined) {
      const enabled = Boolean(body.enabled)
      changes.enabled = enabled
      if (enabled) changes.nextRunAt = nextRunMs(job)
    }
    const model = cronModelFields(body)
    if ("error" in model) return json({ error: model.error }, 400)
    if (!("omitted" in model)) {
      changes.providerId = model.providerId
      changes.modelId = model.modelId
    }
    const persona = cronPersonaFields(body, (id) =>
      Boolean(resolvePersona(db, user.id, id)),
    )
    if ("error" in persona) return json({ error: persona.error }, 400)
    if (!("omitted" in persona)) changes.personaId = persona.personaId
    const updated = db.updateCronJob(job.id, user.id, changes)
    hub.emit(user.id, { type: "cron.changed" })
    return json(updated)
  }

  if (idMatch && !idMatch[2] && req.method === "DELETE") {
    const removed = db.deleteCronJob(
      decodeURIComponent(idMatch[1] ?? ""),
      user.id,
    )
    if (!removed) return json({ error: "job not found" }, 404)
    hub.emit(user.id, { type: "cron.changed" })
    return json({ ok: true })
  }

  if (idMatch?.[2] === "/run" && req.method === "POST") {
    const job = db.cronJobById(decodeURIComponent(idMatch[1] ?? ""), user.id)
    if (!job) return json({ error: "job not found" }, 404)
    const error = await fireCronJob(db, job, true, hub)
    if (error) return json({ ok: false, error }, 502)
    return json({ ok: true })
  }

  return json({ error: "not found" }, 404)
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function eventsUpgrade(
  req: Request,
  db: Db,
  server: Bun.Server<SocketData>,
): Promise<Response | undefined> {
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  if (user.disabled) return json({ error: "account disabled" }, 403)
  const ok = server.upgrade(req, {
    data: { kind: "events", userId: user.id },
  })
  return ok ? undefined : new Response("upgrade failed", { status: 400 })
}

/** Best-effort upstream for the event hub; null while the desktop is not running. */
export async function eventTarget(
  db: Db,
  userId: string,
): Promise<Upstream | null> {
  const desktop = db.desktop(userId)
  if (!desktop) return null
  if ((await desktopPhase(userId)) !== "running") return null
  try {
    const base = await endpoint(userId, "opencode", 4096)
    return { base, auth: basic(desktop.opencodePassword).authorization }
  } catch {
    return null
  }
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

async function termUpgrade(
  req: Request,
  url: URL,
  db: Db,
  server: Bun.Server<SocketData>,
) {
  const user = userFrom(req, db)
  if (!user) return json({ error: "unauthorized" }, 401)
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/terminal$/)
  if (!match) return json({ error: "not found" }, 404)
  const project = db.projectById(decodeURIComponent(match[1] ?? ""), user.id)
  if (!project) return json({ error: "not found" }, 404)
  await ensure(user, db)
  db.touchDesktop(user.id)
  const ok = server.upgrade(req, {
    data: {
      kind: "term",
      userId: user.id,
      path: project.path,
      cols: ttySizeOr(url.searchParams.get("cols"), 80),
      rows: ttySizeOr(url.searchParams.get("rows"), 24),
      proc: null,
      done: false,
    },
  })
  return ok ? undefined : new Response("upgrade failed", { status: 400 })
}

function openTerm(ws: Bun.ServerWebSocket<SocketData>) {
  const data = ws.data
  if (data.kind !== "term") return
  try {
    data.proc = spawnProjectShell(data.userId, {
      cwd: data.path,
      cols: data.cols,
      rows: data.rows,
      onData(chunk) {
        try {
          ws.send(chunk)
        } catch {
          // socket already closed
        }
      },
    })
  } catch (error) {
    data.done = true
    ws.send(
      ttyExitFrame(1, error instanceof Error ? error.message : "shell failed"),
    )
    ws.close()
    return
  }
  const proc = data.proc
  if (!proc) return
  void proc.exited.then((code) => {
    if (data.done) return
    data.done = true
    try {
      ws.send(ttyExitFrame(code))
      ws.close()
    } catch {
      // socket already closed
    }
  })
}

function writeTerm(
  ws: Bun.ServerWebSocket<SocketData>,
  message: string | Buffer,
) {
  const data = ws.data
  if (data.kind !== "term") return
  const terminal = data.proc?.terminal
  if (!terminal || data.done) return
  if (typeof message === "string") {
    const resize = parseTtyControl(message)
    if (resize) terminal.resize(resize.cols, resize.rows)
    return
  }
  terminal.write(new Uint8Array(message))
}

function closeTerm(ws: Bun.ServerWebSocket<SocketData>) {
  const data = ws.data
  if (data.kind !== "term") return
  data.done = true
  try {
    data.proc?.kill()
  } catch {
    // already exited
  }
  try {
    data.proc?.terminal.close()
  } catch {
    // already closed
  }
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
  const response = await proxy(req, base, view ? "/desktop/view" : "")
  if (!view) return response
  const headers = new Headers(response.headers)
  headers.set("cache-control", "no-cache")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
