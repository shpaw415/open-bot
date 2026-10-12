import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  askSystem1,
  noteSystem1,
  readSystem1Config,
  redactText,
  System1Error,
} from "./client"

const HOME = "/tmp/opencode/client-test-home"

const auth = {
  endpoint: "https://system1.test/v1/systemone",
  apiKey: "test-key",
  gatewayToken: "",
  model: "clef",
  provider: "cloudflare-clef",
}

function jsonFetch(responses: Response[]) {
  let calls = 0
  const attempts: { body: string }[] = []
  const fetchImpl = (async (_url: any, init?: any) => {
    attempts.push({ body: String(init?.body ?? "") })
    const response = responses[Math.min(calls, responses.length - 1)]
    calls += 1
    return response
  }) as unknown as typeof fetch
  return { fetchImpl, attempts, count: () => calls }
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

const input = {
  state: "state text",
  questions: {
    q1: { type: "choice", instructions: "pick", criteria: { a: "a", b: "b" } },
  },
}

test("askSystem1 unwraps answers and reports timing", async () => {
  const fake = jsonFetch([
    ok({ result: { answers: { q1: { choice: "a", confidence: 0.9 } } } }),
  ])
  const outcome = await askSystem1(auth, input, fake.fetchImpl)
  expect(fake.count()).toBe(1)
  expect(outcome.http).toBe(200)
  expect(outcome.answers.q1).toEqual({ choice: "a", confidence: 0.9 })
  expect(outcome.ms).toBeGreaterThanOrEqual(0)
  expect(fake.attempts[0].body).toContain('"state":"state text"')
  expect(fake.attempts[0].body).toContain('"model":"clef"')
})

test("askSystem1 reads Jev top-level envelopes too", async () => {
  const fake = jsonFetch([ok({ answers: { q1: { choice: "b" } } })])
  const outcome = await askSystem1(auth, input, fake.fetchImpl)
  expect(outcome.answers.q1).toEqual({ choice: "b" })
})

test("askSystem1 fails fast on 4xx with a redacted body", async () => {
  const fake = jsonFetch([
    new Response(JSON.stringify({ error: "bad key sk-abcdefgh12345678" }), {
      status: 401,
    }),
  ])
  let attempts = 0
  try {
    await askSystem1(auth, input, ((url: any, init: any) => {
      attempts += 1
      return fake.fetchImpl(url, init)
    }) as unknown as typeof fetch)
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(System1Error)
    expect((error as System1Error).http).toBe(401)
    expect((error as System1Error).message).toBe("decision HTTP 401")
    expect((error as System1Error).detail).toBe(
      '{"error":"bad key [redacted]"}',
    )
  }
  expect(attempts).toBe(1)
})

test("askSystem1 retries 5xx once and then succeeds", async () => {
  const fake = jsonFetch([
    new Response("boom", { status: 500 }),
    ok({ answers: { q1: { choice: "a" } } }),
  ])
  const seen: number[] = []
  const outcome = await askSystem1(
    auth,
    {
      ...input,
      onAttempt: (attempt) => seen.push(attempt.http),
    },
    fake.fetchImpl,
  )
  expect(fake.count()).toBe(2)
  expect(seen).toEqual([500])
  expect(outcome.answers.q1).toEqual({ choice: "a" })
})

test("askSystem1 retries network errors and reports the last one", async () => {
  const fetchImpl = (async () => {
    throw new Error(`Unable to connect to ${auth.endpoint}`)
  }) as unknown as typeof fetch
  let attempts = 0
  try {
    await askSystem1(
      auth,
      {
        ...input,
        onAttempt: (attempt) => {
          attempts += 1
          expect(attempt.http).toBe(0)
        },
      },
      fetchImpl,
    )
    expect.unreachable()
  } catch (error) {
    expect((error as System1Error).http).toBe(0)
    expect((error as System1Error).message).toBe(
      "Unable to connect to endpoint",
    )
  }
  expect(attempts).toBe(2)
})

test("askSystem1 treats a 200 junk body as an immediate invalid response", async () => {
  const fake = jsonFetch([new Response("<html>portal</html>", { status: 200 })])
  try {
    await askSystem1(auth, input, fake.fetchImpl)
    expect.unreachable()
  } catch (error) {
    expect((error as System1Error).message).toBe("invalid response")
  }
  expect(fake.count()).toBe(1)
})

test("readSystem1Config reads both files and fills defaults", () => {
  mkdirSync(`${HOME}/.config/open-bot`, { recursive: true })
  writeFileSync(
    `${HOME}/.config/open-bot/system1.json`,
    JSON.stringify({
      endpoint: "https://x.test/v1/systemone",
      provider: "laya",
    }),
  )
  writeFileSync(
    `${HOME}/.config/open-bot/system1-auth.json`,
    JSON.stringify({ apiKey: "k-2" }),
  )
  const config = readSystem1Config(HOME)
  expect(config).toEqual({
    endpoint: "https://x.test/v1/systemone",
    model: "",
    provider: "laya",
    apiKey: "k-2",
    gatewayToken: "",
  })
})

test("readSystem1Config returns null without a config", () => {
  expect(readSystem1Config("/tmp/opencode/definitely-missing-home")).toBeNull()
})

test("noteSystem1 creates the log directory and appends rows", () => {
  const fresh = "/tmp/opencode/client-test-note-home"
  mkdirSync(fresh, { recursive: true })
  noteSystem1(fresh, { cli: true, ms: 12, http: 200 })
  const log = Bun.file(`${fresh}/.open-bot/system1.log`)
  return log.text().then((text) => {
    expect(text).toContain('"cli":true')
    expect(text).toContain('"ms":12')
  })
})

test("redactText strips credentials", () => {
  expect(redactText("Bearer abc.def and sk-abcdefgh12345678")).toBe(
    "Bearer [redacted] and [redacted]",
  )
})

test("askSystem1 sniffs a 200 HTML body into the error detail", async () => {
  const fake = jsonFetch([
    new Response("<html>login page</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  ])
  try {
    await askSystem1(auth, input, fake.fetchImpl)
    expect.unreachable()
  } catch (error) {
    const err = error as System1Error
    expect(err.message).toBe("invalid response")
    expect(err.detail).toContain("not JSON")
    expect(err.detail).toContain("text/html")
    expect(err.detail).toContain("login page")
  }
  expect(fake.count()).toBe(1)
})

test("askSystem1 reports a JSON body without an answers object", async () => {
  const fake = jsonFetch([
    new Response(JSON.stringify({ result: { nope: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ])
  try {
    await askSystem1(auth, input, fake.fetchImpl)
    expect.unreachable()
  } catch (error) {
    const err = error as System1Error
    expect(err.detail).toContain("no answers object")
    expect(err.detail).toContain("application/json")
  }
})

test("redactText covers unquoted and space-separated credential layouts", () => {
  expect(redactText('api_key "SK-SECRET-DO-NOT-LEAK"')).toBe(
    'api_key "[redacted]"',
  )
  expect(redactText("token=supersecret9")).toBe("token=[redacted]")
  expect(redactText("apikey:AbCdEf123456 END")).toBe("apikey:[redacted] END")
  expect(redactText("Sk-abcdef123456 rest")).toBe("[redacted] rest")
  // ordinary JSON fields survive
  expect(redactText('{"error":"unauthorized"}')).toBe(
    '{"error":"unauthorized"}',
  )
})
