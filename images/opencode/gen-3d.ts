#!/usr/bin/env bun
import { mkdirSync, renameSync, writeFileSync } from "node:fs"

const home = process.env.HOME ?? "/home/agent"
const configDir = `${home}/.config/open-bot`
const jobsPath = `${home}/.open-bot/gen-3d-jobs.json`

type Marker = { provider: string; model: string }
type Auth = { accountId?: string | null; token: string }

type JobStatus = "running" | "success" | "failed" | "timeout"

type Job = {
  id: string
  provider: string
  prompt: string
  model: string
  out: string
  status: JobStatus
  resultUrl?: string
  statusUrl?: string
  responseUrl?: string
  submittedAt: number
  updatedAt: number
}

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

async function loadJobs(): Promise<Job[]> {
  const data = await readJson<{ jobs?: Job[] }>(jobsPath)
  return Array.isArray(data?.jobs) ? data.jobs : []
}

// Atomic: a crash mid-write never truncates the journal the resume path
// depends on.
function saveJobs(jobs: Job[]) {
  mkdirSync(`${home}/.open-bot`, { recursive: true })
  const tmp = `${jobsPath}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ jobs }, null, 2)}\n`)
  renameSync(tmp, jobsPath)
}

async function upsertJob(job: Job) {
  const jobs = (await loadJobs()).filter((row) => row.id !== job.id)
  jobs.push(job)
  saveJobs(jobs)
}

function jobArgument(value: string | undefined, command: string): string {
  const id = (value ?? "").trim()
  if (!id) fail(`usage: gen-3d ${command} JOB_ID [-o out.glb]`)
  return id
}

async function findJob(id: string): Promise<Job> {
  const job = (await loadJobs()).find((row) => row.id === id)
  if (!job)
    fail(`no gen-3d job ${id} — run \`gen-3d status\` to list submitted jobs`)
  return job
}

function defaultOut(job: Job): string {
  if (job.out) return job.out
  mkdirSync(`${home}/workspace`, { recursive: true })
  return `${home}/workspace/gen-3d-${job.id}.glb`
}

async function saveModel(bytes: Uint8Array, out: string) {
  await Bun.write(out, bytes)
  console.log(`saved ${out}`)
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

type Submitted = {
  id: string
  statusUrl?: string
  responseUrl?: string
  instantUrl?: string
}

function requireToken(auth: Auth | null): asserts auth is Auth {
  if (!auth?.token) fail("missing 3d credentials")
}

async function submitProvider(
  provider: string,
  prompt: string,
  model: string,
  auth: Auth,
): Promise<Submitted> {
  const headers = { authorization: `Bearer ${auth.token}` }
  if (provider === "meshy") {
    const body: Record<string, unknown> = { mode: "preview", prompt }
    if (model && model !== "latest") body.ai_model = model
    const start = await postJson(
      "https://api.meshy.ai/openapi/v2/text-to-3d",
      headers,
      body,
    )
    const id = start?.result ?? start?.id
    if (typeof id !== "string" || id === "") fail("3d job has no id")
    return { id }
  }
  if (provider === "tripo") {
    const start = await postJson(
      "https://api.tripo3d.ai/v2/openapi/task",
      headers,
      { type: "text_to_model", prompt },
    )
    const id = start?.data?.task_id ?? start?.task_id
    if (typeof id !== "string" || id === "") fail("3d job has no id")
    return { id }
  }
  if (provider === "replicate") {
    const prediction = await postJson(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      { ...headers, prefer: "wait" },
      { input: { prompt } },
    )
    const id = prediction?.id
    if (typeof id !== "string" || id === "") fail("3d job has no id")
    const output = Array.isArray(prediction.output)
      ? prediction.output[prediction.output.length - 1]
      : prediction.output
    return {
      id,
      instantUrl: typeof output === "string" ? output : undefined,
    }
  }
  if (provider === "fal") {
    const queued = await postJson(
      `https://queue.fal.run/${model}`,
      {
        authorization: `Key ${auth.token}`,
      },
      { prompt },
    )
    const statusUrl = queued?.status_url
    const responseUrl = queued?.response_url
    if (typeof statusUrl !== "string" || typeof responseUrl !== "string") {
      fail("queue response has no status url")
    }
    const id =
      typeof queued?.request_id === "string" ? queued.request_id : statusUrl
    return { id, statusUrl, responseUrl }
  }
  fail(`unsupported 3d model provider: ${provider}`)
}

// One provider poll. Returns the provider's terminal status ("" when still
// running) and the model url when it succeeded.
async function pollProvider(
  job: Job,
  auth: Auth,
): Promise<{ done: boolean; status: string; url?: string }> {
  const headers = { authorization: `Bearer ${auth.token}` }
  if (job.provider === "meshy") {
    const current = await getJson(
      `https://api.meshy.ai/openapi/v2/text-to-3d/${job.id}`,
      headers,
    )
    const status = String(current?.status ?? "")
    const done = ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(status)
    const url = current?.model_urls?.glb
    return { done, status, url: typeof url === "string" ? url : undefined }
  }
  if (job.provider === "tripo") {
    const current = await getJson(
      `https://api.tripo3d.ai/v2/openapi/task/${job.id}`,
      headers,
    )
    const status = String(current?.data?.status ?? "")
    const done = [
      "success",
      "failed",
      "cancelled",
      "unknown",
      "banned",
    ].includes(status)
    const url = current?.data?.output?.pbr_model ?? current?.data?.output?.model
    return { done, status, url: typeof url === "string" ? url : undefined }
  }
  if (job.provider === "replicate") {
    const prediction = await getJson(
      `https://api.replicate.com/v1/predictions/${job.id}`,
      headers,
    )
    const status = String(prediction?.status ?? "")
    const output = Array.isArray(prediction.output)
      ? prediction.output[prediction.output.length - 1]
      : prediction.output
    return {
      done: ["succeeded", "failed", "canceled"].includes(status),
      status,
      url: typeof output === "string" ? output : undefined,
    }
  }
  if (job.provider === "fal") {
    if (!job.statusUrl || !job.responseUrl)
      fail(`job ${job.id} stored no fal queue urls — it cannot be polled`)
    const keyHeaders = { authorization: `Key ${auth.token}` }
    const status = String(
      (await getJson(job.statusUrl, keyHeaders))?.status ?? "",
    )
    if (status !== "COMPLETED") return { done: false, status }
    const payload = await getJson(job.responseUrl, keyHeaders)
    if (payload?.error) {
      return { done: true, status: "failed" }
    }
    const url =
      payload?.model_mesh?.url ??
      payload?.model_urls?.glb ??
      payload?.mesh_url ??
      payload?.model_url ??
      payload?.url
    return {
      done: true,
      status,
      url: typeof url === "string" ? url : undefined,
    }
  }
  return fail(`unsupported 3d model provider: ${job.provider}`)
}

const RESUME_DEADLINES: Record<string, number> = {
  fal: 15 * 60_000,
}
const RESUME_DEFAULT_DEADLINE = 10 * 60_000

// Persist-first job run: the record is written before the first poll so an
// interruption always leaves a resumable id behind.
async function runJob(job: Job, auth: Auth | null, wait: boolean) {
  const deadline =
    Date.now() + (RESUME_DEADLINES[job.provider] ?? RESUME_DEFAULT_DEADLINE)
  let current = {
    done: false,
    status: job.status === "running" ? "running" : job.status,
    url: job.resultUrl,
  }
  while (!current.done) {
    if (!wait && job.status !== "running") break
    if (!auth?.token) fail("missing 3d credentials")
    if (Date.now() >= deadline) {
      job.status = "timeout"
      job.updatedAt = Date.now()
      await upsertJob(job)
      fail(
        `3d job ${job.id} timed out — resume later with \`gen-3d resume ${job.id}\``,
      )
    }
    await sleep(5000)
    current = await pollProvider(job, auth)
  }
  job.status =
    current.status === "success" ||
    current.status === "SUCCEEDED" ||
    current.status === "succeeded" ||
    current.status === "COMPLETED"
      ? "success"
      : "failed"
  if (current.url) job.resultUrl = current.url
  job.updatedAt = Date.now()
  await upsertJob(job)
  if (job.status !== "success") {
    fail(`3d job ${current.status || job.status}`)
  }
  if (!job.resultUrl) fail("no model in response")
  await download(job.resultUrl, job.out)
}

async function listJobs() {
  const jobs = (await loadJobs()).sort((a, b) => b.submittedAt - a.submittedAt)
  if (jobs.length === 0) {
    console.log("(no gen-3d jobs)")
    return
  }
  for (const job of jobs) {
    const age = Math.round((Date.now() - job.submittedAt) / 60_000)
    console.log(
      `[${job.id}] ${job.provider} ${job.status} ${age}m ago ${job.out} — ${job.prompt.slice(0, 60)}`,
    )
  }
}

async function showJob(id: string, auth: Auth | null) {
  const job = await findJob(id)
  if (job.status === "running" && auth?.token) {
    // Live refresh: one poll updates the stored status instead of reporting a
    // possibly stale "running".
    try {
      const current = await pollProvider(job, auth)
      if (current.done) {
        job.status =
          current.status === "success" ||
          current.status === "SUCCEEDED" ||
          current.status === "succeeded" ||
          current.status === "COMPLETED"
            ? "success"
            : "failed"
        if (current.url) job.resultUrl = current.url
        job.updatedAt = Date.now()
        await upsertJob(job)
      }
    } catch {
      // The stored status stands when the provider is unreachable.
    }
  }
  console.log(
    `[${job.id}] ${job.provider} ${job.status}\nprompt: ${job.prompt}\noutput: ${job.out}\nsubmitted: ${new Date(job.submittedAt).toISOString()}`,
  )
  if (job.resultUrl) console.log(`result: ${job.resultUrl}`)
  if (job.status === "success")
    console.log(`download with: gen-3d download ${job.id}`)
  else if (job.status === "running")
    console.log(`resume with: gen-3d resume ${job.id}`)
}

async function downloadJob(id: string, out: string, auth: Auth | null) {
  const job = await findJob(id)
  const target = out || defaultOut(job)
  if (job.status === "running")
    fail(`job ${id} is still running — check \`gen-3d status ${id}\``)
  if (job.status !== "success") fail(`job ${id} ${job.status}`)
  if (job.resultUrl) {
    await download(job.resultUrl, target)
    return
  }
  // Older record without a stored url: ask the provider once.
  requireToken(auth)
  const current = await pollProvider(job, auth)
  if (!current.url) fail(`no model url for ${id}`)
  job.resultUrl = current.url
  job.updatedAt = Date.now()
  await upsertJob(job)
  await download(current.url, target)
}

async function resumeJob(id: string, out: string, auth: Auth | null) {
  const job = await findJob(id)
  job.out = out || defaultOut(job)
  if (job.status === "success") {
    await downloadJob(id, out, auth)
    return
  }
  if (job.status !== "running")
    fail(`job ${id} ${job.status} — resubmit instead`)
  await runJob(job, auth, true)
}

// Credential bridge: runs the desktop's tripo CLI with the vaulted provider
// key injected as TRIPO_API_KEY. The key is never printed and never lands in
// a config file, so rig/retarget/anim reuse the gen-3d configuration without
// a separate login.
async function runTripoBridge(args: string[], auth: Auth | null) {
  requireToken(auth)
  const proc = Bun.spawn(["tripo", ...args], {
    env: { ...process.env, TRIPO_API_KEY: auth.token },
    stdio: ["inherit", "inherit", "inherit"],
  })
  process.exit(await proc.exited)
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] ?? ""
  const rest = args.slice(1)
  let prompt = ""
  let out = ""
  const parseOutput = (list: string[]) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === "-o" || list[i] === "--output") out = list[++i] ?? ""
    }
  }
  if (command === "status") {
    const auth = await readJson<Auth>(`${configDir}/model3d-auth.json`)
    const id = rest[0]
    if (id) await showJob(id, auth)
    else await listJobs()
    return
  }
  if (command === "download" || command === "resume") {
    const id = jobArgument(rest[0], command)
    parseOutput(rest.slice(1))
    const auth = await readJson<Auth>(`${configDir}/model3d-auth.json`)
    if (command === "download") await downloadJob(id, out, auth)
    else await resumeJob(id, out, auth)
    return
  }
  if (command === "tripo") {
    if (rest.length === 0)
      fail(
        "usage: gen-3d tripo <tripo-cli args> — e.g. gen-3d tripo anim rig --help",
      )
    const marker = await readJson<Marker>(`${configDir}/model3d.json`)
    if (marker?.provider !== "tripo")
      fail(
        `the tripo bridge needs the tripo 3d provider configured (current: ${marker?.provider ?? "none"})`,
      )
    const auth = await readJson<Auth>(`${configDir}/model3d-auth.json`)
    await runTripoBridge(rest, auth)
    return
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      out = args[++i] ?? ""
    } else if (prompt === "") {
      prompt = args[i]
    }
  }
  if (prompt.trim() === "") {
    fail(
      'usage: gen-3d "prompt" [-o out.glb] | gen-3d status [ID] | gen-3d download ID [-o out.glb] | gen-3d resume ID [-o out.glb] | gen-3d tripo <args>',
    )
  }
  const marker = await readJson<Marker>(`${configDir}/model3d.json`)
  if (!marker?.provider || !marker.model) {
    fail(
      "no 3d model provider configured — build the part with gpio-3d instead",
    )
  }
  const auth = await readJson<Auth>(`${configDir}/model3d-auth.json`)
  requireToken(auth)
  const provider = marker.provider
  if (!["meshy", "tripo", "replicate", "fal"].includes(provider)) {
    fail(`unsupported 3d model provider: ${provider}`)
  }
  const submitted = await submitProvider(provider, prompt, marker.model, auth)
  const job: Job = {
    id: submitted.id,
    provider,
    prompt,
    model: marker.model,
    out: out || `${home}/workspace/gen-3d-${Date.now()}.glb`,
    status: "running",
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
    resultUrl: submitted.instantUrl,
    submittedAt: Date.now(),
    updatedAt: Date.now(),
  }
  if (submitted.instantUrl) {
    job.status = "success"
    job.resultUrl = submitted.instantUrl
    job.updatedAt = Date.now()
    await upsertJob(job)
    await download(submitted.instantUrl, job.out)
    console.log(
      `job ${job.id} — re-download anytime with \`gen-3d download ${job.id}\``,
    )
    return
  }
  // Journal before the first poll: an interruption leaves a resumable id.
  await upsertJob(job)
  await runJob(job, auth, true)
  console.log(
    `job ${job.id} — re-download anytime with \`gen-3d download ${job.id}\``,
  )
}

await main()
