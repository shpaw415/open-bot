import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type Desktop,
  type ImageProvider,
  type System1Provider,
  type VikingProvider,
  vikingProviderReady,
} from "@open-bot/db"
import { manualPackages } from "./apt-snapshot"
import {
  computerImage,
  controlName,
  inDocker,
  maxDesktops,
  names,
  opencodeImage,
  vikingImage,
} from "./env"
import { HttpError } from "./http-error"
import { imageAuthReady } from "./image-providers"
import { docker, sh } from "./shell"
import { ensureVikingUser, vikingUserKey } from "./viking-user"

const starting = new Map<string, Promise<void>>()
const startErrors = new Map<string, string>()

export function startError(userId: string) {
  return startErrors.get(userId) ?? ""
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
  const exists = await sh(["docker", "network", "inspect", network])
  if (exists.code !== 0) await docker(["network", "create", network])
  const gateway = (
    await docker([
      "network",
      "inspect",
      "-f",
      "{{(index .IPAM.Config 0).Gateway}}",
      network,
    ])
  ).trim()
  gatewayCache.set(network, gateway)
  if (inDocker && controlName) {
    const connected = await sh([
      "docker",
      "network",
      "inspect",
      network,
      "-f",
      "{{range $k, $v := .Containers}}{{$v.Name}} {{end}}",
    ])
    if (!connected.stdout.includes(controlName)) {
      await docker([
        "network",
        "connect",
        "--alias",
        "open-bot",
        network,
        controlName,
      ])
    }
  }
}

async function ensureVolume(name: string) {
  const exists = await sh(["docker", "volume", "inspect", name])
  if (exists.code !== 0) await docker(["volume", "create", name])
}

async function captureAptSnapshot(container: string, homeVolume: string) {
  const exists = await sh(["docker", "inspect", container])
  if (exists.code !== 0) return
  const dir = mkdtempSync(join(tmpdir(), "ob-apt-"))
  try {
    const copied = await sh([
      "docker",
      "cp",
      `${container}:/var/lib/apt/extended_states`,
      join(dir, "extended_states"),
    ])
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
  const result = await sh(["docker", "image", "inspect", image])
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
  const result = await sh([
    "docker",
    "inspect",
    "-f",
    "{{.State.Running}}",
    name,
  ])
  return result.code === 0 && result.stdout.trim() === "true"
}

export async function containerIp(name: string, network: string) {
  const ip = (
    await docker([
      "inspect",
      "-f",
      `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
      name,
    ])
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
  await docker(["run", "-d", "--label", "open-bot=1", ...args])
}

export async function startDesktop(
  userId: string,
  desktop: Desktop,
  viking: VikingProvider | null,
  image: ImageProvider | null = null,
  system1: System1Provider | null = null,
) {
  const existing = starting.get(userId)
  if (existing) return existing
  startErrors.delete(userId)
  const job = startDesktopInner(userId, desktop, viking, image, system1)
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
    await sh(["docker", "rm", "-f", n.viking])
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
    await sh(["docker", "rm", "-f", n.opencode])
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
    600000,
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
      await syncSystem1(userId, system1)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("missing system1 setup")) throw error
    }
  }

  if (!(await isRunning(n.computer))) {
    await sh(["docker", "rm", "-f", n.computer])
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
}

export async function stopDesktop(userId: string) {
  const n = names(userId)
  await sh(["docker", "stop", "-t", "5", n.computer])
  await sh(["docker", "stop", "-t", "30", n.opencode])
  await sh(["docker", "stop", "-t", "15", n.viking])
}

export async function destroyDesktop(userId: string) {
  const n = names(userId)
  await sh(["docker", "rm", "-f", n.computer, n.opencode, n.viking])
  const volumes = await sh([
    "docker",
    "volume",
    "rm",
    "-f",
    n.home,
    n.usrLocal,
    n.vikingData,
    n.x11,
  ])
  if (volumes.code !== 0) {
    throw new Error(volumes.stderr.trim() || "could not remove desktop volumes")
  }
  await sh(["docker", "network", "rm", n.network])
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

export async function restartOpencode(userId: string) {
  const n = names(userId)
  await sh([
    "docker",
    "exec",
    n.opencode,
    "pkill",
    "-TERM",
    "-f",
    "opencode serve",
  ])
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

export async function desktopExec(
  userId: string,
  role: "opencode" | "computer",
  args: string[],
) {
  const n = names(userId)
  return sh(["docker", "exec", n[role], ...args])
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
