import { expect, test } from "bun:test"
import { redactText } from "./client"
import {
  buildCliQuestions,
  DEFAULT_SCORE_LEVELS,
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
    {
      kind: "score",
      question: "How cluttered is the desk?",
      levels: DEFAULT_SCORE_LEVELS,
    },
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

test("parseArgs defaults score levels and accepts custom ones", () => {
  expect(parseArgs(["--score", "How much?"]).specs[0]).toEqual({
    kind: "score",
    question: "How much?",
    levels: DEFAULT_SCORE_LEVELS,
  })
  expect(
    parseArgs(["--score", "How hot?", "cold", "warm", "hot"]).specs[0],
  ).toEqual({
    kind: "score",
    question: "How hot?",
    levels: ["cold", "warm", "hot"],
  })
  expect(() =>
    parseArgs([
      "--score",
      "Q?",
      ...Array.from({ length: 11 }, (_, i) => `l${i}`),
    ]),
  ).toThrow("--score takes at most 10 levels")
  // levels stop at the next flag
  expect(
    parseArgs(["--score", "Q?", "a", "b", "--noul", "Waiting?"]).specs[0],
  ).toMatchObject({ levels: ["a", "b"] })
})

test("parseArgs rejects a duplicated --state", () => {
  expect(() =>
    parseArgs(["--state", "one", "--state", "two", "--choice", "Q?", "a", "b"]),
  ).toThrow("--state given more than once")
})

test("parseArgs rejects more than four images", () => {
  const images = [
    "--image",
    "a.jpg",
    "--image",
    "b.jpg",
    "--image",
    "c.jpg",
    "--image",
    "d.jpg",
  ]
  expect(() => parseArgs(["--state", "x", ...images])).not.toThrow()
  expect(() =>
    parseArgs(["--state", "x", ...images, "--image", "e.jpg"]),
  ).toThrow("max 4 images per call")
  expect(() =>
    parseArgs(["--state", "x", ...images, "--image-base64", "aa=="]),
  ).toThrow("max 4 images per call")
})

test("parseArgs rejects unknown flags and missing values", () => {
  expect(() => parseArgs(["--bogus"])).toThrow(UsageError)
  expect(() => parseArgs(["--state"])).toThrow(UsageError)
  expect(() => parseArgs(["--timeout", "soon"])).toThrow(UsageError)
})

test("buildCliQuestions numbers ids in flag order and maps choice criteria", () => {
  const questions = buildCliQuestions([
    { kind: "choice", question: "Which one?", options: ["a", "b"] },
    { kind: "score", question: "How much?", levels: ["low", "high"] },
    { kind: "noul", question: "Waiting?" },
  ])
  expect(Object.keys(questions)).toEqual(["q1", "q2", "q3"])
  expect(questions.q1).toEqual({
    type: "choice",
    instructions: "Which one?",
    criteria: { a: "a", b: "b" },
  })
  expect(questions.q2).toEqual({
    type: "score",
    instructions: "How much?",
    criteria: ["low", "high"],
  })
  expect(questions.q3).toEqual({
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
    {
      kind: "score" as const,
      question: "How much?",
      levels: DEFAULT_SCORE_LEVELS,
    },
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

test("decorateAnswers maps score level indexes to labels and clamps", () => {
  const score = (question: string) => ({
    kind: "score" as const,
    question,
    levels: ["none", "some", "lots"],
  })
  const specs = [score("a"), score("b"), score("c")]
  const decorated = decorateAnswers(
    {
      q1: {
        type: "score",
        score: 1.8,
        legend: { 0: "none", 1: "some", 2: "lots" },
        confidence: 0.6,
      },
      q2: { type: "score", score: 9 },
      q3: { type: "score", score: "junk" },
    },
    specs,
  )
  expect(decorated.q1).toMatchObject({ score: 1.8, level: "lots" })
  expect(decorated.q2).toMatchObject({ score: 9, level: "lots" })
  expect(decorated.q3).toMatchObject({ score: "junk", level: null })
  const rounded = decorateAnswers({ q1: { score: 1.4 } }, specs)
  expect(rounded.q1).toMatchObject({ level: "some" })
})

test("redact strips credentials from error bodies", () => {
  expect(redactText("auth Bearer abc.def.ghi failed")).toBe(
    "auth Bearer [redacted] failed",
  )
  expect(redactText('{"error":"bad key sk-abcdefgh12345678"}')).toBe(
    '{"error":"bad key [redacted]"}',
  )
  expect(redactText('config {"apiKey":"super-secret","model":"clef"}')).toBe(
    'config {"apiKey":"[redacted]","model":"clef"}',
  )
  expect(redactText("x".repeat(500))).toHaveLength(240)
})
