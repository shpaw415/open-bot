#!/usr/bin/env bun
import { mkdirSync } from "node:fs"

const home = process.env.HOME ?? "/home/agent"
const configDir = `${home}/.config/open-bot`
const gatewayId = process.env.OPEN_BOT_VIDEO_GATEWAY ?? "home-ai"

type Marker = { provider: string; model: string }
type Auth = { accountId?: string | null; token: string }

const IMAGE_MODEL_PATTERN =
  /(grok-imagine-image|dall-e|gpt-image|imagen|flux|stable-?diffusion|sdxl|sd3)/i

const PROVIDER_VIDEO_PATTERN: Record<string, RegExp> = {
  xai: /^grok-imagine-video/i,
  "xai-gateway": /^grok-imagine-video/i,
  openai: /^sora/i,
  google: /veo/i,
  replicate:
    /(veo|kling|wan[/~-]|minimax\/video|luma|ltx|hunyuan|pika|video-)/i,
  fal: /(veo|kling|wan[/~-]|minimax|luma|ltx|hunyuan|pika|video)/i,
}

const MODEL_CATALOG: Record<string, string[]> = {
  xai: [
    "grok-imagine-video-1.5",
    "grok-imagine-video",
    "grok-imagine-video-1.5-lite",
  ],
  "xai-gateway": [
    "grok-imagine-video-1.5",
    "grok-imagine-video",
    "grok-imagine-video-1.5-lite",
  ],
  openai: ["sora-2", "sora-2-pro"],
  google: [
    "veo-3.0-generate-001",
    "veo-3.0-fast-generate-001",
    "veo-2.0-generate-001",
  ],
  replicate: [
    "google/veo-3-fast",
    "minimax/video-01",
    "wan-video/wan-2.2-t2v-fast",
  ],
  fal: ["fal-ai/veo3", "fal-ai/kling-video/v2/master/text-to-video"],
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function rejectImageModel(provider: string, model: string): never {
  fail(
    `'${model}' is an image model, not a video model. Video models for ${provider}: ${(MODEL_CATALOG[provider] ?? []).join(", ")}. Retry with --model <video-model>.`,
  )
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T
  } catch {
    return null
  }
}

async function saveVideo(bytes: Uint8Array, out: string) {
  let target = out
  if (!target) {
    mkdirSync(`${home}/workspace`, { recursive: true })
    target = `${home}/workspace/gen-video-${Date.now()}.mp4`
  }
  await Bun.write(target, bytes)
  console.log(`saved ${target}`)
}

async function download(
  url: string,
  headers: Record<string, string>,
  out: string,
) {
  const res = await fetch(url, { headers })
  if (!res.ok) fail(`video download failed (${res.status})`)
  await saveVideo(new Uint8Array(await res.arrayBuffer()), out)
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  hint?: string,
  timeoutMs?: number,
): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let message = `video request failed (${res.status}): ${text.slice(0, 500)}`
    if (res.status === 404 && hint) message += `\nhint: ${hint}`
    fail(message)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`invalid JSON from provider: ${text.slice(0, 200)}`)
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<any> {
  const res = await fetch(url, { headers })
  const text = await res.text()
  if (!res.ok) {
    fail(`video poll failed (${res.status}): ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`invalid JSON from provider: ${text.slice(0, 200)}`)
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function viaXai(
  prompt: string,
  model: string,
  auth: Auth,
  seconds: string,
  out: string,
  provider: string,
) {
  const headers = { authorization: `Bearer ${auth.token}` }
  const base =
    provider === "xai-gateway"
      ? `https://gateway.ai.cloudflare.com/v1/${auth.accountId ?? ""}/${gatewayId}/xai`
      : "https://api.x.ai/v1"
  const body: Record<string, unknown> = { model, prompt }
  if (seconds) body.duration = Number.parseInt(seconds, 10)
  const start = await postJson(
    `${base}/videos/generations`,
    headers,
    body,
    `model '${model}' was not found on this provider (404). Run 'gen-video models --probe' to test which models work, or retry with --model <name>.`,
  )
  const id = start?.request_id
  if (typeof id !== "string" || id === "") fail("video request has no id")
  const deadline = Date.now() + 15 * 60_000
  let current = start
  while (
    current?.status &&
    !["done", "failed", "expired"].includes(current.status) &&
    Date.now() < deadline
  ) {
    await sleep(5000)
    current = await getJson(`${base}/videos/${id}`, headers)
  }
  if (current?.status !== "done") {
    const detail = current?.error?.message ?? current?.status ?? "unknown"
    fail(`video job ${detail}`)
  }
  const url = current?.video?.url
  if (typeof url !== "string" || url === "") fail("no video in response")
  await download(url, {}, out)
}

async function viaOpenai(
  prompt: string,
  model: string,
  auth: Auth,
  seconds: string,
  out: string,
) {
  const headers = { authorization: `Bearer ${auth.token}` }
  const body: Record<string, unknown> = { model, prompt }
  if (seconds) body.seconds = seconds
  const job = await postJson("https://api.openai.com/v1/videos", headers, body)
  const id = job?.id
  if (typeof id !== "string" || id === "") fail("video job has no id")
  const deadline = Date.now() + 15 * 60_000
  let current = job
  while (
    current?.status &&
    !["completed", "failed", "cancelled"].includes(current.status) &&
    Date.now() < deadline
  ) {
    await sleep(10_000)
    current = await getJson(`https://api.openai.com/v1/videos/${id}`, headers)
  }
  if (current?.status !== "completed") {
    const detail = current?.error?.message ?? current?.status ?? "unknown"
    fail(`video job ${detail}`)
  }
  const res = await fetch(`https://api.openai.com/v1/videos/${id}/content`, {
    headers,
  })
  if (!res.ok) fail(`video download failed (${res.status})`)
  await saveVideo(new Uint8Array(await res.arrayBuffer()), out)
}

async function viaGoogle(
  prompt: string,
  model: string,
  auth: Auth,
  out: string,
) {
  const headers = { "x-goog-api-key": auth.token }
  const start = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`,
    headers,
    { instances: [{ prompt }] },
  )
  const name = start?.name
  if (typeof name !== "string" || name === "") fail("operation has no name")
  const deadline = Date.now() + 10 * 60_000
  let operation = start
  while (!operation?.done && Date.now() < deadline) {
    await sleep(10_000)
    operation = await getJson(
      `https://generativelanguage.googleapis.com/v1beta/${name}`,
      headers,
    )
  }
  if (!operation?.done)
    fail(`operation ${operation?.done === false ? "timed out" : "failed"}`)
  if (operation?.error)
    fail(`video job failed: ${JSON.stringify(operation.error).slice(0, 300)}`)
  const response = operation?.response
  const uri =
    response?.generatedVideos?.[0]?.video?.uri ??
    response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  if (typeof uri !== "string" || uri === "") {
    fail("no video in response")
  }
  await download(uri, headers, out)
}

async function viaReplicate(
  prompt: string,
  model: string,
  auth: Auth,
  out: string,
) {
  const headers = {
    authorization: `Bearer ${auth.token}`,
    prefer: "wait",
  }
  let prediction = await postJson(
    `https://api.replicate.com/v1/models/${model}/predictions`,
    headers,
    { input: { prompt } },
  )
  const deadline = Date.now() + 10 * 60_000
  while (
    prediction?.status &&
    !["succeeded", "failed", "canceled"].includes(prediction.status) &&
    Date.now() < deadline
  ) {
    await sleep(5000)
    const pollUrl = prediction?.urls?.get
    if (typeof pollUrl !== "string") fail("prediction has no poll url")
    const res = await fetch(pollUrl, {
      headers: { authorization: `Bearer ${auth.token}` },
    })
    if (!res.ok) fail(`prediction poll failed (${res.status})`)
    prediction = await res.json()
  }
  if (prediction?.status !== "succeeded") {
    fail(`prediction ${prediction?.status ?? "unknown"}`)
  }
  const output = Array.isArray(prediction.output)
    ? prediction.output[prediction.output.length - 1]
    : prediction.output
  if (typeof output !== "string" || output === "") {
    fail("no video in response")
  }
  await download(output, {}, out)
}

async function viaFal(prompt: string, model: string, auth: Auth, out: string) {
  const headers = { authorization: `Key ${auth.token}` }
  const queued = await postJson(`https://queue.fal.run/${model}`, headers, {
    prompt,
  })
  const statusUrl = queued?.status_url
  const responseUrl = queued?.response_url
  if (typeof statusUrl !== "string" || typeof responseUrl !== "string") {
    fail("queue response has no status url")
  }
  const deadline = Date.now() + 15 * 60_000
  let status: string | undefined = queued?.status
  while (status !== "COMPLETED" && Date.now() < deadline) {
    await sleep(5000)
    status = (await getJson(statusUrl, headers))?.status
  }
  if (status !== "COMPLETED") fail("video job timed out")
  const payload = await getJson(responseUrl, headers)
  if (payload?.error) {
    fail(`video job failed: ${JSON.stringify(payload.error).slice(0, 300)}`)
  }
  const url = payload?.video?.url ?? payload?.video_url ?? payload?.url
  if (typeof url !== "string" || url === "") fail("no video in response")
  await download(url, {}, out)
}

function usage(): never {
  fail(
    'usage: gen-video "prompt" [-o out.mp4] [--seconds 4|8|12] [--model name]\n       gen-video models [--probe]',
  )
}

function providerBase(provider: string, auth: Auth | null): string {
  if (provider === "xai-gateway") {
    return `https://gateway.ai.cloudflare.com/v1/${auth?.accountId ?? ""}/${gatewayId}/xai`
  }
  if (provider === "xai") return "https://api.x.ai/v1"
  if (provider === "openai") return "https://api.openai.com/v1"
  if (provider === "google") {
    return "https://generativelanguage.googleapis.com/v1beta"
  }
  if (provider === "replicate") return "https://api.replicate.com/v1"
  if (provider === "fal") return "https://queue.fal.run"
  return ""
}

function probeHeaders(provider: string, auth: Auth): Record<string, string> {
  if (provider === "google") return { "x-goog-api-key": auth.token }
  if (provider === "fal") return { authorization: `Key ${auth.token}` }
  return { authorization: `Bearer ${auth.token}` }
}

function probeBody(provider: string, model: string) {
  if (provider === "google") {
    return { instances: [{ prompt: "probe" }] }
  }
  if (provider === "openai") {
    return { model, prompt: "probe", seconds: "4" }
  }
  if (provider === "xai" || provider === "xai-gateway") {
    return { model, prompt: "probe", duration: 1 }
  }
  if (provider === "replicate") {
    return { input: { prompt: "probe" } }
  }
  return { prompt: "probe" }
}

function probeUrl(provider: string, model: string, base: string): string {
  if (provider === "google") {
    return `${base}/models/${model}:predictLongRunning`
  }
  if (provider === "replicate") {
    return `${base}/models/${model}/predictions`
  }
  if (provider === "fal") return `${base}/${model}`
  if (provider === "openai") return `${base}/videos`
  return `${base}/videos/generations`
}

async function probeModel(
  provider: string,
  model: string,
  auth: Auth,
): Promise<string> {
  const base = providerBase(provider, auth)
  const url = probeUrl(provider, model, base)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...probeHeaders(provider, auth),
      },
      body: JSON.stringify(probeBody(provider, model)),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) return "available (a real 1-clip test job was started)"
    if (res.status === 404) return "unavailable (404 not found)"
    if (res.status === 401 || res.status === 403) {
      fail(
        `probe rejected for auth reasons (${res.status}) — check the video key on the config page`,
      )
    }
    const text = await res.text()
    return `inconclusive (${res.status}): ${text.slice(0, 120)}`
  } catch (error) {
    return `inconclusive (${error instanceof Error ? error.message : "network error"})`
  }
}

async function listModels() {
  const marker = await readJson<Marker>(`${configDir}/video.json`)
  if (!marker?.provider || !marker.model) {
    fail("no video provider configured on the config page")
  }
  const provider = marker.provider
  const catalog = MODEL_CATALOG[provider]
  if (!catalog) fail(`unsupported video provider: ${provider}`)
  const probe = process.argv.includes("--probe")
  console.log(`provider ${provider}`)
  if (IMAGE_MODEL_PATTERN.test(marker.model)) {
    console.log(
      `configured model ${marker.model} is an image model — pick a video model below and retry with --model <name> or save it on the config page`,
    )
  } else {
    console.log(`configured model ${marker.model}`)
  }
  console.log("video models:")
  for (const model of catalog) {
    const mark = model === marker.model ? "  (configured)" : ""
    console.log(`  ${model}${mark}`)
  }
  if (!probe) {
    console.log(
      "run 'gen-video models --probe' to test them against the provider",
    )
    return
  }
  const auth = await readJson<Auth>(`${configDir}/video-auth.json`)
  if (!auth?.token) fail("missing video credentials for probing")
  console.log(
    "probe results (an available model starts a real test generation):",
  )
  for (const model of catalog) {
    const verdict = await probeModel(provider, model, auth)
    console.log(`  ${model}  ${verdict}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "models") {
    await listModels()
    return
  }
  let prompt = ""
  let out = ""
  let seconds = ""
  let override = ""
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      out = args[++i] ?? ""
    } else if (args[i] === "--seconds") {
      seconds = args[++i] ?? ""
    } else if (args[i] === "--model") {
      override = args[++i] ?? ""
    } else if (prompt === "") {
      prompt = args[i]
    }
  }
  if (prompt.trim() === "") usage()
  const marker = await readJson<Marker>(`${configDir}/video.json`)
  if (!marker?.provider || !marker.model) {
    fail("no video provider configured on the config page")
  }
  const provider = marker.provider
  const model = override.trim() || marker.model
  if (!(provider in PROVIDER_VIDEO_PATTERN)) {
    fail(`unsupported video provider: ${provider}`)
  }
  if (IMAGE_MODEL_PATTERN.test(model)) {
    rejectImageModel(provider, model)
  }
  if (!(PROVIDER_VIDEO_PATTERN[provider] ?? /.*/).test(model)) {
    console.error(
      `warning: '${model}' does not look like a ${provider} video model; trying anyway. Run 'gen-video models --probe' to test models.`,
    )
  }
  const auth = await readJson<Auth>(`${configDir}/video-auth.json`)
  switch (provider) {
    case "xai":
    case "xai-gateway": {
      if (!auth?.token) fail("missing video credentials")
      if (provider === "xai-gateway" && !auth.accountId) {
        fail("missing video credentials")
      }
      await viaXai(prompt, model, auth, seconds, out, provider)
      return
    }
    case "openai": {
      if (!auth?.token) fail("missing video credentials")
      await viaOpenai(prompt, model, auth, seconds, out)
      return
    }
    case "google": {
      if (!auth?.token) fail("missing video credentials")
      await viaGoogle(prompt, model, auth, out)
      return
    }
    case "replicate": {
      if (!auth?.token) fail("missing video credentials")
      await viaReplicate(prompt, model, auth, out)
      return
    }
    case "fal": {
      if (!auth?.token) fail("missing video credentials")
      await viaFal(prompt, model, auth, out)
      return
    }
    default:
      fail(`unsupported video provider: ${provider}`)
  }
}

await main()
