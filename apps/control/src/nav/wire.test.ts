import { expect, test } from "bun:test"
import { decisionBody, providerHasVision, unwrapAnswers } from "./wire"

test("unwrapAnswers reads Jev and Laya top-level answers", () => {
  const raw = { answers: { operation: { choice: "CLICK", confidence: 0.9 } } }
  expect(unwrapAnswers(raw)).toEqual({
    operation: { choice: "CLICK", confidence: 0.9 },
  })
})

test("unwrapAnswers unwraps the Workers AI result envelope", () => {
  const raw = { result: { answers: { q1: { choice: "b" } } } }
  expect(unwrapAnswers(raw)).toEqual({ q1: { choice: "b" } })
})

test("unwrapAnswers rejects junk", () => {
  expect(unwrapAnswers(null)).toBeNull()
  expect(unwrapAnswers("nope")).toBeNull()
  expect(unwrapAnswers({})).toBeNull()
  expect(unwrapAnswers({ result: { other: 1 } })).toBeNull()
  expect(unwrapAnswers({ answers: "not an object" })).toBeNull()
})

test("providerHasVision covers only the Clef providers", () => {
  expect(providerHasVision("cloudflare-clef")).toBe(true)
  expect(providerHasVision("selfhosted-clef")).toBe(true)
  expect(providerHasVision("cloudflare-jev")).toBe(false)
  expect(providerHasVision("laya")).toBe(false)
  expect(providerHasVision(undefined)).toBe(false)
})

test("decisionBody omits images when none qualify", () => {
  const auth = {
    endpoint: "https://x.test",
    apiKey: "",
    gatewayToken: "",
    model: "clef",
    provider: "cloudflare-clef",
  }
  expect(decisionBody(auth, "state", { q1: {} }, [])).toEqual({
    state: "state",
    questions: { q1: {} },
    model: "clef",
  })
})

test("decisionBody keeps the model off the body when unset", () => {
  const auth = {
    endpoint: "https://x.test",
    apiKey: "",
    gatewayToken: "",
    model: "  ",
    provider: "laya",
  }
  expect(decisionBody(auth, "state", { q1: {} })).toEqual({
    state: "state",
    questions: { q1: {} },
  })
})
