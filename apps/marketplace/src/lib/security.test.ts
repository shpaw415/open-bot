import { describe, expect, test } from "bun:test"
import { gzipSync } from "node:zlib"
import {
  extractPayloadSources,
  GLM_REVIEW_MAX_TOKENS,
  glmReviewRequest,
  verdictFromModelResult,
} from "./security"

function tarEntry(path: string, content: string): Uint8Array[] {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const header = new Uint8Array(512)
  header.set(encoder.encode(path.slice(0, 100)), 0)
  header.set(
    encoder.encode(`${data.length.toString(8).padStart(11, "0")}\0`),
    124,
  )
  header[156] = 0x30 // '0' — regular file
  header.set(encoder.encode("ustar"), 257)
  const block = new Uint8Array(Math.ceil(data.length / 512) * 512 || 512)
  block.set(data)
  return [header, block]
}

function gzTar(files: [string, string][]): ArrayBuffer {
  const chunks = files.flatMap(([path, content]) => tarEntry(path, content))
  const tar = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    tar.set(chunk, offset)
    offset += chunk.length
  }
  const buf = gzipSync(tar)
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer
}

describe("security review model call", () => {
  test("asks for high reasoning and a json verdict", () => {
    const request = glmReviewRequest("review this plugin")
    expect(request.reasoning_effort).toBe("high")
    expect(request.max_completion_tokens).toBe(GLM_REVIEW_MAX_TOKENS)
    expect(request.max_tokens).toBe(GLM_REVIEW_MAX_TOKENS)
    expect(request).not.toHaveProperty("chat_template_kwargs")
    const format = request.response_format as {
      type: string
      json_schema: { name: string; schema: { required: string[] } }
    }
    expect(format.type).toBe("json_schema")
    expect(format.json_schema.name).toBe("security_verdict")
    expect(format.json_schema.schema.required).toContain("verdict")
  })

  test("reads a verdict from content and ignores reasoning prose", () => {
    const parsed = verdictFromModelResult({
      choices: [
        {
          finish_reason: "length",
          message: {
            content:
              '{"verdict":"concern","severity":"high","findings":[{"title":"pip install","severity":"medium","detail":"installs a package","path":"setup"}]}',
            reasoning_content: "still thinking about apt-get",
          },
        },
      ],
    })
    expect(parsed.verdict).toBe("concern")
    expect(parsed.exhausted).toBe(false)
    expect(parsed.findings).toHaveLength(1)
  })

  test("does not treat truncated reasoning as a verdict", () => {
    const parsed = verdictFromModelResult({
      choices: [
        {
          finish_reason: "length",
          message: {
            content: "",
            reasoning_content:
              'Let me analyze this plugin. The setup runs {"verdict":"pass"} but I have not finished.',
          },
        },
      ],
    })
    expect(parsed.verdict).toBe("invalid")
    expect(parsed.findings).toEqual([])
    expect(parsed.exhausted).toBe(true)
  })

  test("accepts the legacy response string", () => {
    const parsed = verdictFromModelResult({
      response: '{"verdict":"pass","severity":"low","findings":[]}',
    })
    expect(parsed.verdict).toBe("pass")
    expect(parsed.exhausted).toBe(false)
  })
})

describe("payload extraction", () => {
  test("pulls declared payload files out of the release tarball", async () => {
    const tarball = gzTar([
      ["weather-pro-1.0.0/README.md", "docs only"],
      [
        "weather-pro-1.0.0/tools/weather.sh",
        "#!/bin/sh\ncurl https://example.invalid\n",
      ],
      ["weather-pro-1.0.0/tools/other.py", "print('hi')\n"],
    ])
    const extracted = await extractPayloadSources(tarball, [
      "tools/weather.sh",
      "tools/other.py",
      "tools/missing.sh",
    ])
    expect(extracted.get("tools/weather.sh")).toContain("example.invalid")
    expect(extracted.get("tools/other.py")).toContain("print")
    expect(extracted.has("tools/missing.sh")).toBe(false)
    expect(extracted.has("README.md")).toBe(false)
  })

  test("pulls the repo-root CONFIG.md configuration guide from the tarball", async () => {
    const tarball = gzTar([
      ["weather-pro-1.0.0/README.md", "docs only"],
      [
        "weather-pro-1.0.0/CONFIG.md",
        "# Config guide\n\nAsk the user for the API key.\n",
      ],
    ])
    const extracted = await extractPayloadSources(tarball, ["CONFIG.md"])
    expect(extracted.get("CONFIG.md")).toContain("Ask the user")
  })

  test("returns empty for a corrupt tarball instead of throwing", async () => {
    const bogus = new TextEncoder().encode("not a gzip file at all")
    const extracted = await extractPayloadSources(
      bogus.buffer.slice(
        bogus.byteOffset,
        bogus.byteOffset + bogus.byteLength,
      ) as ArrayBuffer,
      ["tools/weather.sh"],
    )
    expect(extracted.size).toBe(0)
  })
})
