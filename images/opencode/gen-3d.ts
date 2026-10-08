#!/usr/bin/env bun
import { mkdirSync } from "node:fs"

const home = process.env.HOME ?? "/home/agent"
const configDir = `${home}/.config/open-bot`

type Marker = { provider: string; model: string }
type Auth = { accountId?: string | null; token: string }

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T
  } catch {
    return null
  }
}

async function saveModel(bytes: Uint8Array, out: string) {
  let target = out
  if (!target) {
    mkdirSync(`${home}/workspace`, { recursive: true })
    target = `${home}/workspace/gen-3d-${Date.now()}.glb`
  }
  await Bun.write(target, bytes)
  console.log(`saved ${target}`)
}

async function download(url: string, out: string) {
  const res = await fetch(url)
  if (!res.ok) fail(`model download failed (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 12) fail("model download is empty")
  await saveModel(bytes, out)
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    fail(`3d request failed (${res.status}): ${text.slice(0, 500)}`)
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
    fail(`3d poll failed (${res.status}): ${text.slice(0, 500)}`)
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

async function viaMeshy(
  prompt: string,
  model: string,
  auth: Auth,
  out: string,
) {
  const headers = { authorization: `Bearer ${auth.token}` }
  const body: Record<string, unknown> = { mode: "preview", prompt }
  if (model && model !== "latest") body.ai_model = model
  const start = await postJson(
    "https://api.meshy.ai/openapi/v2/text-to-3d",
    headers,
    body,
  )
  const id = start?.result ?? start?.id
  if (typeof id !== "string" || id === "") fail("3d job has no id")
  const deadline = Date.now() + 10 * 60_000
  let current: any = null
  while (Date.now() < deadline) {
    await sleep(5000)
    current = await getJson(
      `https://api.meshy.ai/openapi/v2/text-to-3d/${id}`,
      headers,
    )
    if (
      ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(current?.status)
    )
      break
  }
  if (current?.status !== "SUCCEEDED") {
    const detail = current?.texture_error ?? current?.status ?? "timed out"
    fail(`3d job ${detail}`)
  }
  const url = current?.model_urls?.glb
  if (typeof url !== "string" || url === "") fail("no model in response")
  await download(url, out)
}

async function viaTripo(prompt: string, auth: Auth, out: string) {
  const headers = { authorization: `Bearer ${auth.token}` }
  const start = await postJson(
    "https://api.tripo3d.ai/v2/openapi/task",
    headers,
    { type: "text_to_model", prompt },
  )
  const id = start?.data?.task_id ?? start?.task_id
  if (typeof id !== "string" || id === "") fail("3d job has no id")
  const deadline = Date.now() + 10 * 60_000
  let current: any = null
  while (Date.now() < deadline) {
    await sleep(5000)
    current = await getJson(
      `https://api.tripo3d.ai/v2/openapi/task/${id}`,
      headers,
    )
    if (
      ["success", "failed", "cancelled", "unknown", "banned"].includes(
        current?.data?.status,
      )
    )
      break
  }
  if (current?.data?.status !== "success") {
    const detail = current?.data?.status ?? "timed out"
    fail(`3d job ${detail}`)
  }
  const url = current?.data?.output?.pbr_model ?? current?.data?.output?.model
  if (typeof url !== "string" || url === "") fail("no model in response")
  await download(url, out)
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
    fail("no model in response")
  }
  await download(output, out)
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
  if (status !== "COMPLETED") fail("3d job timed out")
  const payload = await getJson(responseUrl, headers)
  if (payload?.error) {
    fail(`3d job failed: ${JSON.stringify(payload.error).slice(0, 300)}`)
  }
  const url =
    payload?.model_mesh?.url ??
    payload?.model_urls?.glb ??
    payload?.mesh_url ??
    payload?.model_url ??
    payload?.url
  if (typeof url !== "string" || url === "") fail("no model in response")
  await download(url, out)
}

async function main() {
  const args = process.argv.slice(2)
  let prompt = ""
  let out = ""
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      out = args[++i] ?? ""
    } else if (prompt === "") {
      prompt = args[i]
    }
  }
  if (prompt.trim() === "") {
    fail('usage: gen-3d "prompt" [-o out.glb]')
  }
  const marker = await readJson<Marker>(`${configDir}/model3d.json`)
  if (!marker?.provider || !marker.model) {
    fail(
      "no 3d model provider configured — build the part with gpio-3d instead",
    )
  }
  const auth = await readJson<Auth>(`${configDir}/model3d-auth.json`)
  const model = marker.model
  switch (marker.provider) {
    case "meshy": {
      if (!auth?.token) fail("missing 3d credentials")
      await viaMeshy(prompt, model, auth, out)
      return
    }
    case "tripo": {
      if (!auth?.token) fail("missing 3d credentials")
      await viaTripo(prompt, auth, out)
      return
    }
    case "replicate": {
      if (!auth?.token) fail("missing 3d credentials")
      await viaReplicate(prompt, model, auth, out)
      return
    }
    case "fal": {
      if (!auth?.token) fail("missing 3d credentials")
      await viaFal(prompt, model, auth, out)
      return
    }
    default:
      fail(`unsupported 3d model provider: ${marker.provider}`)
  }
}

await main()
