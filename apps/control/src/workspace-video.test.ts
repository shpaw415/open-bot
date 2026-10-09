import { expect, test } from "bun:test"
import {
  decodeWorkspaceVideo,
  workspaceVideoPath,
  workspaceVideoResponse,
} from "./workspace-video"

test("allows only workspace video paths", () => {
  expect(workspaceVideoPath("/home/agent/workspace/clip.mp4")).toBe(
    "/home/agent/workspace/clip.mp4",
  )
  expect(workspaceVideoPath("/home/agent/workspace/sub/clip.WEBM")).toBe(
    "/home/agent/workspace/sub/clip.WEBM",
  )
  expect(workspaceVideoPath("file:///home/agent/workspace/clip.mp4")).toBe(
    "/home/agent/workspace/clip.mp4",
  )
  expect(workspaceVideoPath("/home/agent/.config/cf-ai/auth.json")).toBeNull()
  expect(
    workspaceVideoPath("/home/agent/workspace/../.config/cf-ai/auth.json"),
  ).toBeNull()
  expect(
    workspaceVideoPath("/home/agent/workspace/%2e%2e/secret.mp4"),
  ).toBeNull()
  expect(
    workspaceVideoPath("file:///home/agent/workspace/../.config/auth.mp4"),
  ).toBeNull()
  expect(workspaceVideoPath("/home/agent/workspace/note.txt")).toBeNull()
  expect(workspaceVideoPath("/home/agent/workspace/pic.png")).toBeNull()
  expect(workspaceVideoPath("https://example.com/a.mp4")).toBeNull()
})

test("decodes binary video bytes and rejects other files", () => {
  const mp4 = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ])
  const decoded = decodeWorkspaceVideo({
    type: "binary",
    encoding: "base64",
    content: mp4.toString("base64"),
  })
  expect(decoded?.mime).toBe("video/mp4")
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00])
  expect(
    decodeWorkspaceVideo({
      type: "binary",
      encoding: "base64",
      content: webm.toString("base64"),
    })?.mime,
  ).toBe("video/webm")
  expect(
    decodeWorkspaceVideo({
      type: "text",
      content: "not a video",
    }),
  ).toBeNull()
  expect(
    decodeWorkspaceVideo({
      type: "binary",
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
    }),
  ).toBeNull()
  const response = workspaceVideoResponse({
    type: "binary",
    encoding: "base64",
    content: mp4.toString("base64"),
  })
  expect(response?.headers.get("content-type")).toBe("video/mp4")
  expect(response?.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response?.headers.get("cache-control")).toBe("private, no-store")
})
