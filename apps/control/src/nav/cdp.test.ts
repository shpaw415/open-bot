import { expect, test } from "bun:test"
import {
  type CdpSocket,
  captureMarked,
  clearMarksScript,
  evaluate,
  MARK_ROOT_ID,
  markScript,
  probeSnapshot,
} from "./cdp"

function socket(results: unknown[]): CdpSocket {
  const queue = [...results]
  return {
    async call() {
      return queue.shift()
    },
    close() {},
  }
}

test("evaluate surfaces the real page error, not bare Uncaught", async () => {
  const fake = socket([
    {
      exceptionDetails: {
        text: "Uncaught",
        exception: {
          className: "SecurityError",
          description: "SecurityError: Blocked a frame with origin",
        },
      },
    },
  ])
  let message = ""
  try {
    await evaluate(fake, "1 + 1")
  } catch (error) {
    message = error instanceof Error ? error.message : ""
  }
  expect(message).toBe("page error: SecurityError: Blocked a frame with origin")
})

test("evaluate falls back to the exception text", async () => {
  const fake = socket([{ exceptionDetails: { text: "Uncaught" } }])
  await expect(evaluate(fake, "1 + 1")).rejects.toThrow("page error: Uncaught")
})

test("mark script stamps indexes and names the cleanup root", () => {
  const script = markScript([
    { index: "3", targetId: "n9" },
    { index: '1"<', targetId: "n1" },
  ])
  expect(script).toContain(MARK_ROOT_ID)
  expect(script).toContain('"index":"3"')
  expect(script).toContain('"targetId":"n9"')
  expect(script).not.toContain('1"<')
  expect(clearMarksScript()).toBe(
    `document.getElementById(${JSON.stringify(MARK_ROOT_ID)})?.remove()`,
  )
})

test("captureMarked returns null and still clears badges when the shot fails", async () => {
  const calls: string[] = []
  const fake: CdpSocket = {
    async call(method, params) {
      calls.push(method)
      if (method === "Page.captureScreenshot") throw new Error("shot failed")
      if (method === "Runtime.evaluate") {
        const expression = (params as { expression?: string }).expression ?? ""
        if (expression.includes(MARK_ROOT_ID))
          return { result: { value: true } }
        return { result: { value: true } }
      }
      return {}
    },
    close() {},
  }
  expect(await captureMarked(fake, [{ index: "1", targetId: "n1" }])).toBeNull()
  expect(calls).toContain("Page.captureScreenshot")
  expect(calls.filter((method) => method === "Runtime.evaluate").length).toBe(2)
})

test("captureMarked returns jpeg bytes and skips an empty mark list", async () => {
  const shots: Record<string, unknown>[] = []
  const fake: CdpSocket = {
    async call(method, params) {
      if (method === "Page.captureScreenshot") {
        shots.push(params ?? {})
        return { data: "  abc  " }
      }
      if (method === "Runtime.evaluate") return { result: { value: true } }
      return {}
    },
    close() {},
  }
  expect(await captureMarked(fake, [])).toBeNull()
  expect(shots).toEqual([])
  expect(await captureMarked(fake, [{ index: "2", targetId: "n2" }])).toBe(
    "abc",
  )
  expect(shots).toEqual([{ format: "jpeg", quality: 60, fromSurface: true }])
})

test("probeSnapshot retries once after a failed probe", async () => {
  let evaluateCalls = 0
  const fake: CdpSocket = {
    async call(_method, params) {
      const expression = (params as { expression?: string }).expression ?? ""
      if (!expression.startsWith("(() => {")) return {}
      evaluateCalls += 1
      if (evaluateCalls === 1) {
        return {
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "x" },
          },
        }
      }
      return { result: { value: { url: "https://ebay.test/", title: "ok" } } }
    },
    close() {},
  }
  const snapshot = await probeSnapshot(fake)
  expect(evaluateCalls).toBe(2)
  expect(snapshot.url).toBe("https://ebay.test/")
  expect(snapshot.title).toBe("ok")
})
