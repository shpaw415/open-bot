import { expect, test } from "bun:test"
import { type CdpSocket, evaluate, probeSnapshot } from "./cdp"

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
