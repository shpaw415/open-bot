import { describe, expect, test } from "bun:test"
import {
  effortForModel,
  effortLabel,
  effortOptions,
  MODEL_DEFAULT_EFFORT,
  orbState,
} from "./chat-controls"

describe("effortLabel", () => {
  test("maps known variants to fr-CA labels", () => {
    expect(effortLabel("none")).toBe("Désactivée")
    expect(effortLabel("low")).toBe("Faible")
    expect(effortLabel("medium")).toBe("Moyenne")
    expect(effortLabel("high")).toBe("Haute")
    expect(effortLabel("xhigh")).toBe("Très haute")
    expect(effortLabel("max")).toBe("Maximale")
    expect(effortLabel("thinking")).toBe("Réflexion activée")
  })

  test("falls back to a capitalized passthrough for unknown variants", () => {
    expect(effortLabel("deep")).toBe("Deep")
    expect(effortLabel("")).toBe("")
  })
})

describe("effortForModel", () => {
  test("keeps a level the new model supports", () => {
    expect(effortForModel(["low", "medium", "high"], "high")).toBe("high")
  })

  test("drops a level the new model does not support — never kept silently", () => {
    expect(effortForModel(["low", "high"], "medium")).toBe(MODEL_DEFAULT_EFFORT)
  })

  test("an empty effort stays the model default", () => {
    expect(effortForModel([], "")).toBe(MODEL_DEFAULT_EFFORT)
  })

  test("a model with no variants always resets to the model default", () => {
    expect(effortForModel([], "high")).toBe(MODEL_DEFAULT_EFFORT)
  })
})

describe("effortOptions", () => {
  test("lists the model default first, then the variants", () => {
    expect(effortOptions(["low", "high"], "low")).toEqual(["", "low", "high"])
  })

  test("keeps an unknown saved effort visible so the display stays honest", () => {
    expect(effortOptions(["low"], "mystery")).toEqual(["", "low", "mystery"])
  })

  test("no duplicated current value", () => {
    expect(effortOptions([], "low")).toEqual(["", "low"])
    expect(effortOptions(["low"], "")).toEqual(["", "low"])
  })
})

describe("orbState — visual activity phases", () => {
  test("no activity means no orb", () => {
    expect(orbState(null, false)).toBeNull()
    expect(orbState(null, true)).toBeNull()
  })

  test("initialize reads as thinking, sending or not", () => {
    expect(orbState("initialize", false)).toBe("thinking")
    expect(orbState("initialize", true)).toBe("thinking")
  })

  test("an accepted send waiting for events reads as thinking", () => {
    expect(orbState("working", true)).toBe("thinking")
  })

  test("live turn activity reads as working", () => {
    expect(orbState("working", false)).toBe("working")
  })
})
