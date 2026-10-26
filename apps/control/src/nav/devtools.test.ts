import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  consoleText,
  mergeNetworkEvent,
  type NetMap,
  readConsole,
  readNetwork,
  shapeConsole,
  shapeException,
  shapeLogEntry,
  staleRequests,
} from "./devtools"

afterAll(() => {
  rmSync(join(tmpdir(), "ob-devtools-test"), { recursive: true, force: true })
})

// ---- console shaping ----

test("console text joins primitives and object previews", () => {
  expect(
    consoleText([
      { type: "string", value: "hello" },
      { type: "number", value: 42 },
      { type: "object", description: "Object" },
      { type: "undefined" },
    ]),
  ).toBe("hello 42 Object ?")
  expect(consoleText([])).toBe("")
  expect(consoleText(undefined)).toBe("")
  expect(consoleText([{ value: { a: 1 } }])).toBe('{"a":1}')
  expect(
    consoleText([{ type: "string", value: "x".repeat(600) }]),
  ).toHaveLength(400)
})

test("console events carry the call site url and level", () => {
  const event = shapeConsole({
    type: "warning",
    args: [{ type: "string", value: "careful" }],
    stackTrace: { callFrames: [{ url: "https://a.test/app.js" }] },
  })
  expect(event).toEqual({
    ts: expect.any(Number),
    kind: "console",
    level: "warning",
    text: "careful",
    url: "https://a.test/app.js",
  })
})

test("exceptions prefer the error description and collapse whitespace", () => {
  const event = shapeException({
    exceptionDetails: {
      text: "Uncaught",
      url: "https://a.test/x.js",
      exception: { description: "TypeError:\n  cannot read\n  x" },
    },
  })
  expect(event.kind).toBe("error")
  if (event.kind !== "error") return
  expect(event.text).toBe("TypeError: cannot read x")
  expect(event.url).toBe("https://a.test/x.js")
})

test("browser log entries keep source and level", () => {
  expect(
    shapeLogEntry({
      entry: {
        level: "error",
        source: "network",
        text: "Failed to load resource",
        url: "https://a.test/missing.js",
      },
    }),
  ).toEqual({
    ts: expect.any(Number),
    kind: "log",
    level: "error",
    source: "network",
    text: "Failed to load resource",
    url: "https://a.test/missing.js",
  })
})

// ---- network merging ----

function request(
  map: NetMap,
  id: string,
  url = "https://a.test/api",
): "queued" {
  expect(
    mergeNetworkEvent(map, "Network.requestWillBeSent", {
      requestId: id,
      type: "XHR",
      request: { method: "GET", url, headers: { "x-a": "1" } },
    }),
  ).toBeNull()
  return "queued"
}

test("a request folds response and finish into one record", () => {
  const map: NetMap = new Map()
  request(map, "r1")
  expect(map.get("r1")?.status).toBeUndefined()
  expect(
    mergeNetworkEvent(map, "Network.responseReceived", {
      requestId: "r1",
      response: {
        status: 200,
        mimeType: "application/json",
        headers: { "content-type": "application/json" },
      },
    }),
  ).toBeNull()
  expect(map.get("r1")?.status).toBe(200)
  const final = mergeNetworkEvent(map, "Network.loadingFinished", {
    requestId: "r1",
    encodedDataLength: 512,
  })
  expect(final?.kind).toBe("request")
  if (final?.kind !== "request") return
  expect(final.bytes).toBe(512)
  expect(final.ms).toBeGreaterThanOrEqual(0)
  // Removed from the map so a second finish cannot double-write.
  expect(map.has("r1")).toBe(false)
  expect(
    mergeNetworkEvent(map, "Network.loadingFinished", { requestId: "r1" }),
  ).toBeNull()
})

test("failures and redirects fold into the record", () => {
  const map: NetMap = new Map()
  request(map, "r2", "https://a.test/404")
  expect(
    mergeNetworkEvent(map, "Network.loadingFailed", {
      requestId: "r2",
      errorText: "net::ERR_FAILED",
    }),
  ).toMatchObject({ fail: "net::ERR_FAILED" })

  const redirects: NetMap = new Map()
  request(redirects, "r3", "https://a.test/final")
  expect(
    mergeNetworkEvent(redirects, "Network.requestWillBeSent", {
      requestId: "r3",
      redirectResponse: { status: 302, mimeType: "text/html" },
      request: { method: "GET", url: "https://a.test/final", headers: {} },
    }),
  ).toBeNull()
  expect(redirects.get("r3")).toMatchObject({
    status: 302,
    redirects: 1,
    url: "https://a.test/final",
  })
})

test("events for unknown request ids are ignored", () => {
  const map: NetMap = new Map()
  expect(
    mergeNetworkEvent(map, "Network.responseReceived", {
      requestId: "ghost",
      response: { status: 200 },
    }),
  ).toBeNull()
  expect(
    mergeNetworkEvent(map, "Network.loadingFinished", { requestId: "ghost" }),
  ).toBeNull()
})

test("stale requests flush once and stay mergeable", () => {
  const map: NetMap = new Map()
  request(map, "r4")
  const seeded = map.get("r4")
  if (seeded) seeded.ts -= 20_000
  const flushed = staleRequests(map, Date.now())
  expect(flushed).toHaveLength(1)
  expect(flushed[0].flushed).toBe(true)
  expect(staleRequests(map, Date.now())).toHaveLength(0)
  // A late completion still writes the final line; the reader folds by id.
  expect(
    mergeNetworkEvent(map, "Network.loadingFinished", {
      requestId: "r4",
      encodedDataLength: 10,
    }),
  ).toMatchObject({ bytes: 10 })
})

// ---- buffered reads ----

const dir = mkdtempSync(join(tmpdir(), "ob-devtools-test-"))

function writeEvents(name: string, lines: unknown[]) {
  const file = join(dir, name)
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"))
  return file
}

test("console reads fold kinds into level rows with filters", () => {
  const file = writeEvents("console.jsonl", [
    { ts: 1, kind: "console", level: "log", text: "one", url: "a" },
    { ts: 2, kind: "error", text: "boom", url: "b" },
    { ts: 3, kind: "console", level: "error", text: "two", url: "c" },
    { ts: 4, kind: "log", level: "error", text: "net", url: "d" },
    { ts: 5, kind: "request", id: "r", method: "GET", url: "x", type: "" },
    "not json",
  ])
  expect(readConsole(file, "", 10)).toEqual([
    { n: 1, level: "log", text: "one", url: "a" },
    { n: 2, level: "error", text: "boom", url: "b" },
    { n: 3, level: "error", text: "two", url: "c" },
    { n: 4, level: "error", text: "net", url: "d" },
  ])
  expect(readConsole(file, "error", 10)).toEqual([
    { n: 1, level: "error", text: "boom", url: "b" },
    { n: 2, level: "error", text: "two", url: "c" },
    { n: 3, level: "error", text: "net", url: "d" },
  ])
  expect(readConsole(file, "", 2)).toEqual([
    { n: 1, level: "error", text: "two", url: "c" },
    { n: 2, level: "error", text: "net", url: "d" },
  ])
  expect(readConsole(join(dir, "missing.jsonl"), "", 10)).toEqual([])
})

test("network reads fold duplicate ids to the last line and filter", () => {
  const file = writeEvents("network.jsonl", [
    {
      ts: 1,
      kind: "request",
      id: "a",
      method: "GET",
      url: "https://a.test/api",
      type: "XHR",
      flushed: true,
    },
    {
      ts: 2,
      kind: "request",
      id: "b",
      method: "GET",
      url: "https://b.test/x",
      type: "Image",
    },
    {
      ts: 3,
      kind: "request",
      id: "a",
      method: "GET",
      url: "https://a.test/api",
      type: "XHR",
      status: 200,
      bytes: 9,
      ms: 40,
    },
    { ts: 4, kind: "console", level: "log", text: "noise", url: "" },
  ])
  const rows = readNetwork(file, "", 10)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ id: "a", status: 200, bytes: 9, ms: 40 })
  expect(rows[1]).toMatchObject({ id: "b" })
  expect(readNetwork(file, "b.test", 10)).toHaveLength(1)
  expect(readNetwork(file, "", 1)[0].id).toBe("b")
  expect(readNetwork(join(dir, "missing.jsonl"), "", 10)).toEqual([])
})
