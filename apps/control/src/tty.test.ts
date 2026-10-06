import { describe, expect, test } from "bun:test"
import { parseTtyControl, ttyExitFrame, ttySize, ttySizeOr } from "./tty"

describe("tty control", () => {
  test("parses a resize frame and rejects everything else", () => {
    expect(parseTtyControl('{"op":"resize","cols":120,"rows":32}')).toEqual({
      cols: 120,
      rows: 32,
    })
    expect(parseTtyControl('{"op":"resize","cols":1,"rows":10}')).toBeNull()
    expect(parseTtyControl('{"op":"input","cols":80,"rows":24}')).toBeNull()
    expect(parseTtyControl("not json")).toBeNull()
    expect(ttySize("80")).toBe(80)
    expect(ttySizeOr("nope", 24)).toBe(24)
  })

  test("exit frame stays a text control message", () => {
    expect(JSON.parse(ttyExitFrame(0))).toEqual({ op: "exit", code: 0 })
    expect(JSON.parse(ttyExitFrame(null, "closed"))).toEqual({
      op: "exit",
      code: null,
      note: "closed",
    })
  })
})
