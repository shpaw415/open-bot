import { createReadStream, readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize, sep } from "node:path"
import type { AiConfig } from "@open-bot/ai"
import {
  type CronJob,
  type CronScheduleKind,
  type Db,
  DEFAULT_AGENT_STEP_CAP,
  type ImageProvider,
  type Model3dProvider,
  type System1Provider,
  type User,
  type UserKeyFields,
  type VideoProvider,
  type VikingProvider,
  type VoiceConfig,
  validAgentStepCap,
  vikingProviderReady,
} from "@open-bot/db"
import { handleAdmin } from "./admin"
import { handleKeys, isKeysRequest, keysTeamLocked } from "./api-keys"
import { desktopAppCatalog, launchDesktopApp } from "./apps"
import { handleBackupApi } from "./backup-api"
import { handleCatalogDirs } from "./catalog-dirs"
import {
  type CliId,
  cliProviderById,
  cliProviders,
  filterCliModels,
  isCliProviderId,
} from "./cli-bridge/providers"
import { handleCouncils, isCouncilPath } from "./councils"
import {
  cleanupGuardSharedThread,
  cronModelFields,
  cronPersonaFields,
  fireCronJob,
  GUARD_JOB_RE,
  nextRunMs,
  normalizeCronRun,
  parseCron,
  parseRunKind,
  UNLIMITED_STEPS_AGENT,
} from "./cron"
import { handleDelegations, isDelegationsPath } from "./delegations"
import {
  type ChatKeyEntry,
  currentStart,
  desktopPhase,
  disconnectOpencodeProvider,
  enableOpencodeProvider,
  endpoint,
  isRunning,
  opencodeDisabledProviders,
  opencodeExec,
  pendingRestart,
  probeCliProviders,
  probeCliProvidersCached,
  restartOpencode,
  spawnCliLogin,
  spawnLogin,
  spawnProjectShell,
  startDesktop,
  startError,
  stopDesktop,
  syncAgentCap,
  syncChatAuth,
  syncCliAuth,
  syncImageAuth,
  syncModel3dAuth,
  syncSystem1,
  syncVideoAuth,
  syncVikingCodexAuth,
  syncWatchdogConfig,
  writeProjectFile,
} from "./docker"
import {
  basicOpencodeAuth as basic,
  clearModelVariants,
  fetchModelVariants,
  resolveThreadModel,
  supportsEffort,
  type ThreadModelChoice,
  validateModelChoice,
} from "./effort"
import { cookieSecure, names, trustProxy, webDist } from "./env"
import type { EventHub, EventsSocketData, Upstream } from "./events"
import { HttpError, httpErrorResponse } from "./http-error"
import {
  imageAuthReady,
  imageProviderById,
  imageProviderPublic,
  imageProviders,
} from "./image-providers"
import { handleImprovementPost } from "./improvements"
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
import {
  instanceLanguage,
  isValidLanguage,
  SUPPORTED_LANGUAGES,
} from "./language"
import { handleLlm } from "./llm"
import {
  createLoginUrlScanner,
  isLocalUrl,
  parseLocalCallbackUrl,
} from "./login-urls"
import { handleMcp } from "./mcp"
import { handleMedia, isMediaRequest } from "./media-vault"
import { pageMessages, parseMessagePageQuery } from "./messages-page"
import { trimDashboardMessages } from "./messages-trim"
import {
  model3dAuthReady,
  model3dProviderById,
  model3dProviderPublic,
  model3dProviders,
} from "./model3d-providers"
import { effectiveProto, insecureRedirect } from "./origin-guard"
import { hashPassword, randomToken, sha256, verifyPassword } from "./passwords"
import { handlePersonas, personaScope, resolvePersona } from "./personas"
import { pluginOriginForCronJob, pluginOwnership } from "./plugin-ownership"
import {
  handlePluginPagesStatus,
  mintPageFrameToken,
  proxyPluginPage,
  proxyPluginPageFrame,
  sanitizePluginRest,
  sanitizeTabContextId,
  schedulePluginPageRestart,
  uiBuildId,
  withFrameQuery,
} from "./plugin-pages"
import { handlePluginWebhook } from "./plugin-webhooks"
import { handlePlugins, instancePublicOrigin } from "./plugins"
import {
  pluginVaultKeys,
  resyncPluginsForLanguage,
  resyncPluginsForVaultSlug,
} from "./plugins-apply"
import { mintPreviewToken, proxyPreview, readPreviewPort } from "./preview"
import {
  desktopProcesses,
  killDesktopProcess,
  PROCESS_ID_PATTERN,
} from "./processes"
import {
  isProjectManageRequest,
  opencodeFileUrl,
  projectCategory,
  projectDir,
  projectName,
  projectSubpath,
  resolveCustomProjectPath,
  slugifyName,
} from "./projects"
import { prepareDashboardPrompt } from "./prompt-send"
import {
  desktopReports,
  isReportStatus,
  setReportStatus,
  summarizeByPlugin,
} from "./reports"
import { startReset } from "./reset"
import { ResetApprovals } from "./reset-approvals"
import {
  handleSandbox,
  handleSandboxProfiles,
  isSandboxProfilesRequest,
  isSandboxRequest,
  listSandboxThreads,
  SANDBOX_BROKER_PROVIDER,
  sandboxDaemon,
  touchSandbox,
} from "./sandbox"
import {
  ensureThreadScreen,
  resolveRootSession,
  screenHeld,
  setScreenHold,
} from "./screens"
import { sh } from "./shell"
import { handleSkills, isSkillsRequest } from "./skills-routes"
import { hardwareStats } from "./stats"
import {
  system1EndpointError,
  system1FieldError,
  system1ProviderById,
  system1ProviderPublic,
  system1Providers,
} from "./system1"
import {
  effectiveUserKey,
  getTeamConfig,
  objectHasAnyField,
  resolveQuota,
  teamMode,
  teamWriteLocked,
} from "./team"
import { refreshTeamOpencodeAuth } from "./team-apply"
import { handleThreadDirs } from "./thread-dirs"
import { handleThreadQueue, isThreadQueuePath } from "./thread-queue"
import { splitThread } from "./thread-split"
import {
  cleanupDeletedThread,
  handleOpencodeRead,
  handleThreads,
  isOpencodeReadRequest,
  isThreadRequest,
  type RecentThreadSummary,
  recentRowFromSession,
  visibleRecentThreads,
} from "./threads"
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
  embedCatalogById,
  isVikingEmbedProviderId,
  vikingEmbedCatalogPublic,
} from "./viking-embedding-catalog"
import { probeVikingHealth, type VikingHealth } from "./viking-health"
import { supportedVlmProviderIds } from "./viking-models"
import { createVikingSkills } from "./viking-skills"
import { vikingUserKey } from "./viking-user"
import {
  applyVoicePatch,
  canonicalVoiceProviderId,
  defaultVoiceFor,
  normalizeVoiceModel,
  parseSttConfig,
  parseTtsConfig,
  resolveVoiceConfig,
  runStt,
  runTts,
  STT_MAX_BYTES,
  ttsMaxChars,
  voiceConfigError,
  voiceProviderById,
  voiceProvidersPublic,
  voiceReady,
  voiceSharedFieldsPresent,
  voiceVaultSlug,
} from "./voice-providers"
import {
  applyWatchdogPatch,
  findingPublic,
  ingestFinding,
  resolveWatchdogConfig,
  watchdogConfigError,
  watchdogContainerPayload,
  watchdogProviderById,
  watchdogProviderPublic,
  watchdogSharedFieldsPresent,
} from "./watchdog"
import { agentFilePath, workspaceFileResponse } from "./workspace-file"
import { workspaceImagePath, workspaceImageResponse } from "./workspace-image"
import {
  workspaceModel3dPath,
  workspaceModel3dResponse,
} from "./workspace-model3d"
import { MEDIA_DIR, snapshotUrlFor } from "./workspace-snapshots"
import { workspaceVideoPath, workspaceVideoResponse } from "./workspace-video"

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
  // Set when this login drives a CLI subscription binary (claude/muse)
  // instead of `opencode auth login`.
  cli?: CliId
  method?: string
  started: boolean
  done: boolean
  cancelled: boolean
  code: number | null
  proc: ReturnType<typeof spawnLogin> | null
  scanner: ReturnType<typeof createLoginUrlScanner>
  urls: string[]
  urlFlush: ReturnType<typeof setTimeout> | null
  sockets: Set<Bun.ServerWebSocket<SocketData>>
  expire: ReturnType<typeof setTimeout> | null
  db?: Db
  hub?: EventHub
}

const logins = new Map<string, LoginSession>()

const approvals = new ResetApprovals()
setInterval(() => approvals.sweep(), 60_000).unref?.()

const MAX_PROJECT_FILE_CHARS = 4 * 1024 * 1024

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers })
}

function publicProviderAuth(auth: unknown) {
  if (!auth || typeof auth !== "object") return {}
  const out: Record<string, { type?: string; label?: string }[]> = {}
  for (const [id, methods] of Object.entries(auth as Record<string, unknown>)) {
    if (!Array.isArray(methods)) continue
    out[id] = methods.flatMap((method) => {
      if (!method || typeof method !== "object") return []
      const row = method as Record<string, unknown>
      return [
        {
          ...(typeof row.type === "string" ? { type: row.type } : {}),
          ...(typeof row.label === "string" ? { label: row.label } : {}),
        },
      ]
    })
  }
  return out
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

// Why a session cookie failed to resolve to a user — surfaced on the 401 so
// the dashboard can say something actionable ("cookie not sent — insecure
// context or blocked cookies") instead of a bare "unauthorized".
function sessionAuthError(req: Request, db: Db): string {
  const token = readCookie(req)
  if (!token) return "no_cookie"
  const session = db.sessionByHash(sha256(token))
  if (!session) return "invalid_session"
  if (session.expiresAt < Date.now()) return "expired_session"
  return "invalid_user"
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

const JSON_BODY_MAX = 1_000_000

async function readJson(req: Request) {
  const length = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(length) && length > JSON_BODY_MAX) {
    throw new HttpError(413, "request body too large", "body_too_large")
  }
  const text = await req.text()
  if (text.length > JSON_BODY_MAX) {
    throw new HttpError(413, "request body too large", "body_too_large")
  }
  if (!text) return {}
  return JSON.parse(text) as Record<string, unknown>
}

// Team mode GETs report key state from the resolved (overlay-authoritative)
// value; personal mode keeps the raw saved row.
function hasKey(shared: boolean, saved: string, resolved: string): boolean {
  return shared ? resolved !== "" : saved !== ""
}

const loginHits = new Map<string, number[]>()
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_WINDOW_MAX = 8

function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  )
}

function loginKey(req: Request, email: string) {
  return `${clientIp(req)}\0${email}`
}

function recentLoginHits(key: string) {
  const now = Date.now()
  const recent = (loginHits.get(key) ?? []).filter(
    (at) => now - at < LOGIN_WINDOW_MS,
  )
  loginHits.set(key, recent)
  return recent
}

function loginLimited(req: Request, email: string) {
  return recentLoginHits(loginKey(req, email)).length >= LOGIN_WINDOW_MAX
}

function noteLoginFailure(req: Request, email: string) {
  const key = loginKey(req, email)
  const recent = recentLoginHits(key)
  recent.push(Date.now())
  loginHits.set(key, recent)
}

function passwordChangeBlocked(
  user: { mustChangePassword: boolean },
  pathname: string,
) {
  if (!user.mustChangePassword) return false
  return (
    pathname !== "/api/me" &&
    pathname !== "/api/auth/credentials" &&
    pathname !== "/api/auth/logout"
  )
}

// Give up if the desktop does not return response headers within this budget;
// the body stream itself is unbounded once headers arrive.
const PROXY_HEADERS_TIMEOUT = 10_000

// Bun fetch connect failures. Only these are safe to retry: the request never
// reached the desktop, so redelivery cannot duplicate work. "socket connection
// was closed" is deliberately excluded — the request may have been delivered.
const PROXY_CONNECT_ERROR =
  /unable to connect|typo in the url|econnrefused|connection refused|fetch failed/i

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
  // A consumed request body stream cannot be reused, so only retry when the
  // body is an in-memory string we can send again or there is no body at all.
  const retryable =
    body !== undefined || req.method === "GET" || req.method === "HEAD"
  const send = () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), PROXY_HEADERS_TIMEOUT)
    return fetch(dest, {
      method: req.method,
      headers,
      signal: abort.signal,
      body:
        body !== undefined
          ? body
          : req.method === "GET" || req.method === "HEAD"
            ? undefined
            : req.body,
      duplex: body !== undefined ? undefined : "half",
    } as RequestInit).finally(() => clearTimeout(timer))
  }
  let upstream: Response
  try {
    upstream = await send()
  } catch (error) {
    if (
      !retryable ||
      !(error instanceof Error) ||
      !PROXY_CONNECT_ERROR.test(error.message)
    ) {
      throw error
    }
    await Bun.sleep(300)
    upstream = await send()
  }
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
  user: User,
) {
  const userId = user.id
  const parsed = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  const personaId =
    typeof raw.personaId === "string" ? raw.personaId.trim() : ""
  if (personaId && !resolvePersona(db, userId, personaId))
    return json({ error: "unknown personality" }, 400)
  let dirId: string | null = null
  if (raw.dirId != null) {
    if (typeof raw.dirId !== "string")
      return json({ error: "dirId must be a string" }, 400)
    if (!db.threadDirById(raw.dirId, userId))
      return json({ error: "unknown folder" }, 400)
    dirId = raw.dirId
  }
  // steps:"unlimited" binds the new session to the no-step-cap agent variant
  // (same contract as POST /api/threads); a raw agent field is not accepted —
  // the web speaks the steps semantic, the control plane owns the mapping.
  if (raw.steps !== undefined && raw.steps !== "unlimited")
    return json({ error: 'steps must be "unlimited" or omitted' }, 400)
  // The blank composer's model/effort pick becomes this new thread's own
  // pick (never the desktop default). A team-locked or provably invalid
  // pick is dropped, never blocks creation — the client re-reads the
  // thread's effective model before its first prompt.
  let threadPick: ThreadModelChoice | null = null
  if (raw.model !== undefined || raw.thinkingEffort !== undefined) {
    let providerID: string | null = null
    let modelID: string | null = null
    if (raw.model !== undefined && raw.model !== null) {
      const model = raw.model
      if (typeof model !== "object" || Array.isArray(model))
        return json({ error: "invalid model" }, 400)
      const record = model as Record<string, unknown>
      providerID =
        typeof record.providerID === "string" ? record.providerID : ""
      modelID = typeof record.modelID === "string" ? record.modelID : ""
      if (!providerID || !modelID) return json({ error: "invalid model" }, 400)
    }
    const rawEffort = raw.thinkingEffort
    if (
      rawEffort !== undefined &&
      rawEffort !== null &&
      typeof rawEffort !== "string"
    )
      return json({ error: "invalid thinking effort" }, 400)
    const effort =
      typeof rawEffort === "string" && rawEffort.trim() !== ""
        ? rawEffort.trim()
        : null
    if (effort && effort.length > 32)
      return json({ error: "invalid thinking effort" }, 400)
    if (providerID || effort) threadPick = { providerID, modelID, effort }
    const team = getTeamConfig(db)
    if (
      threadPick &&
      team.mode === "team" &&
      team.lockModelPicker &&
      user.role !== "admin"
    )
      threadPick = null
    if (threadPick && (await validateModelChoice(db, userId, threadPick)))
      threadPick = null
  }
  const rest = { ...raw }
  delete rest.personaId
  delete rest.dirId
  delete rest.agent
  delete rest.model
  delete rest.thinkingEffort
  if (raw.steps === "unlimited") rest.agent = UNLIMITED_STEPS_AGENT
  // Persona skill scopes ride the session-create body as opencode permission
  // rules — one write, no restart, persisted in opencode.db. Built-in
  // personas apply like any other persona (the Assistant contributes only
  // MCP rules — its skills are locked to all).
  if (personaId) {
    const ruleset = await personaScope(
      db,
      userId,
      resolvePersona(db, userId, personaId),
    )
    if (ruleset && ruleset.length > 0) rest.permission = ruleset
  }
  const headers = new Headers(auth)
  headers.set("content-type", "application/json")
  const upstream = await fetch(new URL("/session", base), {
    method: "POST",
    headers,
    body: JSON.stringify(rest),
  })
  const text = await upstream.text()
  if (upstream.ok && dirId) {
    try {
      const created = JSON.parse(text) as { id?: string }
      if (created.id) db.setThreadDir(userId, created.id, dirId)
    } catch {
      // return the upstream body even if the folder cannot be stored
    }
  }
  if (upstream.ok && personaId) {
    try {
      const created = JSON.parse(text) as { id?: string }
      if (created.id) db.setThreadPersona(userId, created.id, personaId)
    } catch {
      // return the upstream body even if the id cannot be stored
    }
  }
  if (upstream.ok && threadPick) {
    try {
      const created = JSON.parse(text) as { id?: string }
      if (created.id)
        db.setThreadModel({
          userId,
          sessionId: created.id,
          providerId: threadPick.providerID,
          modelId: threadPick.modelID,
          effort: threadPick.effort,
        })
    } catch {
      // return the upstream body even if the pick cannot be stored
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
  hub?: EventHub,
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
  const watchdog = resolveWatchdogConfig(db, user.id)
  const watchdogSpec = watchdogProviderById(watchdog.value.provider)
  if (watchdogSpec && watchdogSpec.vaultSlug === changed.slug) {
    try {
      // Full payload even when the vault emptied: the toggles must survive.
      applied.watchdog = await syncWatchdogConfig(
        user.id,
        watchdogContainerPayload(watchdog.value),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing watchdog setup")) {
        applied.watchdogError = message
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
        if (chat.applied) await restartOpencode(user.id, { db, desktop, hub })
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (!message.includes("missing chat setup")) {
          applied.chatError = message
        }
      }
    }
  }
  const failedVaultResync = await resyncPluginsForVaultSlug(
    db,
    user,
    changed.slug,
  )
  if (failedVaultResync.length > 0) {
    applied.pluginVaultResync = failedVaultResync
  }
  return applied
}

// Plugin-declared vault keys that are not shared provider slugs, rendered as
// Keys-tab catalog entries so every key on the account is managed in one place.
function pluginKeyBySlug(db: Db, userId: string, slug: string) {
  return pluginVaultKeys(db.installedPlugins(userId)).find(
    (key) => key.slug === slug,
  )
}

function pluginKeyCatalog(db: Db, userId: string) {
  return pluginVaultKeys(db.installedPlugins(userId)).map((key) => ({
    id: key.slug,
    label: key.slug,
    description: `API key declared by the ${key.pluginNames.join(", ")} plugin${
      key.pluginNames.length > 1 ? "s" : ""
    }${key.enabled ? "" : " (plugin disabled — the key is kept)"}.`,
    chatProvider: false,
    fields: [
      {
        id: "apiKey",
        label: "API key",
        placeholder: `${key.slug} API key`,
        required: true,
        secret: true,
      },
      {
        id: "accountId",
        label: "Account ID",
        placeholder: "Account ID (optional)",
        required: false,
      },
      {
        id: "baseUrl",
        label: "Base URL",
        placeholder: "Base URL (optional)",
        required: false,
      },
    ],
    usedBy: key.pluginNames.map((name) => `Plugin · ${name}`),
    plugin: true,
    pluginIds: key.pluginIds,
    access: key.access,
    enabled: key.enabled,
  }))
}

// Team mode overlays the chat model: a locked picker forces the team
// {provider, model} on non-admins; otherwise the personal selection wins
// once set and the team value is only the default.
function effectiveSelection(db: Db, user: User) {
  const desktop = db.desktop(user.id)
  const team = getTeamConfig(db)
  const overlay = team.mode === "team" ? team.providers.chat : undefined
  const locked =
    team.mode === "team" && team.lockModelPicker && user.role !== "admin"
  return {
    provider: locked
      ? (overlay?.provider ?? desktop?.selectedProvider ?? null)
      : (desktop?.selectedProvider ?? overlay?.provider ?? null),
    model: locked
      ? (overlay?.model ?? desktop?.selectedModel ?? null)
      : (desktop?.selectedModel ?? overlay?.model ?? null),
  }
}

/**
 * Effective model + effort for one dashboard thread, plus the explicit
 * per-thread pick (`thread`, null halves = desktop default). The team
 * lock wins over any stored pick, mirroring /api/me.
 */
function threadModelPayload(db: Db, user: User, sessionId: string) {
  const desktop = db.desktop(user.id)
  const selection = effectiveSelection(db, user)
  const team = getTeamConfig(db)
  const locked =
    team.mode === "team" && team.lockModelPicker && user.role !== "admin"
  const resolved = resolveThreadModel(
    locked ? null : db.threadModel(user.id, sessionId),
    {
      providerID: selection.provider,
      modelID: selection.model,
      thinkingEffort: desktop?.thinkingEffort ?? null,
    },
  )
  return {
    model: {
      providerID: resolved.providerID,
      modelID: resolved.modelID,
      thinkingEffort: resolved.thinkingEffort,
    },
    thread: resolved.thread
      ? {
          providerID: resolved.thread.providerID,
          modelID: resolved.thread.modelID,
          thinkingEffort: resolved.thread.effort,
        }
      : null,
  }
}

/** Optional `sessionId` on a model/thinking PUT body; "" = desktop-wide. */
function bodySessionId(body: Record<string, unknown>): string | null {
  const raw = body.sessionId
  if (raw === undefined || raw === null || raw === "") return ""
  if (typeof raw !== "string") return null
  return raw.trim()
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
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

const STATIC_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
}

function staticPathOk(file: string) {
  const root = webDist.endsWith(sep) ? webDist : `${webDist}${sep}`
  return file === webDist || file.startsWith(root)
}

async function staticFile(pathname: string) {
  const rel = pathname === "/" ? "/index.html" : pathname
  const file = normalize(join(webDist, rel))
  if (!staticPathOk(file)) return new Response("bad path", { status: 400 })
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error("missing")
    const ext = file.slice(file.lastIndexOf("."))
    return new Response(createReadStream(file) as unknown as BodyInit, {
      headers: {
        ...STATIC_HEADERS,
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
          ...STATIC_HEADERS,
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
    maxRequestBodySize: 26_000_000,
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
        if (url.pathname.startsWith("/api/preview/frame/"))
          return await proxyPreview(req, url, server)
        if (url.pathname.startsWith("/hooks/")) {
          // Public plugin endpoint: delivery may block on a cold desktop
          // wake; no idle timeout, the handler enforces its own upstream
          // deadline (headers only — streams run after).
          server.timeout(req, 0)
          return (
            (await handlePluginWebhook(req, url, db, server)) ??
            new Response("not found", { status: 404 })
          )
        }
        if (url.pathname.startsWith("/api/pages/_frame/")) {
          server.timeout(req, 0)
          return (
            (await proxyPluginPageFrame(req, url, db, hub, server)) ??
            new Response("not found", { status: 404 })
          )
        }
        if (url.pathname === "/api/pages/frame" && req.method === "POST") {
          return await api(req, url, db, hub, () => server.timeout(req, 0))
        }
        if (url.pathname.startsWith("/api/pages/")) {
          // Plugin pages proxy long-lived responses (SSE); no idle timeout.
          server.timeout(req, 0)
          const pageUser = userFrom(req, db)
          if (!pageUser) return json({ error: "unauthorized" }, 401)
          return (
            (await proxyPluginPage(req, url, db, pageUser, hub, server)) ??
            new Response("not found", { status: 404 })
          )
        }
        if (url.pathname === "/api/pages") {
          const pageUser = userFrom(req, db)
          if (!pageUser) return json({ error: "unauthorized" }, 401)
          return await handlePluginPagesStatus(db, pageUser)
        }
        if (url.pathname === "/api/build") return json({ build: uiBuildId() })
        if (url.pathname.startsWith("/api/"))
          return await api(req, url, db, hub, () => server.timeout(req, 0))
        if (url.pathname.startsWith("/desktop/"))
          return await desktopProxy(req, url, server, db)
        // A browser landing on the internal http origin would get a login
        // form whose Secure session cookie can never stick (#105): send
        // page loads to the canonical https origin before any form shows.
        if (cookieSecure) {
          const target = insecureRedirect(
            {
              method: req.method,
              pathname: url.pathname,
              search: url.search,
              proto: requestProto(req, url, db),
            },
            instancePublicOrigin(db),
          )
          if (target) return Response.redirect(target, 302)
        }
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

async function existingProjectDir(userId: string, customPath: string) {
  const resolved = await opencodeExec(userId, [
    "sh",
    "-c",
    'p=$(realpath -e -- "$1") && test -d "$p" && printf %s "$p"',
    "ob-project",
    customPath,
  ])
  if (resolved.code !== 0) return { error: "folder does not exist" }
  const canonical = resolveCustomProjectPath(resolved.stdout.trim())
  if (!canonical) return { error: "the folder must be under /home/agent" }
  return { path: canonical }
}

async function handleProjectManage(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
): Promise<Response | null> {
  if (url.pathname === "/api/projects" && req.method === "GET") {
    return json({
      projects: db.projects(user.id).map(({ id, name, path, createdAt }) => ({
        id,
        name,
        path,
        category: projectCategory(path),
        createdAt,
      })),
    })
  }
  if (url.pathname === "/api/projects" && req.method === "POST") {
    const body = await readJson(req)
    let name = projectName(body.name)
    const requested = resolveCustomProjectPath(body.path)
    if (!requested && body.path !== undefined && body.path !== "")
      return json({ error: "the folder must be under /home/agent" }, 400)
    if (!name && !requested)
      return json({ error: "a project name is required" }, 400)
    await ensure(user, db)
    let path = requested
    if (requested) {
      const existing = await existingProjectDir(user.id, requested)
      if ("error" in existing) return json({ error: existing.error }, 400)
      path = existing.path
    }
    if (!name && path) name = projectName(path.split("/").pop())
    if (!name) return json({ error: "a project name is required" }, 400)
    const slug = slugifyName(name)
    if (!slug) return json({ error: "a project name is required" }, 400)
    if (db.projectByName(user.id, name))
      return json({ error: "a project with this name already exists" }, 409)
    const folder = path ?? projectDir(slug)
    if (
      db
        .projects(user.id)
        .some((project) => project.path.replace(/\/+$/g, "") === folder)
    )
      return json({ error: "this folder is already a project" }, 409)
    if (!requested) {
      const made = await opencodeExec(user.id, ["mkdir", "-p", "--", folder])
      if (made.code !== 0)
        return json({ error: "could not create the project directory" }, 502)
    }
    const project = {
      id: crypto.randomUUID(),
      userId: user.id,
      name,
      path: folder,
      createdAt: Date.now(),
    }
    db.createProject(project)
    hub.emit(user.id, { type: "projects.changed" })
    return json({
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        category: projectCategory(project.path),
        createdAt: project.createdAt,
      },
    })
  }
  const projectIdMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
  if (projectIdMatch && req.method === "DELETE") {
    const id = decodeURIComponent(projectIdMatch[1] ?? "")
    if (!db.deleteProject(id, user.id)) return json({ error: "not found" }, 404)
    hub.emit(user.id, { type: "projects.changed" })
    return json({ ok: true })
  }
  if (projectIdMatch && req.method === "PATCH") {
    // Rename in place (#95): the id — and every reference to it — survives;
    // only the display name changes. The folder on disk never moves.
    const id = decodeURIComponent(projectIdMatch[1] ?? "")
    const body = await readJson(req)
    const name = projectName(body.name)
    if (!name) return json({ error: "a project name is required" }, 400)
    const existing = db.projectById(id, user.id)
    if (!existing) return json({ error: "not found" }, 404)
    const clash = db.projectByName(user.id, name)
    if (clash && clash.id !== id)
      return json({ error: "a project with this name already exists" }, 409)
    db.renameProject(id, user.id, name)
    hub.emit(user.id, { type: "projects.changed" })
    return json({
      project: {
        id,
        name,
        path: existing.path,
        category: projectCategory(existing.path),
        createdAt: existing.createdAt,
      },
    })
  }
  return null
}

async function api(
  req: Request,
  url: URL,
  db: Db,
  hub: EventHub,
  holdOpen?: () => void,
) {
  if (url.pathname === "/api/health") return json({ ok: true })
  if (url.pathname === "/api/auth/config" && req.method === "GET") {
    // Public pre-login facts so the login screen can refuse credential
    // entry on an origin where the Secure session cookie cannot stick,
    // instead of failing after submit (#105).
    const canonicalOrigin = instancePublicOrigin(db)
    return json({
      cookieSecure,
      secureOrigin: !cookieSecure || requestProto(req, url, db) === "https",
      canonicalOrigin: canonicalOrigin || null,
    })
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req)
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase()
    const password = String(body.password ?? "")
    if (loginLimited(req, email)) {
      return json({ error: "too many login attempts" }, 429)
    }
    const user = db.userByEmail(email)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      noteLoginFailure(req, email)
      return json({ error: "invalid login" }, 401)
    }
    if (user.disabled) return json({ error: "account disabled" }, 403)
    return sessionResponse(req, url, db, user)
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
    return sessionResponse(req, url, db, user)
  }
  if (url.pathname === "/api/improvements") {
    const agent = userFromLlmToken(req, db)
    if (!agent) return json({ error: "unauthorized" }, 401)
    return handleImprovementPost(req, db, agent)
  }
  if (url.pathname === "/api/watchdog" && req.method === "POST") {
    const agent = userFromLlmToken(req, db)
    if (!agent) return json({ error: "unauthorized" }, 401)
    const config = db.getWatchdogConfig(agent.id)
    if (!config.enabled) return json({ ok: true, ignored: true })
    const body = (await readJson(req)) as Record<string, unknown>
    const result = await ingestFinding(db, hub, agent.id, body)
    if (!result) return json({ error: "invalid finding" }, 400)
    return json({
      ok: true,
      duplicate: result.duplicate,
      action: result.action,
      stopped: result.stopped,
    })
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
      if (passwordChangeBlocked(agent, url.pathname)) {
        return json({ error: "password change required" }, 403)
      }
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
  const isThreadDirsPath =
    url.pathname === "/api/thread-dirs" ||
    url.pathname.startsWith("/api/thread-dirs/")
  const isCatalogDirsPath = url.pathname.startsWith("/api/catalog/dirs")
  const isSkillsPath = isSkillsRequest(url.pathname)
  const isCouncilsPath = isCouncilPath(url.pathname)
  const isDelegations = isDelegationsPath(url.pathname)
  const isPluginPath =
    url.pathname === "/api/plugins" || url.pathname.startsWith("/api/plugins/")
  const isProjectManage = isProjectManageRequest(url.pathname, req.method)
  const isMedia = isMediaRequest(url.pathname, req.method)
  const isThreadPath = isThreadRequest(url.pathname, req.method)
  const isKeysPath = isKeysRequest(url.pathname, req.method)
  const isOpencodeRead = isOpencodeReadRequest(url.pathname, req.method)
  // The agent token may list sandbox profiles (to launch with one) and
  // export a sandbox workspace to the desktop (the coordinator retrieving
  // results). Creating/widening profiles stays cookie-only below.
  const isSandboxAgentPath =
    (isSandboxProfilesRequest(url.pathname) && req.method === "GET") ||
    (req.method === "POST" &&
      /^\/api\/sandbox\/[^/]+\/export-to-desktop$/.test(url.pathname))
  if (
    isCronPath ||
    isPersonaPath ||
    isThreadDirsPath ||
    isCatalogDirsPath ||
    isSkillsPath ||
    isCouncilsPath ||
    isDelegations ||
    isPluginPath ||
    isProjectManage ||
    isMedia ||
    isThreadPath ||
    isKeysPath ||
    isOpencodeRead ||
    isSandboxAgentPath
  ) {
    const agent = userFromLlmToken(req, db)
    if (agent) {
      if (passwordChangeBlocked(agent, url.pathname)) {
        return json({ error: "password change required" }, 403)
      }
      if (isSandboxAgentPath) {
        if (isSandboxProfilesRequest(url.pathname))
          return handleSandboxProfiles(req, url, db, agent)
        return handleSandbox(req, url, db, agent, hub)
      }
      if (isMedia) {
        const handled = await handleMedia(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isProjectManage) {
        const handled = await handleProjectManage(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isPersonaPath) {
        const handled = handlePersonas(req, url, db, agent)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isThreadDirsPath) {
        const handled = handleThreadDirs(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isCatalogDirsPath) {
        const handled = handleCatalogDirs(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isSkillsPath) {
        const handled = await handleSkills(req, url, db, agent, hub, () =>
          skillsClient(agent, db),
        )
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isCouncilsPath) {
        const handled = handleCouncils(req, url, db, agent, hub)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isDelegations) {
        const handled = handleDelegations(req, url, db, agent)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isPluginPath) {
        const handled = handlePlugins(req, url, db, agent, hub, holdOpen, true)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
      if (isCronPath) return handleCron(req, url, db, agent, hub, holdOpen)
      if (isThreadPath) return handleThreads(req, url, db, agent, hub)
      if (isOpencodeRead) return handleOpencodeRead(req, url, db, agent)
      if (isKeysPath) {
        const handled = handleKeys(url, db, agent)
        if (handled) return handled
        return json({ error: "not found" }, 404)
      }
    }
  }
  const user = userFrom(req, db)
  if (!user)
    return json(
      { error: "unauthorized", reason: sessionAuthError(req, db) },
      401,
    )
  if (passwordChangeBlocked(user, url.pathname)) {
    return json({ error: "password change required" }, 403)
  }
  // Sandbox profiles are capability grants: cookie-only, never the
  // agent's LLM token (which may launch with a profile, not widen one).
  if (isSandboxProfilesRequest(url.pathname))
    return handleSandboxProfiles(req, url, db, user)
  if (url.pathname === "/api/sandbox-threads" && req.method === "GET")
    return listSandboxThreads(db, user)
  if (isSandboxRequest(url.pathname))
    return handleSandbox(req, url, db, user, hub)
  if (isThreadPath && req.method === "POST")
    return handleThreads(req, url, db, user, hub)
  if (isMedia) {
    const handled = await handleMedia(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isPersonaPath) {
    const handled = handlePersonas(req, url, db, user)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isThreadDirsPath) {
    const handled = handleThreadDirs(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isThreadQueuePath(url.pathname)) {
    const handled = await handleThreadQueue(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isCatalogDirsPath) {
    const handled = handleCatalogDirs(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  // Passive home/search summary: titled threads from the control-plane DB.
  // Deliberately NO ensure/start — a sleeping desktop stays asleep. Titles
  // arrive as the agent (or the user) names threads, so this is a summary of
  // named conversations, not the full live list. The wider fetch lets the
  // hidden-title filter run BEFORE the visible cap, so worker:/cron-run:
  // noise never shrinks the user-visible list.
  if (url.pathname === "/api/threads/recent" && req.method === "GET") {
    const titled = visibleRecentThreads(db.recentThreadTitles(user.id, 40))
    // Coverage upgrade, strictly passive: when the desktop already runs, the
    // real session list is one local read (never a wake, never an ensure) —
    // an empty control-plane name index then stops masquerading as "no
    // conversations" for accounts whose history predates the index. Asleep
    // or unreachable, the titled rows stand alone and the payload says so
    // ("titles"): the client must treat an empty titled list as "unknown",
    // not "empty history".
    try {
      const phase = await desktopPhase(user.id)
      if (phase === "running") {
        const desktopRow = db.desktop(user.id)
        if (desktopRow) {
          const base = await endpoint(user.id, "opencode", 4096)
          const res = await fetch(new URL("/session", base), {
            headers: basic(desktopRow.opencodePassword),
            signal: AbortSignal.timeout(5000),
          })
          if (res.ok) {
            const body: unknown = await res.json()
            if (Array.isArray(body)) {
              const rows = body
                .map(recentRowFromSession)
                .filter((row): row is RecentThreadSummary => row !== null)
                .sort((a, b) => b.createdAt - a.createdAt)
              return json({ threads: rows.slice(0, 5), coverage: "full" })
            }
          }
        }
      }
    } catch {
      // fall through to the titled index — a passive read never errors
    }
    return json({ threads: titled, coverage: "titles" })
  }
  if (isCouncilsPath) {
    const handled = handleCouncils(req, url, db, user, hub)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isDelegations) {
    const handled = handleDelegations(req, url, db, user)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isPluginPath) {
    const handled = handlePlugins(req, url, db, user, hub, holdOpen, false)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (url.pathname === "/api/mcp" || url.pathname.startsWith("/api/mcp/")) {
    const handled = await handleMcp(req, url, db, user, hub, ensure)
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (isCronPath) return handleCron(req, url, db, user, hub, holdOpen)
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
    const selection = effectiveSelection(db, user)
    return json({
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      language: instanceLanguage(db),
      agentStepCap: desktop?.agentStepCap ?? null,
      agentStepCapDefault: DEFAULT_AGENT_STEP_CAP,
      desktop: phase,
      model: desktop
        ? {
            providerID: selection.provider ?? desktop.selectedProvider,
            modelID: selection.model ?? desktop.selectedModel,
            thinkingEffort: desktop.thinkingEffort,
          }
        : null,
    })
  }
  if (url.pathname === "/api/quota" && req.method === "GET") {
    return json(resolveQuota(db, user.id, Date.now()))
  }
  if (url.pathname.startsWith("/api/admin/")) {
    return handleAdmin(req, url, db, user, hub)
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
    // Wait out an in-flight start first so sleep can never race the containers
    // a start is still creating or health-checking.
    const inflight = currentStart(user.id)
    if (inflight) await inflight.catch(() => {})
    await stopDesktop(user.id)
    return json({ phase: "sleeping" })
  }
  if (url.pathname === "/api/preview/frame" && req.method === "POST") {
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      String(body.sessionId ?? ""),
    )
    const port = await readPreviewPort(user.id, root)
    if (port === null) return json({ error: "preview is not running" }, 404)
    const minted = mintPreviewToken(user.id, root)
    return json({ frameUrl: minted.frameUrl, expiresAt: minted.expiresAt })
  }
  if (url.pathname === "/api/pages/frame" && req.method === "POST") {
    const body = await readJson(req)
    const pluginId = String(body.pluginId ?? "").trim()
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) {
      return json({ error: "bad plugin id" }, 400)
    }
    const rest = sanitizePluginRest(String(body.path ?? "/"))
    if (!rest) return json({ error: "bad plugin path" }, 400)
    const row = db.installedPlugin(user.id, pluginId)
    const manifest = row?.manifest as
      | { dashboard?: { pages?: unknown } }
      | undefined
    if (!row || !row.enabled || !manifest?.dashboard?.pages) {
      return json({ error: "plugin page not found" }, 404)
    }
    const minted = mintPageFrameToken(user.id, pluginId, rest)
    // The frame URL carries the host-wide language (and, when the shell
    // sends one, the stable per-tab `obtab` context id — #27): the framed
    // document request forwards them to the plugin server (same query
    // pass-through as every proxied request) and the plugin's client JS
    // reads them from location.search — the x-open-bot-language header
    // covers the fetches. Never fail the mint over URL shaping.
    const frameUrl = withFrameQuery(
      minted.frameUrl,
      instanceLanguage(db),
      sanitizeTabContextId(body.tabContextId),
    )
    return json({
      frameUrl,
      contextId: minted.contextId,
      expiresAt: minted.expiresAt,
      isolated: minted.isolated,
    })
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
  if (url.pathname === "/api/desktop/apps" && req.method === "GET") {
    await ensure(user, db)
    const apps = await desktopAppCatalog(user.id)
    return json({ apps: apps.map(({ id, name }) => ({ id, name })) })
  }
  if (url.pathname === "/api/reports" && req.method === "GET") {
    await ensure(user, db)
    const status = url.searchParams.get("status") ?? "all"
    if (status !== "all" && !isReportStatus(status))
      return json({ error: "status must be open, done, wontfix, or all" }, 400)
    const plugin = url.searchParams.get("plugin") ?? ""
    const reports = await desktopReports(user.id, {
      status,
      plugin: plugin || undefined,
    })
    return json({ reports, plugins: summarizeByPlugin(reports) })
  }
  const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)$/)
  if (reportMatch && req.method === "PATCH") {
    const body = await readJson(req)
    const status = typeof body.status === "string" ? body.status : ""
    if (!isReportStatus(status))
      return json({ error: "status must be open, done, or wontfix" }, 400)
    let note: string | undefined
    if (body.note !== undefined) {
      if (typeof body.note !== "string")
        return json({ error: "note must be a string" }, 400)
      note = body.note
    }
    await ensure(user, db)
    await setReportStatus(
      user.id,
      decodeURIComponent(reportMatch[1] ?? ""),
      status,
      note,
    )
    hub.emit(user.id, { type: "reports.changed" })
    return json({ ok: true })
  }
  if (url.pathname === "/api/processes" && req.method === "GET") {
    await ensure(user, db)
    return json({ processes: await desktopProcesses(user.id) })
  }
  const processKillMatch = url.pathname.match(/^\/api\/processes\/([^/]+)$/)
  if (processKillMatch && req.method === "DELETE") {
    const processId = decodeURIComponent(processKillMatch[1] ?? "")
    if (!PROCESS_ID_PATTERN.test(processId))
      return json({ error: "bad process id" }, 400)
    await ensure(user, db)
    await killDesktopProcess(user.id, processId)
    hub.emit(user.id, { type: "processes.changed" })
    return json({ ok: true })
  }
  if (url.pathname === "/api/hardware" && req.method === "GET") {
    await ensure(user, db)
    return json(await hardwareStats(user.id, db))
  }
  if (url.pathname === "/api/desktop/apps/launch" && req.method === "POST") {
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const root = await resolveRootSession(
      base,
      basic(desktop.opencodePassword),
      String(body.sessionId ?? ""),
    )
    const screen = await ensureThreadScreen(db, user.id, root)
    const launch = await launchDesktopApp(
      user.id,
      root,
      String(body.appId ?? ""),
    )
    return json({ sessionId: screen.sessionId, ...launch })
  }
  if (url.pathname === "/api/keys" && req.method === "GET") {
    const team = getTeamConfig(db)
    const shared = team.mode === "team"
    const catalogSlugs = new Set<string>(
      keyVaultPublic().map((item) => item.id),
    )
    const entry = (key: {
      slug: string
      accountId: string
      gatewayId: string
      gatewaySlug: string
      baseUrl: string
      apiKey: string
      gatewayToken: string
      updatedAt: number
    }) => ({
      slug: key.slug,
      accountId: key.accountId,
      gatewayId: key.gatewayId,
      gatewaySlug: key.gatewaySlug,
      baseUrl: key.baseUrl,
      hasKey: key.apiKey !== "",
      hasGatewayToken: key.gatewayToken !== "",
      updatedAt: key.updatedAt,
    })
    const personal = db
      .getUserKeys(user.id)
      .filter((key) => !shared || !catalogSlugs.has(key.slug))
      .map(entry)
    const entries = shared
      ? [
          ...db
            .getTeamKeys()
            .filter((key) => catalogSlugs.has(key.slug))
            .map(entry),
          ...personal,
        ]
      : personal
    return json({
      catalog: [...keyVaultPublic(), ...pluginKeyCatalog(db, user.id)],
      entries,
      team: {
        mode: team.mode,
        lockModelPicker: team.lockModelPicker,
        lockWatchdog: team.lockWatchdog,
      },
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
    // Team mode locks only the shared provider slugs; plugin-declared vault
    // slugs stay per-user, so their owner can still manage them here.
    if (keysTeamLocked(db, slug)) {
      return json({ error: "team_locked" }, 403)
    }
    const spec = keyVaultSpecById(slug)
    const pluginKey = spec ? null : pluginKeyBySlug(db, user.id, slug)
    if (!spec && !pluginKey) return json({ error: "unknown key entry" }, 400)
    const current = db.getUserKey(user.id, slug)
    if (pluginKey) {
      // Plugin keys carry only apiKey/accountId/baseUrl (same field set as
      // the per-plugin vault route); gateway fields are shared-spec only.
      const pick = (name: "apiKey" | "accountId" | "baseUrl") =>
        String(body[name] ?? "").trim() || current?.[name] || ""
      const apiKey = pick("apiKey")
      if (apiKey.length > 4096) {
        return json({ error: "apiKey is too long" }, 400)
      }
      const fields: UserKeyFields = {
        apiKey,
        accountId: pick("accountId"),
        gatewayId: "",
        gatewayToken: "",
        gatewaySlug: "",
        baseUrl: pick("baseUrl"),
      }
      if (Object.values(fields).every((value) => value === "")) {
        return json({ error: "at least one field is required" }, 400)
      }
      db.setUserKey(user.id, slug, fields)
      const failedVaultResync = await resyncPluginsForVaultSlug(db, user, slug)
      const applied: Record<string, unknown> = {}
      if (failedVaultResync.length > 0) {
        applied.pluginVaultResync = failedVaultResync
      }
      return json({ ok: true, applied })
    }
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
    const applied = await applyVaultChange(
      user,
      db,
      {
        slug,
        key: fields.apiKey,
      },
      [],
      hub,
    )
    return json({ ok: true, applied })
  }
  if (url.pathname === "/api/keys" && req.method === "DELETE") {
    const slug = url.searchParams.get("slug") ?? ""
    // Same team rule as PUT: shared provider slugs are locked, plugin slugs
    // stay per-user.
    if (keysTeamLocked(db, slug)) {
      return json({ error: "team_locked" }, 403)
    }
    const spec = keyVaultSpecById(slug)
    const pluginKey = spec ? null : pluginKeyBySlug(db, user.id, slug)
    if (!spec && !pluginKey) return json({ error: "unknown key entry" }, 400)
    const current = db.getUserKey(user.id, slug)
    db.clearUserKey(user.id, slug)
    const revoke: ChatKeyEntry[] =
      spec?.chatProvider && current?.apiKey
        ? [{ slug, key: current.apiKey }]
        : []
    const applied = await applyVaultChange(
      user,
      db,
      { slug, key: "" },
      revoke,
      hub,
    )
    return json({ ok: true, applied })
  }
  if (url.pathname === "/api/viking/health" && req.method === "GET") {
    // Passive health read — never wakes a sleeping desktop. OpenViking is a
    // desktop sidecar, so an asleep desktop means the instance is down by
    // design and that is the honest answer.
    const phase = await desktopPhase(user.id)
    if (phase !== "running") {
      const body: VikingHealth = {
        status: phase === "starting" ? "starting" : "asleep",
        detail:
          phase === "starting"
            ? "the desktop is starting — OpenViking comes up with it"
            : "OpenViking sleeps with the desktop — start the desktop to bring it up",
        errors: [],
        components: [],
        checkedAt: Date.now(),
      }
      return json(body)
    }
    const desktop = db.desktop(user.id)
    if (!desktop) {
      return json({
        status: "asleep",
        detail: "no desktop exists for this user yet",
        errors: [],
        components: [],
        checkedAt: Date.now(),
      } satisfies VikingHealth)
    }
    try {
      const base = await endpoint(user.id, "viking", 1933)
      return json(await probeVikingHealth(base, desktop.vikingKey))
    } catch (error) {
      return json({
        status: "down",
        detail:
          error instanceof Error
            ? `the OpenViking container is unreachable: ${error.message}`
            : "the OpenViking container is unreachable",
        errors: [],
        components: [],
        checkedAt: Date.now(),
      } satisfies VikingHealth)
    }
  }
  if (url.pathname === "/api/viking" && req.method === "GET") {
    const saved = db.getVikingProvider(user.id)
    return json({
      baseURL: saved?.baseURL ?? "",
      hasKey: Boolean(saved?.apiKey),
      embedProvider: saved?.embedProvider ?? "",
      embedAccountId: saved?.embedAccountId ?? "",
      embedModel: saved?.embedModel ?? "",
      embedDimension: saved?.embedDimension || 1536,
      vlmModel: saved?.vlmModel ?? "",
      vlmSource: saved?.vlmSource ?? "custom",
      vlmProvider: saved?.vlmProvider ?? "",
      // OpenCode provider ids the VLM picker may offer; the models
      // themselves come from /api/models (the desktop's live setup).
      supportedVlmProviders: supportedVlmProviderIds(),
      embedProviders: vikingEmbedCatalogPublic(),
    })
  }
  if (url.pathname === "/api/viking" && req.method === "PUT") {
    const body = await readJson(req)
    const current = db.getVikingProvider(user.id)
    const typedKey = String(body.apiKey ?? "").trim()
    const vlmSource = body.vlmSource === "opencode" ? "opencode" : "custom"
    const vlmProvider = String(body.vlmProvider ?? "").trim()
    if (
      vlmSource === "opencode" &&
      !supportedVlmProviderIds().includes(vlmProvider)
    ) {
      return json(
        {
          error: `OpenViking cannot use the OpenCode provider "${vlmProvider || "(none)"}" for its VLM`,
        },
        400,
      )
    }
    const embedProvider = String(body.embedProvider ?? "").trim()
    if (!isVikingEmbedProviderId(embedProvider)) {
      return json(
        {
          error: `Unknown embedding provider "${embedProvider || "(none)"}"`,
        },
        400,
      )
    }
    const next: VikingProvider = {
      baseURL: String(body.baseURL ?? "").trim(),
      apiKey: typedKey || current?.apiKey || "",
      embedProvider,
      embedAccountId: String(body.embedAccountId ?? "").trim(),
      embedModel: String(body.embedModel ?? "").trim(),
      embedDimension: Number(body.embedDimension),
      vlmModel: String(body.vlmModel ?? "").trim(),
      vlmSource,
      vlmProvider: vlmSource === "opencode" ? vlmProvider : "",
    }
    // Typed boolean (not a narrowing alias): vikingProviderReady is a
    // type predicate, and an aliased negation would narrow the
    // already-typed `next` to never inside the error branch.
    const ready: boolean = vikingProviderReady(next)
    if (!ready) {
      const entry = embedCatalogById(embedProvider)
      const missing: string[] = []
      if (entry?.accountMode === "required" && !next.embedAccountId)
        missing.push("account id")
      if (entry?.keyMode === "required" && !next.apiKey) missing.push("API key")
      if (entry?.baseMode === "required" && !next.baseURL)
        missing.push("base URL")
      if (!next.embedModel) missing.push("embed model")
      if (!next.vlmModel)
        missing.push(
          vlmSource === "opencode" ? "VLM provider and model" : "VLM model",
        )
      return json(
        {
          error: `Missing for ${entry?.label ?? "this provider"}: ${missing.join(", ") || "check the form"}`,
        },
        400,
      )
    }
    db.setUserVikingProvider(user.id, next)
    // Best effort: if this save switches to a Codex subscription VLM on a
    // running desktop, push the current OpenCode tokens over now (the
    // provider choice itself still applies on the next desktop start).
    if (vlmSource === "opencode" && vlmProvider === "openai") {
      void syncVikingCodexAuth(user.id).catch(() => false)
    }
    return json({ ok: true })
  }
  if (url.pathname === "/api/image" && req.method === "GET") {
    const saved = db.getImageProvider(user.id)
    const selected =
      imageProviderById(saved?.provider ?? "") ?? imageProviders[0]
    const resolved = resolveImageProvider(db, user.id)
    return json({
      providers: imageProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      // When the vault fills the credentials, show its account id so the
      // locked field displays what is actually used (not a secret).
      accountId:
        resolved?.keySource === "vault"
          ? resolved.value.accountId
          : (saved?.accountId ?? ""),
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: hasKey(
        teamMode(db) === "team",
        saved?.apiKey ?? "",
        resolved?.value.apiKey ?? "",
      ),
      keySource: resolved?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/image" && req.method === "PUT") {
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
    const vault = effectiveUserKey(db, user.id, imageVaultSlug(spec.id))
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
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
  if (url.pathname === "/api/voice" && req.method === "GET") {
    const saved = db.getVoiceConfig(user.id)
    const sttSpec = voiceProviderById(saved.sttProvider)
    const ttsSpec = voiceProviderById(saved.ttsProvider)
    const resolved = resolveVoiceConfig(db, user.id)
    const shared = teamMode(db) === "team"
    // Saved rows may still carry the pre-consolidation Cloudflare provider
    // ids and the retired whisper model; the form only speaks canonical
    // ids and catalog models.
    const sttModel = sttSpec
      ? normalizeVoiceModel(sttSpec, saved.sttModel)
      : saved.sttModel
    const ttsModel = ttsSpec
      ? normalizeVoiceModel(ttsSpec, saved.ttsModel)
      : saved.ttsModel
    return json({
      providers: voiceProvidersPublic(),
      stt: {
        provider: canonicalVoiceProviderId(saved.sttProvider),
        // When the vault fills the credentials, show its account id so the
        // locked field displays what is actually used (account ids are not
        // secret; the key itself never leaves the server).
        accountId:
          resolved.sttSource === "vault"
            ? resolved.value.sttAccountId
            : saved.sttAccountId,
        model: sttModel,
        hasKey: hasKey(shared, saved.sttApiKey, resolved.value.sttApiKey),
        keySource: (shared ? resolved.value.sttProvider : saved.sttProvider)
          ? resolved.sttSource
          : null,
      },
      tts: {
        provider: canonicalVoiceProviderId(saved.ttsProvider),
        accountId:
          resolved.ttsSource === "vault"
            ? resolved.value.ttsAccountId
            : saved.ttsAccountId,
        model: ttsModel,
        voice:
          saved.ttsVoice || (ttsSpec ? defaultVoiceFor(ttsSpec, ttsModel) : ""),
        hasKey: hasKey(shared, saved.ttsApiKey, resolved.value.ttsApiKey),
        keySource: (shared ? resolved.value.ttsProvider : saved.ttsProvider)
          ? resolved.ttsSource
          : null,
      },
      language: saved.language,
    })
  }
  if (url.pathname === "/api/voice" && req.method === "PUT") {
    const body = (await readJson(req)) as Record<string, unknown>
    if (teamWriteLocked(db, user.role) && voiceSharedFieldsPresent(body)) {
      return json({ error: "team_locked" }, 403)
    }
    const { next, error } = applyVoicePatch(db.getVoiceConfig(user.id), body)
    if (error) return json({ error }, 400)
    const sttVault = effectiveUserKey(
      db,
      user.id,
      voiceVaultSlug(next.sttProvider),
    )
    const ttsVault = effectiveUserKey(
      db,
      user.id,
      voiceVaultSlug(next.ttsProvider),
    )
    const filled: VoiceConfig = {
      ...next,
      sttApiKey: next.sttApiKey || sttVault?.apiKey || "",
      sttAccountId: next.sttAccountId || sttVault?.accountId || "",
      ttsApiKey: next.ttsApiKey || ttsVault?.apiKey || "",
      ttsAccountId: next.ttsAccountId || ttsVault?.accountId || "",
    }
    if (
      (next.sttProvider && !voiceReady(filled, "stt")) ||
      (next.ttsProvider && !voiceReady(filled, "tts"))
    ) {
      return json(
        { error: "the fields required by this provider are missing" },
        400,
      )
    }
    const configError = voiceConfigError(next)
    if (configError) return json({ error: configError }, 400)
    db.setVoiceConfig(user.id, next)
    const resolved = resolveVoiceConfig(db, user.id)
    return json({
      sttKeySource: next.sttProvider ? resolved.sttSource : null,
      ttsKeySource: next.ttsProvider ? resolved.ttsSource : null,
      ok: true,
    })
  }
  if (url.pathname === "/api/voice" && req.method === "DELETE") {
    db.clearVoiceConfig(user.id)
    return json({ ok: true })
  }
  if (url.pathname === "/api/watchdog" && req.method === "GET") {
    const saved = db.getWatchdogConfig(user.id)
    const resolved = resolveWatchdogConfig(db, user.id)
    const spec = watchdogProviderById(saved.provider)
    const findings = db.watchdogFindings(user.id, { limit: 200 })
    const shared = teamMode(db) === "team"
    return json({
      providers: watchdogProviderPublic(),
      config: {
        enabled: saved.enabled,
        stopOnHigh: saved.stopOnHigh,
        provider: saved.provider,
        accountId:
          resolved.keySource === "vault"
            ? resolved.value.accountId
            : saved.accountId,
        model: saved.model || spec?.defaultModel || "",
        baseUrl: saved.baseUrl,
        hasKey: hasKey(shared, saved.apiKey, resolved.value.apiKey),
        keySource: (shared ? resolved.value.provider : saved.provider)
          ? resolved.keySource
          : null,
      },
      findings: findings.map(findingPublic),
      unread: findings.filter((row) => row.status === "new").length,
    })
  }
  if (url.pathname === "/api/watchdog/config" && req.method === "PUT") {
    const body = (await readJson(req)) as Record<string, unknown>
    if (teamWriteLocked(db, user.role)) {
      const toggles = objectHasAnyField(body, ["enabled", "stopOnHigh"])
      if (
        watchdogSharedFieldsPresent(body) ||
        (getTeamConfig(db).lockWatchdog && toggles)
      ) {
        return json({ error: "team_locked" }, 403)
      }
    }
    const patched = applyWatchdogPatch(db.getWatchdogConfig(user.id), body)
    if (patched.error) return json({ error: patched.error }, 400)
    const next = patched.next
    const configError = watchdogConfigError(next)
    if (configError) return json({ error: configError }, 400)
    const vault = effectiveUserKey(
      db,
      user.id,
      watchdogProviderById(next.provider)?.vaultSlug ?? "",
    )
    const filled = {
      ...next,
      apiKey: next.apiKey || vault?.apiKey || "",
      accountId: next.accountId || vault?.accountId || "",
    }
    db.setWatchdogConfig(user.id, filled)
    let syncError: string | null = null
    try {
      // Always push the full payload: an empty provider means rules-only,
      // and the daemon must still learn the current toggles.
      const effective =
        getTeamConfig(db).mode === "team"
          ? resolveWatchdogConfig(db, user.id).value
          : filled
      await syncWatchdogConfig(user.id, watchdogContainerPayload(effective))
    } catch (error) {
      syncError = error instanceof Error ? error.message : "sync failed"
    }
    return json({ ok: true, ...(syncError ? { syncError } : {}) })
  }
  if (url.pathname === "/api/watchdog/config" && req.method === "DELETE") {
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
    const current = db.getWatchdogConfig(user.id)
    db.clearWatchdogProvider(user.id)
    try {
      await syncWatchdogConfig(
        user.id,
        watchdogContainerPayload({
          ...current,
          provider: "",
          accountId: "",
          apiKey: "",
          model: "",
          baseUrl: "",
        }),
      )
    } catch {
      // the boot re-sync rewrites the file on the next start
    }
    return json({ ok: true })
  }
  if (
    url.pathname.startsWith("/api/watchdog/findings/") &&
    req.method === "POST"
  ) {
    const id = url.pathname.slice("/api/watchdog/findings/".length)
    const body = (await readJson(req)) as Record<string, unknown>
    const status = String(body.status ?? "")
    if (status !== "reviewed" && status !== "dismissed" && status !== "new") {
      return json({ error: "status must be new, reviewed, or dismissed" }, 400)
    }
    const updated = db.setWatchdogFindingStatus(id, user.id, status)
    if (!updated) return json({ error: "not found" }, 404)
    return json({ ok: true, finding: findingPublic(updated) })
  }
  if (url.pathname === "/api/stt" && req.method === "POST") {
    const resolved = resolveVoiceConfig(db, user.id)
    if (!resolved.value.sttProvider) {
      return json({ error: "configure a speech-to-text provider first" }, 400)
    }
    if (resolved.sttSource === "missing") {
      return json({ error: "the speech-to-text provider has no API key" }, 400)
    }
    const sttConfig = parseSttConfig(resolved.value)
    if (!sttConfig) {
      return json(
        {
          error:
            "the speech-to-text provider is missing a required field or model",
        },
        400,
      )
    }
    const form = await req.formData().catch(() => null)
    const file = form?.get("audio")
    if (!(file instanceof File)) {
      return json({ error: "audio file is required" }, 400)
    }
    if (file.size > STT_MAX_BYTES) {
      return json({ error: "the recording is too large" }, 413)
    }
    const audio = new Uint8Array(await file.arrayBuffer())
    try {
      const text = await runStt({
        config: sttConfig,
        language: resolved.value.language,
        audio,
        mime: file.type,
      })
      return json({ text })
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "transcription failed, try again",
        },
        502,
      )
    }
  }
  if (url.pathname === "/api/tts" && req.method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>
    const text = String(body.text ?? "")
    if (!text.trim()) return json({ error: "text is required" }, 400)
    const resolved = resolveVoiceConfig(db, user.id)
    if (!resolved.value.ttsProvider) {
      return json({ error: "configure a text-to-speech provider first" }, 400)
    }
    if (resolved.ttsSource === "missing") {
      return json({ error: "the text-to-speech provider has no API key" }, 400)
    }
    const ttsConfig = parseTtsConfig(resolved.value)
    if (!ttsConfig) {
      return json(
        {
          error:
            "the text-to-speech provider is missing a required field or model",
        },
        400,
      )
    }
    try {
      const audio = await runTts({
        config: ttsConfig,
        language: resolved.value.language,
        text: ttsMaxChars(text),
      })
      return new Response(Buffer.from(audio.bytes), {
        headers: {
          "content-type": audio.mime,
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "speech synthesis failed, try again",
        },
        502,
      )
    }
  }
  if (url.pathname === "/api/video" && req.method === "GET") {
    const saved = db.getVideoProvider(user.id)
    const selected =
      videoProviderById(saved?.provider ?? "") ?? videoProviders[0]
    const resolved = resolveVideoProvider(db, user.id)
    return json({
      providers: videoProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      accountId:
        resolved?.keySource === "vault"
          ? resolved.value.accountId
          : (saved?.accountId ?? ""),
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: hasKey(
        teamMode(db) === "team",
        saved?.apiKey ?? "",
        resolved?.value.apiKey ?? "",
      ),
      keySource: resolved?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/video" && req.method === "PUT") {
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
    const vault = effectiveUserKey(db, user.id, videoVaultSlug(spec.id))
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
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
  if (url.pathname === "/api/model3d" && req.method === "GET") {
    const saved = db.getModel3dProvider(user.id)
    const selected =
      model3dProviderById(saved?.provider ?? "") ?? model3dProviders[0]
    const resolved = resolveModel3dProvider(db, user.id)
    return json({
      providers: model3dProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      accountId:
        resolved?.keySource === "vault"
          ? resolved.value.accountId
          : (saved?.accountId ?? ""),
      model: saved?.model ?? selected?.defaultModel ?? "",
      hasKey: hasKey(
        teamMode(db) === "team",
        saved?.apiKey ?? "",
        resolved?.value.apiKey ?? "",
      ),
      keySource: resolved?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/model3d" && req.method === "PUT") {
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
    const vault = effectiveUserKey(db, user.id, model3dVaultSlug(spec.id))
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
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
    const vaulted = resolved?.keySource === "vault"
    const shared = teamMode(db) === "team"
    return json({
      providers: system1ProviderPublic(),
      provider: saved?.provider ?? selected?.id ?? "",
      endpoint: saved?.endpoint ?? "",
      model: saved?.model ?? selected?.defaultModel ?? "",
      accountId: vaulted ? resolved.value.accountId : (saved?.accountId ?? ""),
      gatewayId: vaulted ? resolved.value.gatewayId : (saved?.gatewayId ?? ""),
      slug: vaulted ? resolved.value.slug || "jev" : (saved?.slug ?? "jev"),
      hasKey: hasKey(shared, saved?.apiKey ?? "", resolved?.value.apiKey ?? ""),
      hasGatewayToken: hasKey(
        shared,
        saved?.gatewayToken ?? "",
        resolved?.value.gatewayToken ?? "",
      ),
      keySource: resolved?.keySource ?? null,
    })
  }
  if (url.pathname === "/api/system1" && req.method === "PUT") {
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
    const vault = effectiveUserKey(db, user.id, system1VaultSlug(spec.id))
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
    if (teamWriteLocked(db, user.role)) {
      return json({ error: "team_locked" }, 403)
    }
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
  const managedProject = await handleProjectManage(req, url, db, user, hub)
  if (managedProject) return managedProject
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
        opencodeFileUrl(base, "list", project.path, path),
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
        opencodeFileUrl(base, "content", project.path, path),
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
  if (isSkillsRequest(url.pathname)) {
    const handled = await handleSkills(req, url, db, user, hub, () =>
      skillsClient(user, db),
    )
    if (handled) return handled
    return json({ error: "not found" }, 404)
  }
  if (url.pathname === "/api/providers" && req.method === "GET") {
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const headers = basic(desktop.opencodePassword)
    // A non-OK upstream must surface as an error, never as an empty
    // catalog: an empty list reads as "no provider can be added" and
    // hides a broken desktop OpenCode (same rule as connectedModels).
    const providerJson = async (path: string) => {
      const res = await fetch(`${base}${path}`, { headers })
      if (!res.ok)
        throw new HttpError(
          502,
          `provider list failed (${res.status})`,
          "provider_list_failed",
        )
      return res.json()
    }
    const [providers, auth] = await Promise.all([
      providerJson("/provider"),
      providerJson("/provider/auth"),
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
    const selection = effectiveSelection(db, user)
    // CLI subscription providers live outside opencode's provider auth:
    // probe the desktop for each CLI's own login state. A null probe
    // (image predates cli-status.sh) reports unknown, never logged out.
    const cliStatus = await probeCliProviders(user.id).catch(() => null)
    const cliById = new Map((cliStatus ?? []).map((row) => [row.id, row]))
    // Providers disconnected at the config level (see the logout route):
    // the daemon excludes them, but the picker keeps them re-connectable.
    const disabled = await opencodeDisabledProviders(user.id).catch(
      () => [] as string[],
    )
    return json({
      providers: {
        catalog,
        connected: providers?.connected ?? [],
        disabled,
      },
      cliProviders: {
        available: cliStatus !== null,
        items: cliProviders.map((provider) => {
          const row = cliById.get(provider.id)
          return {
            id: provider.id,
            label: provider.label,
            description: provider.description,
            installed: row ? row.installed : null,
            loggedIn: row ? row.loggedIn : null,
            account: row?.account ?? null,
            models: provider.models.map((model) => ({
              id: model.id,
              name: model.name,
            })),
          }
        }),
      },
      auth: publicProviderAuth(auth),
      team: {
        mode: teamMode(db),
        // Non-admins in team mode consume the shared provider auth; the
        // login/logout flows are admin-only (same rule as the Keys tab).
        lockedAuth: teamWriteLocked(db, user.role),
      },
      selected: saved
        ? {
            selectedProvider: selection.provider ?? saved.selectedProvider,
            selectedModel: selection.model ?? saved.selectedModel,
            thinkingEffort: saved.thinkingEffort,
            lastActiveAt: saved.lastActiveAt,
          }
        : null,
    })
  }
  if (url.pathname === "/api/providers/login" && req.method === "POST") {
    if (teamWriteLocked(db, user.role)) {
      return json(
        {
          error:
            "team_locked: providers are managed by the team admin in team mode",
        },
        403,
      )
    }
    await ensure(user, db)
    const body = await readJson(req)
    // A provider disconnected at the config level (logout fallback) is
    // excluded by the daemon; re-enable it so this login can proceed.
    if (typeof body.provider === "string" && !isCliProviderId(body.provider)) {
      await enableOpencodeProvider(user.id, body.provider).catch(() => false)
    }
    const id = crypto.randomUUID()
    const session: LoginSession = {
      id,
      userId: user.id,
      provider: body.provider ? String(body.provider) : undefined,
      cli: isCliProviderId(body.provider) ? body.provider : undefined,
      method: body.method ? String(body.method) : undefined,
      started: false,
      done: false,
      cancelled: false,
      code: null,
      proc: null,
      scanner: createLoginUrlScanner(),
      urls: [],
      urlFlush: null,
      sockets: new Set(),
      expire: null,
      db,
      hub,
    }
    session.expire = setTimeout(() => {
      if (!session.started) logins.delete(id)
    }, 30_000)
    logins.set(id, session)
    return json({ id })
  }
  if (
    /^\/api\/providers\/login\/[^/]+\/callback$/.test(url.pathname) &&
    req.method === "POST"
  ) {
    const id = decodeURIComponent(url.pathname.split("/")[4] ?? "")
    const session = logins.get(id)
    if (!session || session.userId !== user.id)
      return json({ error: "not found" }, 404)
    if (!session.started || session.done)
      return json({ error: "login is not active — start the login again" }, 409)
    const body = await readJson(req)
    const parsed = parseLocalCallbackUrl(body.url)
    if (!parsed.ok) return json({ error: parsed.error }, 400)
    const container = names(user.id).opencode
    const relay = await sh(
      [
        "docker",
        "exec",
        container,
        "curl",
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--max-time",
        "10",
        parsed.url,
      ],
      undefined,
      15_000,
    )
    if (relay.code === 7)
      return json(
        {
          error:
            "no login server is waiting inside the desktop — restart the login",
        },
        409,
      )
    if (relay.code !== 0)
      return json(
        {
          error:
            relay.stderr.trim().slice(0, 200) ||
            "could not reach the login server inside the desktop",
        },
        502,
      )
    const status = Number(relay.stdout.trim()) || 0
    return json({ delivered: true, status })
  }
  if (url.pathname === "/api/providers/logout" && req.method === "POST") {
    if (teamWriteLocked(db, user.role)) {
      return json(
        {
          error:
            "team_locked: providers are managed by the team admin in team mode",
        },
        403,
      )
    }
    const body = await readJson(req)
    const desktop = await ensure(user, db)
    if (isCliProviderId(body.provider)) {
      // CLI subscription logout: the CLI drops its own credential, then
      // the auth sync revokes the dummy bridge key so the provider
      // leaves the model picker.
      const provider = cliProviderById(body.provider)
      if (!provider) return json({ error: "unknown provider" }, 400)
      const result = await opencodeExec(user.id, [
        provider.bin,
        ...provider.logoutArgs,
      ])
      if (result.code === 0) {
        const synced = await syncCliAuth(
          user.id,
          basic(desktop.opencodePassword).authorization,
        ).catch(() => null)
        if (synced?.applied) {
          await restartOpencode(user.id, { db, desktop, hub })
        }
      }
      return json({
        ok: result.code === 0,
        output: result.stdout || result.stderr,
      })
    }
    const providerId = String(body.provider ?? "")
    const result = await opencodeExec(user.id, [
      "opencode",
      "auth",
      "logout",
      providerId,
    ])
    if (result.code !== 0) {
      // Providers connected through opencode.json config or an env var
      // have no auth.json entry: `opencode auth logout` exits 1 with
      // "Unknown configured provider" and the provider stays connected.
      // Disconnect it at the config level instead.
      const disconnected = await disconnectOpencodeProvider(
        user.id,
        providerId,
      ).catch(() => false)
      if (!disconnected) {
        return json({
          ok: false,
          output: result.stdout || result.stderr,
        })
      }
      let note: string | undefined
      try {
        await restartOpencode(user.id, { db, desktop, hub })
        if (pendingRestart(user.id)) {
          note =
            "provider disconnected — OpenCode restarts once running threads finish"
        }
      } catch {
        note = "provider disconnected, but OpenCode did not restart"
      }
      return json({ ok: true, output: result.stdout || result.stderr, note })
    }
    let note: string | undefined
    if (user.role === "admin" && teamMode(db) === "team") {
      // The admin just removed a provider: refresh the shared snapshot
      // before the restart below so the deleted entry cannot ride the
      // stale snapshot back at the next boot.
      await refreshTeamOpencodeAuth(db, user.id, hub).catch(
        (error: unknown) => {
          console.error(
            `team opencode auth refresh after logout failed: ${
              error instanceof Error ? error.message : error
            }`,
          )
        },
      )
    }
    // The daemon caches its provider list until it restarts, so without a
    // restart the removed provider keeps reporting connected (same reason
    // finishLogin restarts after a login).
    try {
      await restartOpencode(user.id, { db, desktop, hub })
      if (pendingRestart(user.id)) {
        note =
          "provider removed — OpenCode restarts once running threads finish"
      }
    } catch {
      note = "provider removed, but OpenCode did not restart"
    }
    return json({
      ok: true,
      output: result.stdout || result.stderr,
      note,
    })
  }
  if (url.pathname === "/api/agent-cap" && req.method === "GET") {
    const desktop = db.desktop(user.id)
    return json({
      stepCap: desktop?.agentStepCap ?? null,
      defaultStepCap: DEFAULT_AGENT_STEP_CAP,
      effectiveStepCap: desktop?.agentStepCap ?? DEFAULT_AGENT_STEP_CAP,
    })
  }
  if (url.pathname === "/api/agent-cap" && req.method === "PUT") {
    const body = await readJson(req)
    const raw = (body as { stepCap?: unknown }).stepCap
    if (raw !== null && !validAgentStepCap(raw)) {
      return json(
        { error: "stepCap must be an integer between 1 and 100000, or null" },
        400,
      )
    }
    db.updateDesktopAgentStepCap(user.id, raw)
    let applied = false
    let note: string | undefined
    try {
      applied = await syncAgentCap(user.id, raw, {
        db,
        desktop: db.desktop(user.id),
        hub,
      })
    } catch (error: unknown) {
      note = error instanceof Error ? error.message : "agent cap sync failed"
    }
    return json({
      ok: true,
      stepCap: raw,
      defaultStepCap: DEFAULT_AGENT_STEP_CAP,
      effectiveStepCap: raw ?? DEFAULT_AGENT_STEP_CAP,
      applied,
      ...(note ? { note } : {}),
      ...(!applied && !note
        ? {
            note: "saved — applies when the desktop next starts",
          }
        : {}),
    })
  }
  if (url.pathname === "/api/language" && req.method === "PUT") {
    const body = await readJson(req)
    if (!isValidLanguage(body.language)) {
      return json(
        { error: "unsupported language", supported: SUPPORTED_LANGUAGES },
        400,
      )
    }
    db.setSetting("language", body.language)
    // Fan out: every enabled plugin's config file gains the new language.
    // Sync failures stay pending (the queue flushes at desktop-up) and are
    // reported instead of failing the save.
    const failed = await resyncPluginsForLanguage(db, user)
    for (const row of db.installedPlugins(user.id)) {
      if (
        !row.enabled ||
        failed.includes(row.pluginId) ||
        !(row.manifest as { dashboard?: { pages?: unknown } }).dashboard?.pages
      )
        continue
      // Deferred + coalesced like a settings save — restarting inline would
      // kill nothing today, but the save response must never wait on it.
      schedulePluginPageRestart(db, user.id, row, hub)
    }
    return json({
      ok: true,
      language: body.language,
      ...(failed.length
        ? {
            configSync: `pending — ${failed.join(", ")}; the config syncs when the desktop next comes up`,
          }
        : {}),
    })
  }
  if (url.pathname === "/api/thread-model" && req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") ?? ""
    if (!sessionId) return json({ error: "sessionId required" }, 400)
    return json(threadModelPayload(db, user, sessionId))
  }
  if (url.pathname === "/api/model" && req.method === "PUT") {
    const body = await readJson(req)
    const providerID = String(body.providerID ?? "")
    const modelID = String(body.modelID ?? "")
    if (!providerID || !modelID)
      return json({ error: "provider and model required" }, 400)
    const team = getTeamConfig(db)
    if (team.mode === "team" && team.lockModelPicker && user.role !== "admin") {
      return json({ error: "team_locked" }, 403)
    }
    const rawEffort = body.thinkingEffort
    if (
      rawEffort !== undefined &&
      rawEffort !== null &&
      typeof rawEffort !== "string"
    )
      return json({ error: "invalid thinking effort" }, 400)
    const explicitEffort =
      typeof rawEffort === "string" && rawEffort.trim() !== ""
        ? rawEffort.trim()
        : null
    if (explicitEffort && explicitEffort.length > 32)
      return json({ error: "invalid thinking effort" }, 400)
    const sessionId = bodySessionId(body)
    if (sessionId === null)
      return json({ error: "sessionId must be a string" }, 400)
    const desktop = await ensure(user, db)
    if (sessionId) {
      // Per-thread pick (composer on an open thread): only this thread's
      // row changes — no desktop default write, no opencode.json rewrite,
      // no restart. The thread's own effort carries over while the new
      // model supports it; no effort pick stays "desktop default".
      const current = resolveThreadModel(db.threadModel(user.id, sessionId), {
        providerID: desktop.selectedProvider,
        modelID: desktop.selectedModel,
        thinkingEffort: desktop.thinkingEffort,
      })
      let effort: string | null =
        explicitEffort ?? current.thread?.effort ?? null
      if (effort) {
        clearModelVariants(user.id)
        try {
          const variants = await fetchModelVariants(user.id, desktop)
          if (!supportsEffort(variants, providerID, modelID, effort))
            effort = null
        } catch {
          if (explicitEffort)
            return json({ error: "could not verify thinking effort" }, 502)
        }
      }
      db.setThreadModel({
        userId: user.id,
        sessionId,
        providerId: providerID,
        modelId: modelID,
        effort,
      })
      return json({ ok: true, ...threadModelPayload(db, user, sessionId) })
    }
    // An explicit effort is validated against the new model; a saved one is
    // carried over only while the new model still supports it.
    let effort: string | null = explicitEffort
    const carried = effort ?? desktop.thinkingEffort
    if (carried) {
      clearModelVariants(user.id)
      try {
        const variants = await fetchModelVariants(user.id, desktop)
        if (!supportsEffort(variants, providerID, modelID, carried))
          effort = null
      } catch {
        if (explicitEffort)
          return json({ error: "could not verify thinking effort" }, 502)
        effort = desktop.thinkingEffort
      }
    }
    db.setModel(user.id, providerID, modelID)
    db.setThinkingEffort(user.id, effort)
    if (await isRunning(names(user.id).opencode)) {
      await opencodeExec(user.id, [
        "sh",
        "-c",
        `jq --arg p ${shellQuote(providerID)} --arg m ${shellQuote(modelID)} '.model = ($p + "/" + $m) | .small_model = ($p + "/" + $m)' $HOME/.config/opencode/opencode.json > /tmp/oc.json && mv /tmp/oc.json $HOME/.config/opencode/opencode.json`,
      ])
      await restartOpencode(user.id, { db, hub })
    }
    return json({ ok: true })
  }
  if (url.pathname === "/api/thinking" && req.method === "PUT") {
    const body = await readJson(req)
    const rawEffort = body.effort
    if (rawEffort !== undefined && typeof rawEffort !== "string")
      return json({ error: "effort must be a string" }, 400)
    const effort =
      rawEffort && rawEffort.trim() !== "" ? rawEffort.trim() : null
    if (effort && effort.length > 32)
      return json({ error: "invalid thinking effort" }, 400)
    const sessionId = bodySessionId(body)
    if (sessionId === null)
      return json({ error: "sessionId must be a string" }, 400)
    const desktop = await ensure(user, db)
    if (sessionId) {
      // Per-thread effort: validated against the thread's effective model
      // (its own pick, else the desktop default) and stored on its row
      // only — the desktop-wide effort is untouched.
      const current = resolveThreadModel(db.threadModel(user.id, sessionId), {
        providerID: desktop.selectedProvider,
        modelID: desktop.selectedModel,
        thinkingEffort: desktop.thinkingEffort,
      })
      if (!current.providerID || !current.modelID)
        return json({ error: "pick a default model first" }, 400)
      if (effort) {
        clearModelVariants(user.id)
        try {
          const variants = await fetchModelVariants(user.id, desktop)
          if (
            !supportsEffort(
              variants,
              current.providerID,
              current.modelID,
              effort,
            )
          )
            return json(
              { error: "model does not support this thinking effort" },
              400,
            )
        } catch {
          return json({ error: "could not verify thinking effort" }, 502)
        }
      }
      const providerId = current.thread?.providerID ?? null
      const modelId = current.thread?.modelID ?? null
      if (!providerId && !effort) db.clearThreadModel(user.id, sessionId)
      else
        db.setThreadModel({
          userId: user.id,
          sessionId,
          providerId,
          modelId,
          effort,
        })
      return json({ ok: true, ...threadModelPayload(db, user, sessionId) })
    }
    if (!desktop.selectedProvider || !desktop.selectedModel)
      return json({ error: "pick a default model first" }, 400)
    if (effort) {
      clearModelVariants(user.id)
      try {
        const variants = await fetchModelVariants(user.id, desktop)
        if (
          !supportsEffort(
            variants,
            desktop.selectedProvider,
            desktop.selectedModel,
            effort,
          )
        )
          return json(
            { error: "model does not support this thinking effort" },
            400,
          )
      } catch {
        return json({ error: "could not verify thinking effort" }, 502)
      }
    }
    db.setThinkingEffort(user.id, effort)
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
  if (url.pathname === "/api/workspace/file" && req.method === "GET") {
    const path = agentFilePath(url.searchParams.get("path") ?? "")
    if (!path) return json({ error: "not found" }, 404)
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    // opencode sandboxes /file/content to its instance directory; the
    // ?directory= re-root (same trick as projects/media vault) lets a file
    // anywhere under /home/agent resolve, not just ~/workspace.
    const upstream = await fetch(
      opencodeFileUrl(
        base,
        "content",
        path.slice(0, path.lastIndexOf("/")) || "/",
        path,
      ),
      { headers: basic(desktop.opencodePassword) },
    )
    if (!upstream.ok) return json({ error: "not found" }, 404)
    const file = workspaceFileResponse(
      path,
      await upstream.json().catch(() => null),
    )
    if (!file) return json({ error: "not found" }, 404)
    return file
  }
  if (url.pathname === "/api/workspace/snapshots" && req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") ?? ""
    if (!sessionId) return json({ error: "sessionId required" }, 400)
    const media = db
      .workspaceMediaForSession(user.id, sessionId)
      .map((row) => ({
        messageId: row.messageId,
        path: row.path,
        url: snapshotUrlFor(row),
      }))
    return json({ media })
  }
  const snapshotRef = url.pathname.match(
    /^\/api\/workspace\/snapshot\/([^/]+)(?:\/.*)?$/,
  )
  if (snapshotRef && req.method === "GET") {
    const id = decodeURIComponent(snapshotRef[1] ?? "")
    const row = id ? db.workspaceMedia(id, user.id) : null
    if (!row) return json({ error: "not found" }, 404)
    let bytes: Buffer
    try {
      bytes = readFileSync(join(MEDIA_DIR, id))
    } catch {
      return json({ error: "not found" }, 404)
    }
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "content-type": row.mime,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    })
  }
  if (url.pathname.startsWith("/api/opencode/")) {
    // Guaranteed-passive read (?passive=1): refuses to start or wake
    // anything, server-side — there is no probe/list race where the phase
    // changes between a client probe and the real call. The header search
    // (and any other passive reader) uses this route.
    if (url.searchParams.get("passive") === "1" && req.method === "GET") {
      const phase = await desktopPhase(user.id)
      if (phase !== "running") return json({ error: "desktop_asleep" }, 503)
      const row = db.desktop(user.id)
      if (!row) throw new Error("desktop record missing")
      const base = await endpoint(user.id, "opencode", 4096)
      return proxy(req, base, "/api/opencode", basic(row.opencodePassword))
    }
    // Sandbox sessions route to their own container daemon, with no
    // desktop wake and none of the desktop prompt preparation (spec §7).
    const sbxRef = url.pathname.match(
      /^\/api\/opencode\/session\/([^/]+)(\/.*)?$/,
    )
    if (sbxRef) {
      const sbxId = decodeURIComponent(sbxRef[1] ?? "")
      const sbxRow = db.sandboxBySession(sbxId)
      if (sbxRow) {
        if (sbxRow.userId !== user.id) return json({ error: "not found" }, 404)
        const suffix = sbxRef[2] ?? ""
        if (suffix === "/split")
          return json({ error: "sandbox threads cannot be split" }, 400)
        if (suffix === "" && req.method === "DELETE") {
          await cleanupDeletedThread(db, user.id, sbxId)
          hub.emit(user.id, { type: "threads.changed" })
          return json({ deleted: true })
        }
        const daemon = await sandboxDaemon(db, user.id, sbxId)
        if (!daemon)
          return json(
            { error: "sandbox is not running", code: "sandbox_gone" },
            410,
          )
        const sbxAuth = basic(daemon.password)
        if (
          req.method === "POST" &&
          (suffix === "/prompt_async" || suffix === "/message")
        ) {
          const parsed = (await req.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const outbound: Record<string, unknown> = {
            ...(parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed
              : {}),
          }
          const wantedModel = (
            outbound.model as { modelID?: unknown } | undefined
          )?.modelID
          outbound.agent = "sandbox"
          outbound.model = {
            providerID: SANDBOX_BROKER_PROVIDER,
            modelID: wantedModel === "small" ? "small" : "chat",
          }
          delete outbound.system
          touchSandbox(db, sbxRow.id)
          return proxy(
            req,
            daemon.base,
            "/api/opencode",
            sbxAuth,
            JSON.stringify(outbound),
          )
        }
        if (req.method === "GET" && suffix === "/message") {
          const pageQuery = parseMessagePageQuery(url.searchParams)
          const upstream = await fetch(
            new URL(
              `${url.pathname.replace("/api/opencode", "")}${pageQuery ? "" : url.search}`,
              daemon.base,
            ),
            { headers: sbxAuth, signal: AbortSignal.timeout(30_000) },
          ).catch(() => null)
          if (upstream?.ok) {
            const parsedMsg: unknown = await upstream.json().catch(() => null)
            if (Array.isArray(parsedMsg)) {
              if (!pageQuery) return json(trimDashboardMessages(parsedMsg))
              const page = pageMessages(parsedMsg, pageQuery)
              if (!page)
                return json(
                  {
                    error: "unknown before cursor",
                    code: "message_cursor_unknown",
                  },
                  400,
                )
              return json({
                ...page,
                messages: trimDashboardMessages(page.messages),
              })
            }
          }
          if (pageQuery) return json({ error: "message list failed" }, 502)
        }
        return proxy(req, daemon.base, "/api/opencode", sbxAuth)
      }
    }
    const desktop = await ensure(user, db)
    const base = await endpoint(user.id, "opencode", 4096)
    const auth = basic(desktop.opencodePassword)
    if (url.pathname === "/api/opencode/session" && req.method === "POST")
      return createOpencodeSession(req, base, auth, db, user)
    // Split: a new thread ending at the selected message (inclusive),
    // source untouched. Resolved onto opencode's fork in thread-split.ts;
    // intercepted here because the generic proxy has no /split upstream.
    const splitRef = url.pathname.match(
      /^\/api\/opencode\/session\/([^/]+)\/split$/,
    )
    if (splitRef && req.method === "POST") {
      const id = decodeURIComponent(splitRef[1] ?? "")
      const parsed = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      const body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {}
      const res = await splitThread({
        db,
        userId: user.id,
        base,
        headers: auth,
        sessionId: id,
        body,
      })
      if (res.ok) hub.emit(user.id, { type: "threads.changed" })
      return res
    }
    const sessionRef = url.pathname.match(/^\/api\/opencode\/session\/([^/]+)$/)
    if (sessionRef && req.method === "DELETE") {
      const id = decodeURIComponent(sessionRef[1] ?? "")
      const res = await proxy(req, base, "/api/opencode", auth)
      if (res.ok) await cleanupDeletedThread(db, user.id, id)
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
      const outbound = await prepareDashboardPrompt(
        db,
        user,
        desktop.opencodePassword,
        base,
        auth,
        promptedId,
        body,
      )
      return proxy(req, base, "/api/opencode", auth, JSON.stringify(outbound))
    }
    const messageList = url.pathname.match(
      /^\/api\/opencode\/session\/([^/]+)\/message$/,
    )
    if (messageList && req.method === "GET") {
      // The dashboard polls this on every stream tick; tool parts can carry
      // megabytes of read output and base64 attachments the chat never
      // renders, so slim them before the payload crosses to the browser.
      // Paged asks (?limit/&before, see messages-page.ts) additionally
      // ship only the requested window of a long thread; the paging
      // params are ours, never forwarded to opencode.
      const pageQuery = parseMessagePageQuery(url.searchParams)
      const upstream = await fetch(
        new URL(
          `${url.pathname.replace("/api/opencode", "")}${pageQuery ? "" : url.search}`,
          base,
        ),
        { headers: auth, signal: AbortSignal.timeout(30_000) },
      ).catch(() => null)
      if (upstream?.ok) {
        const parsed: unknown = await upstream.json().catch(() => null)
        if (Array.isArray(parsed)) {
          if (!pageQuery) return json(trimDashboardMessages(parsed))
          const page = pageMessages(parsed, pageQuery)
          if (!page)
            return json(
              {
                error: "unknown before cursor",
                code: "message_cursor_unknown",
              },
              400,
            )
          // Trim only the slice that crosses to the browser.
          return json({
            ...page,
            messages: trimDashboardMessages(page.messages),
          })
        }
      }
      // A paged ask must not fall through to the generic proxy: it would
      // forward our params upstream and return a shape the caller did
      // not ask for. The legacy full-list path keeps its proxy fallback.
      if (pageQuery) return json({ error: "message list failed" }, 502)
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
    all?: {
      id?: string
      models?: Record<string, { name?: string; variants?: unknown }> | undefined
    }[]
    connected?: unknown
  }
  const connected = Array.isArray(body.connected)
    ? body.connected.filter((id): id is string => typeof id === "string")
    : []
  const connectedSet = new Set(connected)
  const models: {
    providerID: string
    modelID: string
    name?: string
    variants: string[]
  }[] = []
  for (const provider of body.all ?? []) {
    if (!provider.id || !connectedSet.has(provider.id)) continue
    for (const [modelID, info] of Object.entries(provider.models ?? {})) {
      const variants =
        info?.variants && typeof info.variants === "object"
          ? Object.keys(info.variants)
          : []
      models.push({
        providerID: provider.id,
        modelID,
        name: info?.name,
        variants,
      })
    }
  }
  models.sort((a, b) =>
    `${a.providerID}/${a.modelID}`.localeCompare(
      `${b.providerID}/${b.modelID}`,
    ),
  )
  // CLI subscription providers read "connected" in opencode even while
  // logged out (keyless custom providers); gate them on the real CLI
  // login state so the picker never offers a dead subscription model.
  const gated = models.some((model) => isCliProviderId(model.providerID))
    ? filterCliModels(
        models,
        await probeCliProvidersCached(user.id).catch(() => null),
      )
    : models
  return { models: gated, connected }
}

async function handleCron(
  req: Request,
  url: URL,
  db: Db,
  user: User,
  hub: EventHub,
  holdOpen?: () => void,
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

  if (url.pathname === "/api/cron" && req.method === "GET") {
    const ownership = pluginOwnership(db, user.id)
    return json(
      db.cronJobs(user.id).map((job) => {
        const plugin = pluginOriginForCronJob(ownership, job.name)
        return plugin ? { ...job, plugin } : job
      }),
    )
  }

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
      return json(
        { error: "runKind must be prompt, script, both, or auto" },
        400,
      )
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
      kind?: CronJob["kind"]
      cronExpr?: string | null
      everySeconds?: number | null
      atMs?: number | null
      deleteAfterRun?: boolean
    } = {}
    let scheduleTouched = false
    if (body.kind !== undefined) {
      const kind = body.kind as CronScheduleKind
      if (kind === "cron") {
        const cronExpr = String(body.cronExpr ?? "").trim()
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
        changes.kind = "cron"
        changes.cronExpr = cronExpr
        changes.everySeconds = null
        changes.atMs = null
        changes.deleteAfterRun = false
      } else if (kind === "every") {
        const everySeconds = Number(body.everySeconds)
        if (
          !Number.isInteger(everySeconds) ||
          everySeconds < 60 ||
          everySeconds > 31_536_000
        )
          return json(
            {
              error: "everySeconds must be an integer between 60 and 31536000",
            },
            400,
          )
        changes.kind = "every"
        changes.cronExpr = null
        changes.everySeconds = everySeconds
        changes.atMs = null
        changes.deleteAfterRun = false
      } else if (kind === "at") {
        const atMs = Number(body.atMs)
        if (
          !Number.isInteger(atMs) ||
          atMs < Date.now() ||
          atMs > Date.now() + CRON_LOOKAHEAD_MS
        )
          return json(
            { error: "atMs must be a future time within 4 years" },
            400,
          )
        changes.kind = "at"
        changes.cronExpr = null
        changes.everySeconds = null
        changes.atMs = atMs
        changes.deleteAfterRun = true
      } else {
        return json({ error: "kind must be cron, every, or at" }, 400)
      }
      scheduleTouched = true
    }
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
        return json(
          { error: "runKind must be prompt, script, both, or auto" },
          400,
        )
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
      changes.enabled = Boolean(body.enabled)
    }
    // The next run follows the merged job: a schedule change (or an enable)
    // recomputes from the new kind/expr/interval, not the pre-PATCH row.
    if (scheduleTouched || body.enabled !== undefined) {
      changes.nextRunAt = nextRunMs({ ...job, ...changes } as CronJob)
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
    const jobId = decodeURIComponent(idMatch[1] ?? "")
    const job = db.cronJobById(jobId, user.id)
    const removed = db.deleteCronJob(jobId, user.id)
    if (!removed) return json({ error: "job not found" }, 404)
    if (job && GUARD_JOB_RE.test(job.name)) {
      // Last guard gone → the shared thread (and its screen) goes with it.
      void cleanupGuardSharedThread(db, user.id, [job.sessionId ?? ""]).catch(
        () => {},
      )
    }
    hub.emit(user.id, { type: "cron.changed" })
    return json({ ok: true })
  }

  if (idMatch?.[2] === "/run" && req.method === "POST") {
    // Firing a job starts the desktop and prompts a session — well past the
    // connection idle timeout.
    holdOpen?.()
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
  const onData = (data: Uint8Array) => {
    if (session.urlFlush) {
      clearTimeout(session.urlFlush)
      session.urlFlush = null
    }
    const fresh = session.scanner.push(data).some((u) => !isLocalUrl(u))
    if (fresh) {
      session.urls = session.scanner.urls().filter((u) => !isLocalUrl(u))
      const frame = JSON.stringify({ op: "urls", urls: session.urls })
      for (const sock of session.sockets) {
        try {
          sock.send(frame)
        } catch {
          // socket already closed
        }
      }
    }
    // A URL may have ended exactly at the chunk edge (or be the last thing
    // the login ever prints) — flush the scanner after a quiet period.
    session.urlFlush = setTimeout(
      (sessionRef: LoginSession) => {
        sessionRef.urlFlush = null
        if (
          sessionRef.done ||
          sessionRef.scanner.flush().every((u) => isLocalUrl(u))
        )
          return
        sessionRef.urls = sessionRef.scanner
          .urls()
          .filter((u) => !isLocalUrl(u))
        const frame = JSON.stringify({ op: "urls", urls: sessionRef.urls })
        for (const sock of sessionRef.sockets) {
          try {
            sock.send(frame)
          } catch {
            // socket already closed
          }
        }
      },
      2000,
      session,
    )
    session.urlFlush.unref?.()
    for (const sock of session.sockets) {
      try {
        sock.send(data)
      } catch {
        // socket already closed
      }
    }
  }
  session.proc = session.cli
    ? spawnCliLogin(session.userId, session.cli, { cols, rows, onData })
    : spawnLogin(session.userId, {
        provider: session.provider,
        method: session.method,
        cols,
        rows,
        onData,
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
  if (session.urlFlush) {
    clearTimeout(session.urlFlush)
    session.urlFlush = null
  }
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
  if (session.urlFlush) {
    clearTimeout(session.urlFlush)
    session.urlFlush = null
  }
  if (session.cancelled) return
  session.code = code
  session.done = true
  let note: string | undefined
  if (code === 0 && session.cli && session.db) {
    // CLI subscription login: reflect the new login state in opencode's
    // auth.json so the provider turns connected, then the restart below
    // picks it up. Per-desktop state — never part of the team snapshot.
    const row = session.db.desktop(session.userId)
    if (row) {
      await syncCliAuth(
        session.userId,
        basic(row.opencodePassword).authorization,
      ).catch(() => null)
    }
  }
  if (code === 0) {
    // Team mode: a successful provider login by the admin refreshes the
    // shared auth snapshot and fans it out (best effort, fire-and-forget).
    const admin = session.db?.userById(session.userId)
    if (
      !session.cli &&
      session.db &&
      admin &&
      admin.role === "admin" &&
      teamMode(session.db) === "team"
    ) {
      void refreshTeamOpencodeAuth(
        session.db,
        session.userId,
        session.hub,
      ).catch((error: unknown) => {
        console.error(
          `team opencode auth refresh after login failed: ${
            error instanceof Error ? error.message : error
          }`,
        )
      })
    }
    try {
      await restartOpencode(session.userId, {
        db: session.db,
        hub: session.hub,
      })
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
    thinkingEffort: null,
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

// The scheme this request really arrived over (#105): x-forwarded-proto
// counts only from explicitly trusted proxy infrastructure or on the
// configured canonical host — a spoofed header on the internal origin
// must not mint a session there.
function requestProto(req: Request, url: URL, db: Db): string {
  return effectiveProto(
    {
      forwardedProto: req.headers.get("x-forwarded-proto"),
      host: req.headers.get("host"),
      protocol: url.protocol,
    },
    { canonicalOrigin: instancePublicOrigin(db), trustProxy },
  )
}

function sessionResponse(req: Request, url: URL, db: Db, user: User) {
  // With COOKIE_SECURE=1 the browser drops the session cookie on insecure
  // origins — a login there "succeeds" and then every later request 401s.
  // Refuse at login time with the actual cause instead. Browser page
  // loads never get this far on a configured instance: they redirect to
  // the canonical https origin first, and the login screen blocks
  // credential entry pre-submit via /api/auth/config (#105).
  if (cookieSecure && requestProto(req, url, db) !== "https") {
    const canonicalOrigin = instancePublicOrigin(db)
    return json(
      {
        error:
          "insecure origin — this dashboard sets Secure-only session cookies, so sign-in cannot stick; open it over https",
        reason: "insecure_origin",
        ...(canonicalOrigin ? { canonicalOrigin } : {}),
      },
      403,
    )
  }
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
