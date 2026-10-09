import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type Desktop,
  type ImageProvider,
  type Model3dProvider,
  type System1Provider,
  type VideoProvider,
  type VikingProvider,
  vikingProviderReady,
} from "@open-bot/db"
import { manualPackages } from "./apt-snapshot"
import {
  computerImage,
  controlName,
  githubToken,
  inDocker,
  maxDesktops,
  names,
  opencodeImage,
  vikingImage,
} from "./env"
import { startFileWatch, stopFileWatch } from "./file-watch"
import { HttpError } from "./http-error"
import { imageAuthReady } from "./image-providers"
import { isUploadPath } from "./join-file"
import { model3dAuthReady } from "./model3d-providers"
import { docker, sh } from "./shell"
import { videoAuthReady } from "./video-providers"
import { ensureVikingUser, vikingUserKey } from "./viking-user"

const starting = new Map<string, Promise<void>>()
const startErrors = new Map<string, string>()

export function startError(userId: string) {
  return startErrors.get(userId) ?? ""
}

/** In-flight start promise for a user, if one is running. */
export function currentStart(userId: string) {
  return starting.get(userId)
}

export function controlBase(network: string) {
  if (inDocker) return "http://open-bot:8787"
  return `http://${gatewayCache.get(network) ?? "127.0.0.1"}:8787`
}

export function llmBase(network: string) {
  return `${controlBase(network)}/llm/v1`
}

const gatewayCache = new Map<string, string>()

async function ensureNetwork(network: string) {
  const exists = await sh(
    ["docker", "network", "inspect", network],
    undefined,
    30_000,
  )
  if (exists.code !== 0)
    await docker(["network", "create", network], undefined, 30_000)
  const gateway = (
    await docker(
      [
        "network",
        "inspect",
        "-f",
        "{{(index .IPAM.Config 0).Gateway}}",
        network,
      ],
      undefined,
      30_000,
    )
  ).trim()
  gatewayCache.set(network, gateway)
  if (inDocker && controlName) {
    const connected = await sh(
      [
        "docker",
        "network",
        "inspect",
        network,
        "-f",
        "{{range $k, $v := .Containers}}{{$v.Name}} {{end}}",
      ],
      undefined,
      30_000,
    )
    if (!connected.stdout.includes(controlName)) {
      await docker(
        ["network", "connect", "--alias", "open-bot", network, controlName],
        undefined,
        30_000,
      )
    }
  }
}

async function ensureVolume(name: string) {
  const exists = await sh(
    ["docker", "volume", "inspect", name],
    undefined,
    30_000,
  )
  if (exists.code !== 0)
    await docker(["volume", "create", name], undefined, 30_000)
}

async function captureAptSnapshot(container: string, homeVolume: string) {
  const exists = await sh(["docker", "inspect", container], undefined, 30_000)
  if (exists.code !== 0) return
  const dir = mkdtempSync(join(tmpdir(), "ob-apt-"))
  try {
    const copied = await sh(
      [
        "docker",
        "cp",
        `${container}:/var/lib/apt/extended_states`,
        join(dir, "extended_states"),
      ],
      undefined,
      60_000,
    )
    if (copied.code !== 0) return
    const names = manualPackages(
      readFileSync(join(dir, "extended_states"), "utf8"),
    )
    if (names.length === 0) return
    const written = await sh(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        "--entrypoint",
        "sh",
        "-v",
        `${homeVolume}:/home/agent`,
        opencodeImage,
        "-c",
        "mkdir -p /home/agent/.open-bot && cat > /home/agent/.open-bot/apt-manual-snapshot",
      ],
      `${names.join("\n")}\n`,
      120_000,
    )
    if (written.code !== 0) {
      console.error(
        written.stderr.trim() || "could not snapshot installed packages",
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function imageReady(image: string) {
  const result = await sh(
    ["docker", "image", "inspect", image],
    undefined,
    30_000,
  )
  return result.code === 0
}

export async function runningCount() {
  const out = await docker([
    "ps",
    "-q",
    "--filter",
    "label=open-bot=1",
    "--filter",
    "label=open-bot-role=opencode",
  ])
  return out.split("\n").filter(Boolean).length
}

export async function isRunning(name: string) {
  const result = await sh(
    ["docker", "inspect", "-f", "{{.State.Running}}", name],
    undefined,
    30_000,
  )
  return result.code === 0 && result.stdout.trim() === "true"
}

export async function containerIp(name: string, network: string) {
  const ip = (
    await docker(
      [
        "inspect",
        "-f",
        `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
        name,
      ],
      undefined,
      30_000,
    )
  ).trim()
  if (!ip) throw new Error(`no address for ${name}`)
  return ip
}

async function waitHttp(
  name: string,
  network: string,
  port: number,
  path: string,
  headers?: HeadersInit,
  ms = 120000,
) {
  const start = Date.now()
  let last = "not started"
  while (Date.now() - start < ms) {
    if (await isRunning(name)) {
      try {
        const ip = await containerIp(name, network)
        const response = await fetch(`http://${ip}:${port}${path}`, {
          headers,
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return ip
        last = `${response.status}`
      } catch (error) {
        last = error instanceof Error ? error.message : "unreachable"
      }
    }
    await Bun.sleep(1000)
  }
  throw new Error(`${name} did not become ready (${last})`)
}

function vikingConfig(desktop: Desktop, viking: VikingProvider) {
  return {
    server: {
      host: "0.0.0.0",
      port: 1933,
      root_api_key: desktop.vikingKey,
    },
    storage: {
      workspace: "/data",
      vectordb: { name: "context", backend: "local", path: "/data" },
      agfs: { backend: "local", path: "/data" },
    },
    embedding: {
      dense: {
        provider: "openai",
        model: viking.embedModel,
        api_key: viking.apiKey,
        api_base: viking.baseURL,
        dimension: viking.embedDimension,
        input: "text",
      },
    },
    vlm: {
      provider: "openai",
      model: viking.vlmModel,
      api_key: viking.apiKey,
      api_base: viking.baseURL,
      temperature: 0,
      max_retries: 2,
    },
  }
}

async function runDetached(args: string[]) {
  await docker(
    [
      "run",
      "-d",
      "--label",
      "open-bot=1",
      // Crash/OOM self-heal and come-back-after-host-reboot. Explicit docker
      // stop (sleep) still keeps the container down.
      "--restart",
      "unless-stopped",
      ...args,
    ],
    undefined,
    120_000,
  )
}

export async function startDesktop(
  userId: string,
  desktop: Desktop,
  viking: VikingProvider | null,
  image: ImageProvider | null = null,
  system1: System1Provider | null = null,
  video: VideoProvider | null = null,
  model3d: Model3dProvider | null = null,
  chatKeys: ChatKeyEntry[] = [],
) {
  const existing = starting.get(userId)
  if (existing) return existing
  startErrors.delete(userId)
  const job = startDesktopInner(
    userId,
    desktop,
    viking,
    image,
    system1,
    video,
    model3d,
    chatKeys,
  )
    .catch((error: unknown) => {
      startErrors.set(
        userId,
        error instanceof Error ? error.message : "desktop start failed",
      )
      throw error
    })
    .finally(() => starting.delete(userId))
  starting.set(userId, job)
  return job
}

async function startDesktopInner(
  userId: string,
  desktop: Desktop,
  viking: VikingProvider | null,
  image: ImageProvider | null,
  system1: System1Provider | null,
  video: VideoProvider | null,
  model3d: Model3dProvider | null,
  chatKeys: ChatKeyEntry[],
) {
  const n = names(userId)
  if (
    !(await imageReady(opencodeImage)) ||
    !(await imageReady(computerImage))
  ) {
    throw new HttpError(
      503,
      "Desktop images are not built. Run bun run images, then start the desktop again.",
      "images_missing",
    )
  }
  if (!(await imageReady(vikingImage))) {
    throw new HttpError(
      503,
      `OpenViking image ${vikingImage} is not present. Pull it, then start the desktop again.`,
      "viking_image_missing",
    )
  }
  if (!vikingProviderReady(viking) && !(await isRunning(n.viking))) {
    throw new HttpError(
      503,
      "Set OpenViking models in Config before starting a desktop.",
      "viking_models_missing",
    )
  }
  if (!(await isRunning(n.opencode)) && (await runningCount()) >= maxDesktops) {
    throw new HttpError(
      429,
      "Too many desktops are running. Sleep one, then try again.",
      "desktop_capacity",
    )
  }
  await ensureNetwork(n.network)
  await ensureVolume(n.home)
  await ensureVolume(n.usrLocal)
  await ensureVolume(n.vikingData)
  await ensureVolume(n.x11)
  const base = llmBase(n.network)

  if (!(await isRunning(n.viking))) {
    if (!vikingProviderReady(viking)) {
      throw new HttpError(
        503,
        "Set OpenViking models in Config before starting a desktop.",
        "viking_models_missing",
      )
    }
    await sh(["docker", "rm", "-f", n.viking], undefined, 60_000)
    await runDetached([
      "--name",
      n.viking,
      "--network",
      n.network,
      "--network-alias",
      "viking",
      "--label",
      "open-bot-role=viking",
      "--label",
      `open-bot-user=${n.key}`,
      "--memory",
      "1g",
      "--cpus",
      "1",
      "-e",
      `OPENVIKING_CONF_CONTENT=${JSON.stringify(vikingConfig(desktop, viking))}`,
      "-v",
      `${n.vikingData}:/data`,
      vikingImage,
    ])
  }
  const vikingIp = await waitHttp(
    n.viking,
    n.network,
    1933,
    "/health",
    undefined,
    180000,
  )
  await ensureVikingUser(`http://${vikingIp}:1933`, desktop.vikingKey)

  let createdOpencode = false
  if (!(await isRunning(n.opencode))) {
    createdOpencode = true
    await captureAptSnapshot(n.opencode, n.home)
    await sh(["docker", "rm", "-f", n.opencode], undefined, 60_000)
    await runDetached([
      "--name",
      n.opencode,
      "--network",
      n.network,
      "--network-alias",
      "opencode",
      "--label",
      "open-bot-role=opencode",
      "--label",
      `open-bot-user=${n.key}`,
      "--memory",
      "4g",
      "--cpus",
      "2",
      "--shm-size",
      "1g",
      "--security-opt",
      "apparmor=unconfined",
      "--cap-add",
      "SYS_ADMIN",
      "-e",
      "HOME=/home/agent",
      "-e",
      `OPEN_BOT_LLM_URL=${base}`,
      "-e",
      `OPEN_BOT_LLM_TOKEN=${desktop.llmToken}`,
      "-e",
      `OPEN_BOT_CONTROL_URL=${controlBase(n.network)}`,
      "-e",
      `OPENCODE_SERVER_PASSWORD=${desktop.opencodePassword}`,
      "-e",
      "OPENCODE_SERVER_USERNAME=opencode",
      "-e",
      "OPENCODE_DISABLE_AUTOUPDATE=1",
      "-e",
      "OPENVIKING_URL=http://viking:1933",
      "-e",
      `OPENVIKING_API_KEY=${vikingUserKey(desktop.vikingKey)}`,
      "-e",
      `OPENVIKING_PEER_ID=user-${n.key}`,
      "-e",
      "OPENVIKING_RECALL_PEER_SCOPE=actor",
      "-e",
      `OPEN_BOT_MODEL_PROVIDER=${desktop.selectedProvider ?? ""}`,
      "-e",
      `OPEN_BOT_MODEL=${desktop.selectedModel ?? ""}`,
      ...(githubToken ? ["-e", `GITHUB_TOKEN=${githubToken}`] : []),
      "-v",
      `${n.usrLocal}:/usr/local`,
      "-v",
      `${n.home}:/home/agent`,
      "-v",
      `${n.x11}:/tmp/.X11-unix`,
      opencodeImage,
    ])
  }
  const auth = `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`
  await waitHttp(
    n.opencode,
    n.network,
    4096,
    "/global/health",
    {
      authorization: auth,
    },
    300000,
  )
  if (createdOpencode) {
    try {
      await syncImageAuth(
        userId,
        image && imageAuthReady(image)
          ? {
              provider: image.provider,
              accountId: image.accountId,
              token: image.apiKey,
              model: image.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing cf-ai setup")) throw error
    }
    try {
      await syncVideoAuth(
        userId,
        video && videoAuthReady(video)
          ? {
              provider: video.provider,
              accountId: video.accountId,
              token: video.apiKey,
              model: video.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing video setup")) throw error
    }
    try {
      await syncModel3dAuth(
        userId,
        model3d && model3dAuthReady(model3d)
          ? {
              provider: model3d.provider,
              accountId: model3d.accountId,
              token: model3d.apiKey,
              model: model3d.model,
            }
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing model3d setup")) throw error
    }
    try {
      await syncSystem1(userId, system1)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing system1 setup")) throw error
    }
    if (chatKeys.length > 0) {
      try {
        const chat = await syncChatAuth(userId, auth, chatKeys)
        if (chat.applied) await restartOpencode(userId)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (!message.includes("missing chat setup")) throw error
      }
    }
  }
  if (createdOpencode && desktopReadyHook) {
    desktopReadyHook(userId).catch((error: unknown) => {
      console.error(
        `plugin setup after ${n.opencode} start failed: ${
          error instanceof Error ? error.message : error
        }`,
      )
    })
  }

  if (!(await isRunning(n.computer))) {
    await sh(["docker", "rm", "-f", n.computer], undefined, 60_000)
    await runDetached([
      "--name",
      n.computer,
      "--network",
      n.network,
      "--network-alias",
      "computer",
      "--label",
      "open-bot-role=computer",
      "--label",
      `open-bot-user=${n.key}`,
      "--memory",
      "512m",
      "--cpus",
      "0.5",
      "-v",
      `${n.x11}:/tmp/.X11-unix`,
      computerImage,
    ])
  }
  await waitHttp(n.computer, n.network, 6080, "/vnc.html", undefined, 60000)
  startFileWatch(userId)
}

export async function stopDesktop(userId: string) {
  markSlept(userId)
  stopFileWatch(userId)
  const n = names(userId)
  await sh(["docker", "stop", "-t", "5", n.computer], undefined, 90_000)
  await sh(["docker", "stop", "-t", "10", n.opencode], undefined, 90_000)
  await sh(["docker", "stop", "-t", "15", n.viking], undefined, 90_000)
}

// Desktops stopped on purpose (sleep button, idle sweeper, recycle) so the
// crash-restart sweep does not resurrect them.
const sleptAt = new Map<string, number>()

function markSlept(userId: string) {
  sleptAt.set(userId, Date.now())
}

export function sleptRecently(userId: string, withinMs = 15 * 60_000) {
  const at = sleptAt.get(userId)
  return typeof at === "number" && Date.now() - at < withinMs
}

export async function containerExists(name: string) {
  const result = await sh(
    ["docker", "container", "inspect", name],
    undefined,
    30_000,
  )
  return result.code === 0
}

/**
 * True when the desktop's opencode server still has work in flight. Used by
 * the idle sweeper so a desktop is never stopped mid-turn; unreadable status
 * counts as busy to stay on the safe side.
 */
export async function desktopBusy(
  userId: string,
  desktop: Desktop | null,
): Promise<boolean> {
  if (!desktop) return true
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  try {
    const base = await endpoint(userId, "opencode", 4096)
    const response = await fetch(`${base}/session/status`, {
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${desktop.opencodePassword}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return true
    const body = (await response.json()) as Record<
      string,
      { type?: unknown } | undefined
    >
    if (!body || typeof body !== "object") return true
    return Object.values(body).some(
      (status) =>
        !status || typeof status !== "object" || status.type !== "idle",
    )
  } catch {
    return true
  }
}

export async function destroyDesktop(userId: string) {
  markSlept(userId)
  stopFileWatch(userId)
  const n = names(userId)
  await sh(
    ["docker", "rm", "-f", n.computer, n.opencode, n.viking],
    undefined,
    60_000,
  )
  const volumes = await sh(
    ["docker", "volume", "rm", "-f", n.home, n.usrLocal, n.vikingData, n.x11],
    undefined,
    60_000,
  )
  if (volumes.code !== 0 && !/no such volume/i.test(volumes.stderr)) {
    throw new Error(volumes.stderr.trim() || "could not remove desktop volumes")
  }
  await sh(["docker", "network", "rm", n.network], undefined, 30_000)
}

export async function desktopPhase(userId: string) {
  const n = names(userId)
  if (starting.has(userId)) return "starting" as const
  if (await isRunning(n.opencode)) return "running" as const
  return "sleeping" as const
}

export async function endpoint(
  userId: string,
  role: "opencode" | "computer" | "viking",
  port: number,
) {
  const n = names(userId)
  const name = n[role]
  const ip = await containerIp(name, n.network)
  return `http://${ip}:${port}`
}

export type LoginProc = {
  terminal: {
    write(data: string | BufferSource): number
    resize(cols: number, rows: number): void
    close(): void
  }
  exited: Promise<number>
  kill(): void
}

export function spawnLogin(
  userId: string,
  opts: {
    provider?: string
    method?: string
    cols: number
    rows: number
    onData: (data: Uint8Array) => void
  },
): LoginProc {
  const n = names(userId)
  const args = [
    "docker",
    "exec",
    "-it",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    "-e",
    "TERM=xterm-256color",
    ...(opts.provider ? ["-e", `OB_AUTH_PROVIDER=${opts.provider}`] : []),
    ...(opts.method ? ["-e", `OB_AUTH_METHOD=${opts.method}`] : []),
    "-w",
    "/home/agent/workspace",
    n.opencode,
    "/opt/open-bot/opencode-auth.sh",
    "login",
  ]
  const proc = Bun.spawn(args, {
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data(_terminal: unknown, data: Uint8Array) {
        opts.onData(data.slice())
      },
    },
  } as Parameters<typeof Bun.spawn>[1])
  const terminal = (
    proc as {
      terminal?: LoginProc["terminal"] & { setRawMode(enabled: boolean): void }
    }
  ).terminal
  if (!terminal) throw new Error("login pty missing")
  terminal.setRawMode(true)
  return {
    terminal,
    exited: proc.exited,
    kill() {
      proc.kill()
    },
  }
}

export function spawnProjectShell(
  userId: string,
  opts: {
    cwd: string
    cols: number
    rows: number
    onData: (data: Uint8Array) => void
  },
): LoginProc {
  const n = names(userId)
  const args = [
    "docker",
    "exec",
    "-it",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    "-e",
    "TERM=xterm-256color",
    "-w",
    opts.cwd,
    n.opencode,
    "bash",
  ]
  const proc = Bun.spawn(args, {
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data(_terminal: unknown, data: Uint8Array) {
        opts.onData(data.slice())
      },
    },
  } as Parameters<typeof Bun.spawn>[1])
  const terminal = (
    proc as {
      terminal?: LoginProc["terminal"] & { setRawMode(enabled: boolean): void }
    }
  ).terminal
  if (!terminal) throw new Error("project shell pty missing")
  terminal.setRawMode(true)
  return {
    terminal,
    exited: proc.exited,
    kill() {
      proc.kill()
    },
  }
}

export async function restartOpencode(userId: string) {
  const n = names(userId)
  await sh(
    ["docker", "exec", n.opencode, "pkill", "-TERM", "-f", "opencode serve"],
    undefined,
    30_000,
  )
}

export async function syncImageAuth(
  userId: string,
  value: {
    provider: string
    accountId: string
    token: string
    model: string
  } | null,
) {
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const payload = JSON.stringify(
    value
      ? {
          provider: value.provider,
          accountId: value.accountId,
          token: value.token,
          model: value.model,
        }
      : {},
  )
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-image-auth.sh",
    ],
    payload,
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing cf-ai setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write image auth")
  }
  return true
}

export async function syncVideoAuth(
  userId: string,
  value: {
    provider: string
    accountId: string
    token: string
    model: string
  } | null,
) {
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const payload = JSON.stringify(
    value
      ? {
          provider: value.provider,
          accountId: value.accountId,
          token: value.token,
          model: value.model,
        }
      : {},
  )
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-video-auth.sh",
    ],
    payload,
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing video setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write video auth")
  }
  return true
}

export async function syncModel3dAuth(
  userId: string,
  value: {
    provider: string
    accountId: string
    token: string
    model: string
  } | null,
) {
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const payload = JSON.stringify(
    value
      ? {
          provider: value.provider,
          accountId: value.accountId,
          token: value.token,
          model: value.model,
        }
      : {},
  )
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-model3d-auth.sh",
    ],
    payload,
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing model3d setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write model3d auth")
  }
  return true
}

export async function syncSystem1(
  userId: string,
  value: System1Provider | null,
) {
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const payload = JSON.stringify(
    value
      ? {
          provider: value.provider,
          endpoint: value.endpoint,
          model: value.model,
          apiKey: value.apiKey,
          gatewayToken: value.gatewayToken,
        }
      : {},
  )
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-system1.sh",
    ],
    payload,
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing system1 setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write system1 config")
  }
  return true
}

export type ChatKeyEntry = { slug: string; key: string }

export async function syncChatAuth(
  userId: string,
  auth: string,
  entries: ChatKeyEntry[],
  revoke: ChatKeyEntry[] = [],
): Promise<{ applied: boolean; changed: string[]; removed: string[] }> {
  const none = { applied: false, changed: [], removed: [] }
  if (entries.length === 0 && revoke.length === 0) return none
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return none
  const known = new Set<string>()
  try {
    const base = await endpoint(userId, "opencode", 4096)
    const response = await fetch(`${base}/provider`, {
      headers: { authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const body = (await response.json()) as { all?: { id?: string }[] }
      for (const item of body.all ?? []) {
        if (item.id) known.add(item.id)
      }
    }
  } catch {
    // catalog unreadable; sync by slug identity
  }
  const matches = (slug: string) => known.size === 0 || known.has(slug)
  const payloadEntries = entries
    .filter((item) => matches(item.slug))
    .map((item) => ({ provider: item.slug, key: item.key }))
  const payloadRevoke = revoke
    .filter((item) => matches(item.slug))
    .map((item) => ({ provider: item.slug, key: item.key }))
  if (payloadEntries.length === 0 && payloadRevoke.length === 0) return none
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-chat-auth.sh",
    ],
    JSON.stringify({ entries: payloadEntries, revoke: payloadRevoke }),
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing chat setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write chat auth")
  }
  let parsed: { changed?: string[]; removed?: string[] } = {}
  try {
    parsed = JSON.parse(result.stdout.trim() || "{}")
  } catch {
    parsed = {}
  }
  const changed = Array.isArray(parsed.changed) ? parsed.changed : []
  const removed = Array.isArray(parsed.removed) ? parsed.removed : []
  return { applied: changed.length > 0 || removed.length > 0, changed, removed }
}

export type PluginToolFile = {
  name: string
  content: string
  exec: boolean
}

// Install files into /usr/local/bin (root). The container's /usr/local is a
// named volume, so the files survive desktop restarts.
export async function syncPluginTools(
  userId: string,
  pluginId: string,
  files: PluginToolFile[],
) {
  const n = names(userId)
  if (files.length === 0) return false
  if (!(await isRunning(n.opencode))) return false
  for (const file of files) {
    if (!/^[\w.-]{1,64}$/.test(file.name)) {
      throw new HttpError(400, `invalid tool name: ${file.name}`, "plugin_tool")
    }
    const dir = mkdtempSync(join(tmpdir(), "ob-plugin-"))
    const local = join(dir, file.name)
    try {
      writeFileSync(local, file.content, { mode: 0o755 })
      const bin = `/usr/local/bin/ob-plugin-${pluginId}-${file.name}`
      const copied = await sh(
        ["docker", "cp", local, `${n.opencode}:${bin}`],
        undefined,
        60_000,
      )
      if (copied.code !== 0) {
        throw new HttpError(
          502,
          `could not install tool ${file.name}`,
          "plugin_tool",
        )
      }
      const chmod = await sh(
        ["docker", "exec", n.opencode, "chmod", file.exec ? "755" : "644", bin],
        undefined,
        60_000,
      )
      if (chmod.code !== 0) {
        throw new HttpError(
          502,
          `could not install tool ${file.name}`,
          "plugin_tool",
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return true
}

export async function removePluginTools(
  userId: string,
  pluginId: string,
  toolNames: string[],
) {
  const n = names(userId)
  if (toolNames.length === 0) return false
  for (const name of toolNames) {
    if (!/^[\w.-]{1,64}$/.test(name)) continue
    await sh([
      "docker",
      "exec",
      n.opencode,
      "rm",
      "-f",
      `/usr/local/bin/ob-plugin-${pluginId}-${name}`,
    ])
  }
  return true
}

// Fires after a desktop's opencode container is (re)created. Registered by the
// control server so plugins can re-apply their init commands; the container
// filesystem is wiped on recreate, so anything a plugin installed outside the
// /usr/local and /home volumes has to be redone.
let desktopReadyHook: ((userId: string) => Promise<void>) | null = null

export function onDesktopReady(hook: (userId: string) => Promise<void>) {
  desktopReadyHook = hook
}

export type PluginInitResult = {
  ran: boolean
  ok: boolean
  timedOut: boolean
  output: string
}

const PLUGIN_INIT_TIMEOUT_MS = 8 * 60_000
const PLUGIN_INIT_OUTPUT_LIMIT = 32 * 1024

// Run a plugin's setup commands as root inside the desktop. Output is appended
// to /home/agent/.open-bot/plugin-init/<pluginId>.log (on the home volume, so
// it survives desktop recreation). Commands must be idempotent: they run at
// install and again after every desktop recreate.
export async function runPluginInitCommands(
  userId: string,
  pluginId: string,
  commands: string[],
  label = "init",
): Promise<PluginInitResult> {
  if (commands.length === 0) {
    return { ran: false, ok: true, timedOut: false, output: "" }
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) {
    throw new HttpError(400, "invalid plugin id", "plugin_id")
  }
  const n = names(userId)
  if (!(await isRunning(n.opencode))) {
    return {
      ran: false,
      ok: false,
      timedOut: false,
      output: "desktop is not running",
    }
  }
  const echoed = commands.map((command) => command.replaceAll("\n", " "))
  const script = [
    "set -e -o pipefail",
    "mkdir -p /home/agent/.open-bot/plugin-init",
    `log=/home/agent/.open-bot/plugin-init/${pluginId}.log`,
    'exec > >(tee -a "$log") 2>&1',
    `echo "=== plugin ${pluginId} ${label} at $(date -Is) ==="`,
    ...commands.flatMap((command, index) => [
      `echo "+ ${echoed[index]}"`,
      command,
    ]),
    'echo "=== done ==="',
    "",
  ].join("\n")
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        "-e",
        "HOME=/home/agent",
        n.opencode,
        "bash",
        "-s",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
  } catch (caught) {
    return {
      ran: true,
      ok: false,
      timedOut: false,
      output:
        caught instanceof Error ? caught.message : "plugin setup failed to run",
    }
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {}
  }, PLUGIN_INIT_TIMEOUT_MS)
  let writeError: string | null = null
  try {
    const stdin = proc.stdin
    if (!stdin || typeof stdin === "number") {
      throw new Error("plugin setup failed to run")
    }
    stdin.write(script)
    await stdin.end()
  } catch (caught) {
    writeError =
      caught instanceof Error ? caught.message : "plugin setup failed to run"
  }
  try {
    const outStream = typeof proc.stdout === "number" ? null : proc.stdout
    const errStream = typeof proc.stderr === "number" ? null : proc.stderr
    const finished = Promise.all([
      readCapped(outStream, PLUGIN_INIT_OUTPUT_LIMIT),
      readCapped(errStream, PLUGIN_INIT_OUTPUT_LIMIT),
      proc.exited,
    ])
    const raced = await Promise.race([
      finished.then((value) => ({ done: true as const, value })),
      Bun.sleep(PLUGIN_INIT_TIMEOUT_MS + 5_000).then(() => ({
        done: false as const,
      })),
    ])
    if (!raced.done) {
      timedOut = true
      try {
        proc.kill()
      } catch {}
      return { ran: true, ok: false, timedOut: true, output: "" }
    }
    const [stdout, stderr, code] = raced.value
    const output = `${stdout}\n${stderr}`.trim()
    const ok = code === 0 && !timedOut
    if (ok) {
      // Plugin commands run as root; make sure anything they dropped into the
      // agent's own directories stays writable by the agent.
      sh(
        [
          "docker",
          "exec",
          n.opencode,
          "chown",
          "-R",
          "agent:agent",
          "/home/agent/workspace",
          "/home/agent/plugins-create",
        ],
        undefined,
        120_000,
      ).catch(() => {})
    }
    return {
      ran: true,
      ok,
      timedOut,
      output: writeError ? `${output}\n${writeError}`.trim() : output,
    }
  } catch (caught) {
    return {
      ran: true,
      ok: false,
      timedOut,
      output:
        writeError ??
        (caught instanceof Error ? caught.message : "plugin setup failed"),
    }
  } finally {
    clearTimeout(timer)
  }
}

// Write the plugin's merged config (vault grants + settings) into the desktop,
// following the apply-*.sh pattern. data: null removes the file.
export async function syncPluginAuth(
  userId: string,
  pluginId: string,
  data: Record<string, unknown> | null,
) {
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const result = await sh(
    [
      "docker",
      "exec",
      "-i",
      "-u",
      "agent",
      "-e",
      "HOME=/home/agent",
      n.opencode,
      "/opt/open-bot/apply-plugin-auth.sh",
    ],
    JSON.stringify({ file: `plugin-${pluginId}.json`, data: data ?? null }),
    120_000,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    if (/not found|No such file/i.test(detail)) {
      throw new Error(
        "desktop image is missing plugin setup. Rebuild images, then sleep and start the desktop.",
      )
    }
    throw new Error(detail || "could not write plugin config")
  }
  return true
}

// Persistent path (on the /home volume) of the instructions file a plugin's
// `opencode.agentsMd` text is written to; referenced from opencode.json's
// instructions array so it loads next to the seed AGENTS.md.
export function pluginAgentsMdPath(pluginId: string) {
  return `/home/agent/.config/open-bot/agents-md/plugin-${pluginId}.md`
}

// Write (or remove) a plugin's agentsMd instructions file in the desktop.
// data: null removes the file and prunes the directory best effort.
export async function syncPluginAgentsMd(
  userId: string,
  pluginId: string,
  text: string | null,
) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) {
    throw new HttpError(400, "invalid plugin id", "plugin_id")
  }
  const n = names(userId)
  const dir = "/home/agent/.config/open-bot/agents-md"
  const file = pluginAgentsMdPath(pluginId)
  if (!(await isRunning(n.opencode))) return false
  if (text === null) {
    await sh(["docker", "exec", n.opencode, "rm", "-f", file])
    await sh([
      "docker",
      "exec",
      n.opencode,
      "rmdir",
      "--ignore-fail-on-non-empty",
      dir,
    ]).catch(() => {})
    return true
  }
  if (!text.trim() || text.length > 4000) {
    throw new HttpError(400, "invalid agentsMd text", "plugin_agents_md")
  }
  const local = mkdtempSync(join(tmpdir(), "ob-agentsmd-"))
  const tmp = join(local, `plugin-${pluginId}.md`)
  try {
    writeFileSync(
      tmp,
      `<!-- open-bot plugin: ${pluginId} -->\n\n${text.trim()}\n`,
      { mode: 0o644 },
    )
    const wrote = await sh(
      [
        "docker",
        "exec",
        n.opencode,
        "mkdir",
        "-p",
        "--",
        "/home/agent/.config/open-bot/agents-md",
      ],
      undefined,
      60_000,
    )
    if (wrote.code !== 0) {
      throw new HttpError(
        502,
        "could not create the agents-md directory",
        "plugin_agents_md",
      )
    }
    const copied = await sh(
      ["docker", "cp", tmp, `${n.opencode}:${file}`],
      undefined,
      60_000,
    )
    if (copied.code !== 0) {
      throw new HttpError(
        502,
        "could not write the plugin instructions file",
        "plugin_agents_md",
      )
    }
    const chown = await sh(
      ["docker", "exec", n.opencode, "chown", "agent:agent", file],
      undefined,
      60_000,
    )
    if (chown.code !== 0) {
      throw new HttpError(
        502,
        "could not set the instructions file owner",
        "plugin_agents_md",
      )
    }
  } finally {
    rmSync(local, { recursive: true, force: true })
  }
  return true
}

// Boot-time companion of syncPluginAgentsMd: writes the file only when it is
// missing (fresh /home volume, install while the desktop was asleep). Returns
// true when the file was (re)created.
export async function ensurePluginAgentsMd(
  userId: string,
  pluginId: string,
  text: string,
): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId)) {
    throw new HttpError(400, "invalid plugin id", "plugin_id")
  }
  const n = names(userId)
  if (!(await isRunning(n.opencode))) return false
  const check = await sh([
    "docker",
    "exec",
    n.opencode,
    "test",
    "-f",
    pluginAgentsMdPath(pluginId),
  ])
  if (check.code === 0) return false
  await syncPluginAgentsMd(userId, pluginId, text)
  return true
}

// Merge (patch non-null) or remove (patch null) a plugin's OpenCode plugin
// packages, MCP servers, agent definitions, agent tool overrides, and
// instructions entries in the desktop's opencode.json. agents/agentTools use
// deep merges so patches to existing agents (e.g. tool denies on build)
// compose with each other; instructions is a set of file paths.
export async function syncOpencodePlugin(
  userId: string,
  patch: {
    addPlugins: string[]
    removePlugins: string[]
    addMcp: Record<string, unknown>
    removeMcp: string[]
    addAgents?: Record<string, Record<string, unknown>>
    removeAgents?: string[]
    addAgentTools?: Record<string, Record<string, boolean>>
    removeAgentTools?: Record<string, Record<string, boolean>>
    addInstructions?: string[]
    removeInstructions?: string[]
  } | null,
) {
  const n = names(userId)
  const empty =
    !patch ||
    (patch.addPlugins.length === 0 &&
      patch.removePlugins.length === 0 &&
      Object.keys(patch.addMcp).length === 0 &&
      patch.removeMcp.length === 0 &&
      Object.keys(patch.addAgents ?? {}).length === 0 &&
      (patch.removeAgents ?? []).length === 0 &&
      Object.keys(patch.addAgentTools ?? {}).length === 0 &&
      Object.keys(patch.removeAgentTools ?? {}).length === 0 &&
      (patch.addInstructions ?? []).length === 0 &&
      (patch.removeInstructions ?? []).length === 0)
  if (empty) return false
  if (!(await isRunning(n.opencode))) return false
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
  const program = [
    ".plugin = (((.plugin // []) + $addP) - $rmP | unique)",
    ".mcp = (((.mcp // {}) + $addM) | with_entries(select(.key as $k | ($rmM | index($k)) | not)))",
    ".agent = (((.agent // {}) * $addA) | with_entries(select(.key as $k | ($rmA | index($k)) | not)))",
    "reduce ($addT | keys_unsorted[]) as $n (.; (.agent[$n].tools) = (((.agent[$n].tools) // {}) + $addT[$n]))",
    "reduce ($rmT | keys_unsorted[]) as $n (.; if .agent[$n].tools then .agent[$n].tools = ((.agent[$n].tools) | with_entries(select(.key as $k | ($rmT[$n] | index($k)) | not))) | if (.agent[$n].tools | length) == 0 then del(.agent[$n].tools) else . end else . end)",
    ".instructions = (((.instructions // []) + $addI) - $rmI | unique)",
  ].join(" | ")
  const script = [
    "sh",
    "-c",
    `jq --argjson addP ${quote(JSON.stringify(patch.addPlugins))} --argjson rmP ${quote(JSON.stringify(patch.removePlugins))} --argjson addM ${quote(JSON.stringify(patch.addMcp))} --argjson rmM ${quote(JSON.stringify(patch.removeMcp))} --argjson addA ${quote(JSON.stringify(patch.addAgents ?? {}))} --argjson rmA ${quote(JSON.stringify(patch.removeAgents ?? []))} --argjson addT ${quote(JSON.stringify(patch.addAgentTools ?? {}))} --argjson rmT ${quote(JSON.stringify(patch.removeAgentTools ?? {}))} --argjson addI ${quote(JSON.stringify(patch.addInstructions ?? []))} --argjson rmI ${quote(JSON.stringify(patch.removeInstructions ?? []))} '${program}' $HOME/.config/opencode/opencode.json > /tmp/oc-plugin.json && mv /tmp/oc-plugin.json $HOME/.config/opencode/opencode.json`,
  ]
  const result = await sh([
    "docker",
    "exec",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    n.opencode,
    ...script,
  ])
  if (result.code !== 0) {
    throw new HttpError(
      502,
      result.stderr.trim() ||
        result.stdout.trim() ||
        "could not update the agent config",
      "opencode_plugin",
    )
  }
  return true
}

export async function desktopExec(
  userId: string,
  role: "opencode" | "computer",
  args: string[],
) {
  const n = names(userId)
  return sh(["docker", "exec", n[role], ...args])
}

export async function writeAgentUpload(
  userId: string,
  path: string,
  bytes: Uint8Array,
) {
  if (!isUploadPath(path))
    throw new HttpError(400, "invalid upload path", "invalid_upload")
  const n = names(userId)
  const dir = mkdtempSync(join(tmpdir(), "ob-join-"))
  const local = join(dir, "upload")
  try {
    writeFileSync(local, bytes)
    const made = await sh([
      "docker",
      "exec",
      "-u",
      "agent",
      n.opencode,
      "mkdir",
      "-p",
      "--",
      "/home/agent/workspace/uploads",
    ])
    if (made.code !== 0)
      throw new HttpError(502, "could not save the file", "upload_failed")
    const copied = await sh(["docker", "cp", local, `${n.opencode}:${path}`])
    if (copied.code !== 0)
      throw new HttpError(502, "could not save the file", "upload_failed")
    const owned = await sh([
      "docker",
      "exec",
      "-u",
      "root",
      n.opencode,
      "chown",
      "agent:agent",
      "--",
      path,
    ])
    if (owned.code !== 0)
      throw new HttpError(502, "could not save the file", "upload_failed")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function opencodeExec(userId: string, args: string[]) {
  const n = names(userId)
  return sh([
    "docker",
    "exec",
    "-u",
    "agent",
    "-e",
    "HOME=/home/agent",
    n.opencode,
    ...args,
  ])
}

export async function writeProjectFile(
  userId: string,
  path: string,
  bytes: Uint8Array,
) {
  if (!path.startsWith("/home/agent/workspace/"))
    throw new HttpError(400, "invalid project path", "invalid_path")
  const n = names(userId)
  const dir = mkdtempSync(join(tmpdir(), "ob-project-"))
  const local = join(dir, "file")
  try {
    writeFileSync(local, bytes)
    const parent = path.slice(0, path.lastIndexOf("/")) || "/"
    const made = await sh([
      "docker",
      "exec",
      "-u",
      "agent",
      n.opencode,
      "mkdir",
      "-p",
      "--",
      parent,
    ])
    if (made.code !== 0)
      throw new HttpError(502, "could not save the file", "write_failed")
    const copied = await sh(["docker", "cp", local, `${n.opencode}:${path}`])
    if (copied.code !== 0)
      throw new HttpError(502, "could not save the file", "write_failed")
    const owned = await sh([
      "docker",
      "exec",
      "-u",
      "root",
      n.opencode,
      "chown",
      "agent:agent",
      "--",
      path,
    ])
    if (owned.code !== 0)
      throw new HttpError(502, "could not save the file", "write_failed")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SCRIPT_READ_LIMIT = 16_001

async function readCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  max: number,
): Promise<string> {
  if (!stream) return ""
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || size >= max) continue
      const room = max - size
      chunks.push(value.byteLength > room ? value.subarray(0, room) : value)
      size += Math.min(value.byteLength, room)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function opencodeScript(
  userId: string,
  script: string,
  timeoutMs: number,
) {
  const n = names(userId)
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        "-u",
        "agent",
        "-e",
        "HOME=/home/agent",
        "-w",
        "/home/agent/workspace",
        n.opencode,
        "bash",
        "-s",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
  } catch (caught) {
    return {
      code: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError:
        caught instanceof Error ? caught.message : "script failed to start",
    }
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {}
  }, timeoutMs)
  let writeError: string | null = null
  try {
    const stdin = proc.stdin
    if (!stdin || typeof stdin === "number")
      throw new Error("script failed to start")
    stdin.write(script)
    await stdin.end()
  } catch (caught) {
    writeError =
      caught instanceof Error ? caught.message : "script failed to start"
  }
  const outStream = typeof proc.stdout === "number" ? null : proc.stdout
  const errStream = typeof proc.stderr === "number" ? null : proc.stderr
  try {
    const finished = Promise.all([
      readCapped(outStream, SCRIPT_READ_LIMIT),
      readCapped(errStream, SCRIPT_READ_LIMIT),
      proc.exited,
    ])
    const result = await Promise.race([
      finished.then((value) => ({ done: true as const, value })),
      Bun.sleep(timeoutMs + 5_000).then(() => ({ done: false as const })),
    ])
    if (!result.done) {
      timedOut = true
      try {
        proc.kill()
      } catch {}
      return {
        code: null,
        stdout: "",
        stderr: "",
        timedOut: true,
        spawnError: null,
      }
    }
    const [stdout, stderr, code] = result.value
    return {
      code,
      stdout,
      stderr,
      timedOut,
      spawnError: stdout || stderr ? null : writeError,
    }
  } catch (caught) {
    return {
      code: null,
      stdout: "",
      stderr: "",
      timedOut,
      spawnError:
        writeError ??
        (caught instanceof Error ? caught.message : "script failed to start"),
    }
  } finally {
    clearTimeout(timer)
  }
}
