#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { join } from "node:path"

const home = process.env.HOME ?? "/home/agent"
const configDir = `${home}/.config/open-bot`
const gatewayId = process.env.OPEN_BOT_IMAGE_GATEWAY ?? "home-ai"
let cutout = false

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

function extFromMime(mime: string | null): string {
  if (!mime) return "png"
  if (mime.includes("jpeg")) return "jpg"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("gif")) return "gif"
  return "png"
}

function extFromBase64(data: string): string {
  if (data.startsWith("iVBOR")) return "png"
  if (data.startsWith("/9j/")) return "jpg"
  if (data.startsWith("UklGR")) return "webp"
  if (data.startsWith("R0lGOD")) return "gif"
  return "png"
}

async function saveImage(bytes: Uint8Array, ext: string, out: string) {
  let target = out
  if (!target) {
    mkdirSync(`${home}/workspace`, { recursive: true })
    target = `${home}/workspace/gen-image-${Date.now()}.${ext}`
  }
  await Bun.write(target, bytes)
  await deliver(target)
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
    fail(`image request failed (${res.status}): ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`invalid JSON from provider: ${text.slice(0, 200)}`)
  }
}

async function saveDataEntry(entry: any, out: string) {
  if (typeof entry?.b64_json === "string" && entry.b64_json !== "") {
    await saveImage(
      Buffer.from(entry.b64_json, "base64"),
      extFromBase64(entry.b64_json),
      out,
    )
    return
  }
  if (typeof entry?.url === "string" && entry.url !== "") {
    const res = await fetch(entry.url)
    if (!res.ok) fail(`image download failed (${res.status})`)
    await saveImage(
      new Uint8Array(await res.arrayBuffer()),
      extFromMime(res.headers.get("content-type")),
      out,
    )
    return
  }
  fail("no image in response")
}

async function viaCfAi(prompt: string, model: string, out: string) {
  mkdirSync(`${home}/workspace`, { recursive: true })
  const ext = model.includes("klein") ? "jpg" : "png"
  const target = out || `${home}/workspace/gen-image-${Date.now()}.${ext}`
  const proc = Bun.spawn(
    ["cf-ai", "image", prompt, "--model", model, "-o", target],
    {
      stdout: cutout ? "pipe" : "inherit",
      stderr: "inherit",
    },
  )
  const [code] = await Promise.all([
    proc.exited,
    cutout ? new Response(proc.stdout).text() : Promise.resolve(""),
  ])
  if (code !== 0) fail(`cf-ai image failed (${code})`)
  await deliver(target)
}

function pngOut(path: string) {
  if (path.toLowerCase().endsWith(".png")) return path
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  const dot = path.lastIndexOf(".")
  if (dot > slash) return `${path.slice(0, dot)}.png`
  return `${path}.png`
}

function defringeCommand() {
  const beside = join(import.meta.dir, "defringe.py")
  if (existsSync(beside)) return ["python3", beside]
  return ["defringe"]
}

async function applyCutout(path: string) {
  const target = pngOut(path)
  const proc = Bun.spawn([...defringeCommand(), path, "-o", target], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
    new Response(proc.stdout).text(),
  ])
  if (code !== 0) fail(stderr.trim() || `defringe failed (${code})`)
  if (target !== path) await unlink(path).catch(() => {})
  return target
}

async function deliver(path: string) {
  const target = cutout ? await applyCutout(path) : path
  console.log(`saved ${target}`)
}

async function main() {
  const args = process.argv.slice(2)
  let prompt = ""
  let out = ""
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cutout") {
      cutout = true
    } else if (args[i] === "-o" || args[i] === "--output") {
      out = args[++i] ?? ""
    } else if (prompt === "") {
      prompt = args[i]
    }
  }
  if (prompt.trim() === "") {
    fail('usage: gen-image "prompt" [-o out.png] [--cutout]')
  }
  const marker = await readJson<Marker>(`${configDir}/image.json`)
  if (!marker?.provider || !marker.model) {
    fail("no image provider configured on the config page")
  }
  const auth = await readJson<Auth>(`${configDir}/image-auth.json`)
  const model = marker.model
  switch (marker.provider) {
    case "cloudflare-workers-ai": {
      await viaCfAi(prompt, model, out)
      return
    }
    case "xai":
    case "xai-gateway": {
      if (!auth?.token) fail("missing image credentials")
      const url =
        marker.provider === "xai"
          ? "https://api.x.ai/v1/images/generations"
          : `https://gateway.ai.cloudflare.com/v1/${auth.accountId ?? ""}/${gatewayId}/xai/images/generations`
      const data = await postJson(
        url,
        { authorization: `Bearer ${auth.token}` },
        { model, prompt, response_format: "b64_json", n: 1 },
      )
      await saveDataEntry(data?.data?.[0], out)
      return
    }
    case "openai": {
      if (!auth?.token) fail("missing image credentials")
      const data = await postJson(
        "https://api.openai.com/v1/images/generations",
        { authorization: `Bearer ${auth.token}` },
        { model, prompt, n: 1 },
      )
      await saveDataEntry(data?.data?.[0], out)
      return
    }
    case "google": {
      if (!auth?.token) fail("missing image credentials")
      if (model.startsWith("imagen")) {
        const data = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
          { "x-goog-api-key": auth.token },
          { instances: [{ prompt }], parameters: { sampleCount: 1 } },
        )
        const pred = data?.predictions?.[0]
        const b64 = pred?.bytesBase64Encoded
        if (typeof b64 !== "string" || b64 === "") {
          fail("no image in response")
        }
        await saveImage(
          Buffer.from(b64, "base64"),
          extFromMime(pred?.mimeType ?? null),
          out,
        )
      } else {
        const data = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { "x-goog-api-key": auth.token },
          { contents: [{ parts: [{ text: prompt }] }] },
        )
        const parts = data?.candidates?.[0]?.content?.parts ?? []
        const inline = parts
          .map((part: any) => part?.inlineData)
          .find((item: any) => typeof item?.data === "string")
        if (!inline) fail("no image in response")
        await saveImage(
          Buffer.from(inline.data, "base64"),
          extFromMime(inline.mimeType ?? null),
          out,
        )
      }
      return
    }
    case "stability": {
      if (!auth?.token) fail("missing image credentials")
      const form = new FormData()
      form.set("prompt", prompt)
      form.set("output_format", "png")
      let endpoint = "core"
      if (model === "ultra") {
        endpoint = "ultra"
      } else if (model.startsWith("sd3")) {
        endpoint = "sd3"
        form.set("model", model)
      }
      const res = await fetch(
        `https://api.stability.ai/v2beta/stable-image/generate/${endpoint}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.token}`,
            accept: "image/*",
          },
          body: form,
        },
      )
      if (!res.ok) {
        const text = await res.text()
        fail(`image request failed (${res.status}): ${text.slice(0, 500)}`)
      }
      await saveImage(
        new Uint8Array(await res.arrayBuffer()),
        extFromMime(res.headers.get("content-type")),
        out,
      )
      return
    }
    case "replicate": {
      if (!auth?.token) fail("missing image credentials")
      const headers = {
        authorization: `Bearer ${auth.token}`,
        prefer: "wait",
      }
      let prediction = await postJson(
        `https://api.replicate.com/v1/models/${model}/predictions`,
        headers,
        { input: { prompt } },
      )
      const deadline = Date.now() + 90_000
      while (
        prediction?.status &&
        !["succeeded", "failed", "canceled"].includes(prediction.status) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
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
        ? prediction.output[0]
        : prediction.output
      if (typeof output !== "string" || output === "") {
        fail("no image in response")
      }
      if (output.startsWith("data:")) {
        const b64 = output.slice(output.indexOf(",") + 1)
        await saveImage(Buffer.from(b64, "base64"), extFromBase64(b64), out)
        return
      }
      const res = await fetch(output)
      if (!res.ok) fail(`image download failed (${res.status})`)
      await saveImage(
        new Uint8Array(await res.arrayBuffer()),
        extFromMime(res.headers.get("content-type")),
        out,
      )
      return
    }
    default:
      fail(`unsupported image provider: ${marker.provider}`)
  }
}

await main()
