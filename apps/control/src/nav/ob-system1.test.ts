import { expect, test } from "bun:test"
import {
  buildCliQuestions,
  decorateAnswers,
  normalizeBase64,
  parseArgs,
  sniffImageType,
  UsageError,
} from "./ob-system1"

test("parseArgs reads every flag and variadic choice options", () => {
  const parsed = parseArgs([
    "--state",
    "a photo of a desk",
    "--choice",
    "Which object is the mug?",
    "left cup",
    "right cup",
    "neither",
    "--score",
    "How cluttered is the desk?",
    "--noul",
    "Is a person waiting?",
    "--image",
    "/tmp/shot.jpg",
    "--image-base64",
    "aGk=",
    "--model",
    "clef-flash",
    "--timeout",
    "15000",
  ])
  expect(parsed.state).toBe("a photo of a desk")
  expect(parsed.hasState).toBe(true)
  expect(parsed.specs).toEqual([
    {
      kind: "choice",
      question: "Which object is the mug?",
      options: ["left cup", "right cup", "neither"],
    },
    { kind: "score", question: "How cluttered is the desk?" },
    { kind: "noul", question: "Is a person waiting?" },
  ])
  expect(parsed.images).toEqual([{ path: "/tmp/shot.jpg" }, { b64: "aGk=" }])
  expect(parsed.model).toBe("clef-flash")
  expect(parsed.timeout).toBe(15000)
})

test("parseArgs rejects a choice with fewer than two options", () => {
  expect(() => parseArgs(["--choice", "Pick one?", "only"])).toThrow(UsageError)
  expect(() => parseArgs(["--choice", "Pick one?"])).toThrow(UsageError)
})

test("parseArgs rejects unknown flags and missing values", () => {
  expect(() => parseArgs(["--bogus"])).toThrow(UsageError)
  expect(() => parseArgs(["--state"])).toThrow(UsageError)
  expect(() => parseArgs(["--timeout", "soon"])).toThrow(UsageError)
})

test("buildCliQuestions numbers ids in flag order and maps choice criteria", () => {
  const questions = buildCliQuestions([
    { kind: "choice", question: "Which one?", options: ["a", "b"] },
    { kind: "noul", question: "Waiting?" },
  ])
  expect(Object.keys(questions)).toEqual(["q1", "q2"])
  expect(questions.q1).toEqual({
    type: "choice",
    instructions: "Which one?",
    criteria: { a: "a", b: "b" },
  })
  expect(questions.q2).toEqual({
    type: "noul",
    instructions: "Waiting?",
  })
})

test("sniffImageType reads magic bytes", () => {
  expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
    "image/jpeg",
  )
  expect(
    sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])),
  ).toBe("image/png")
  expect(
    sniffImageType(
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
  ).toBe("image/webp")
  expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  expect(sniffImageType(new Uint8Array([]))).toBeNull()
})

test("normalizeBase64 strips data URLs and whitespace", () => {
  expect(normalizeBase64("aGk=")).toBe("aGk=")
  expect(normalizeBase64("data:image/jpeg;base64,aGk=")).toBe("aGk=")
  expect(normalizeBase64("  aG\nk=  ")).toBe("aGk=")
})

test("decorateAnswers flags out-of-space choices and passes others through", () => {
  const specs = [
    { kind: "choice" as const, question: "Which?", options: ["a", "b"] },
    { kind: "noul" as const, question: "Waiting?" },
  ]
  const decorated = decorateAnswers(
    {
      q1: { choice: "zzz", confidence: 0.4 },
      q2: { noul: 0.1 },
      q9: { choice: "ignored" },
    },
    specs,
  )
  expect(decorated.q1).toEqual({
    choice: "zzz",
    confidence: 0.4,
    valid: false,
  })
  expect(decorated.q2).toEqual({ noul: 0.1 })
  expect(decorated.q9).toBeUndefined()
})

test("decorateAnswers keeps a valid choice and fills missing answers with null", () => {
  const specs = [
    { kind: "choice" as const, question: "Which?", options: ["a", "b"] },
    { kind: "score" as const, question: "How much?" },
  ]
  const decorated = decorateAnswers(
    {
      q1: {
        choice: "b",
        confidence: 0.93,
        probabilities: { a: 0.07, b: 0.93 },
      },
    },
    specs,
  )
  expect(decorated.q1).toMatchObject({ choice: "b", valid: true })
  expect(decorated.q2).toBeNull()
})
