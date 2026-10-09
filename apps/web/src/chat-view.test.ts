import { expect, test } from "bun:test"
import {
  chatImageUrl,
  embedWorkspaceImages,
  speakableText,
  splitPluginCards,
  turnError,
  workspaceModel3dPath,
  workspaceModel3dSrc,
} from "./chat-view"

test("routes workspace glb paths to the model3d endpoint", () => {
  expect(workspaceModel3dPath("/home/agent/workspace/owl.glb")).toBe(
    "/home/agent/workspace/owl.glb",
  )
  expect(chatImageUrl("/home/agent/workspace/owl.glb")).toBe(
    workspaceModel3dSrc("/home/agent/workspace/owl.glb"),
  )
  expect(chatImageUrl("/home/agent/workspace/owl.png")).toBe(
    "/api/workspace/image?path=%2Fhome%2Fagent%2Fworkspace%2Fowl.png",
  )
  expect(chatImageUrl("https://example.com/mesh.glb")).toBe(
    "https://example.com/mesh.glb",
  )
})

test("embeds a bare glb path line like a workspace image", () => {
  expect(embedWorkspaceImages("/home/agent/workspace/owl.glb")).toBe(
    "![owl.glb](/home/agent/workspace/owl.glb)",
  )
  expect(embedWorkspaceImages("`/home/agent/workspace/owl.glb`")).toBe(
    "![owl.glb](/home/agent/workspace/owl.glb)",
  )
  expect(embedWorkspaceImages("saved at /home/agent/workspace/owl.glb")).toBe(
    "saved at /home/agent/workspace/owl.glb",
  )
})

test("splits plugin-card blocks out of the message text", () => {
  const text = [
    "Here is the weather:",
    "```plugin-card",
    '{"plugin":"weather-pro","type":"weather-card","data":{"city":"Paris"}}',
    "```",
    "Enjoy!",
  ].join("\n")
  const segments = splitPluginCards(text)
  expect(segments).toHaveLength(3)
  expect(segments[0]).toEqual({ kind: "text", text: "Here is the weather:\n" })
  expect(segments[1]?.kind).toBe("plugin-card")
  if (segments[1]?.kind === "plugin-card") {
    expect(segments[1].block.plugin).toBe("weather-pro")
    expect(segments[1].block.type).toBe("weather-card")
    expect(segments[1].block.data.city).toBe("Paris")
  }
  expect(segments[2]).toEqual({ kind: "text", text: "\nEnjoy!" })
})

test("keeps plain text and malformed cards readable", () => {
  expect(splitPluginCards("just text")).toEqual([
    { kind: "text", text: "just text" },
  ])
  const broken = splitPluginCards("```plugin-card\nnot json\n```")
  expect(broken).toHaveLength(1)
  expect(broken[0]?.kind).toBe("plugin-card")
  if (broken[0]?.kind === "plugin-card") {
    expect(broken[0].block.plugin).toBe("")
    expect(broken[0].block.data).toEqual({})
  }
})

test("detects a dead turn from the provider connect error", () => {
  const messages = [
    { info: { id: "u1", role: "user" }, parts: [{ type: "text", text: "hi" }] },
    {
      info: {
        id: "a1",
        role: "assistant",
        time: { created: 1, completed: 2 },
        error: {
          name: "APIError",
          data: {
            message:
              "Cannot connect to API: Unable to connect. Is the computer able to access the url?",
            isRetryable: true,
          },
        },
      },
      parts: [],
    },
  ]
  const issue = turnError(messages)
  expect(issue?.messageId).toBe("a1")
  expect(issue?.retryable).toBe(true)
})

test("ignores completed turns and user-stopped turns", () => {
  expect(
    turnError([
      {
        info: { id: "a2", role: "assistant", error: { name: "Aborted" } },
        parts: [],
      },
    ]),
  ).toBeNull()
  expect(
    turnError([
      {
        info: {
          id: "a3",
          role: "assistant",
          error: { name: "APIError", data: { message: "Aborted by user." } },
        },
        parts: [],
      },
    ]),
  ).toBeNull()
  expect(
    turnError([{ info: { id: "a4", role: "assistant" }, parts: [] }]),
  ).toBeNull()
  expect(
    turnError([
      { info: { id: "u2", role: "user", error: { name: "APIError" } } },
      { info: { id: "a5", role: "assistant" }, parts: [] },
    ]),
  ).toBeNull()
})

test("speakableText keeps prose and drops non-speech content", () => {
  expect(speakableText("Hello world. How are you?")).toBe(
    "Hello world. How are you?",
  )
  expect(speakableText("Look:\n\n```py\nprint('hi')\n```\nDone.")).toBe(
    "Look: Done.",
  )
  expect(speakableText("run `npm test` now")).toBe("run npm test now")
  expect(speakableText("![screen](open-bot://screen)")).toBe("")
  expect(speakableText("[docs](https://example.com) page")).toBe("docs page")
  expect(speakableText("![pic](/home/agent/workspace/a.png)")).toBe("")
  expect(speakableText('```plugin-card\n{"plugin":"x"}\n```')).toBe("")
  expect(speakableText("## Heading\n- one\n- two\n> quoted")).toBe(
    "Heading one two quoted",
  )
  expect(speakableText("a\n\nb").length).toBeGreaterThan(0)
})
