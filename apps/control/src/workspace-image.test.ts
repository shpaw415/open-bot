import { expect, test } from "bun:test"
import {
  decodeWorkspaceImage,
  workspaceImagePath,
  workspaceImageResponse,
} from "./workspace-image"

test("allows only workspace image paths", () => {
  expect(workspaceImagePath("/home/agent/workspace/koi.png")).toBe(
    "/home/agent/workspace/koi.png",
  )
  expect(workspaceImagePath("/home/agent/workspace/sub/cat.JPEG")).toBe(
    "/home/agent/workspace/sub/cat.JPEG",
  )
  expect(workspaceImagePath("file:///home/agent/workspace/koi.png")).toBe(
    "/home/agent/workspace/koi.png",
  )
  expect(workspaceImagePath("/home/agent/.config/cf-ai/auth.json")).toBeNull()
  expect(
    workspaceImagePath("/home/agent/workspace/../.config/cf-ai/auth.json"),
  ).toBeNull()
  expect(
    workspaceImagePath("/home/agent/workspace/%2e%2e/secret.png"),
  ).toBeNull()
  expect(
    workspaceImagePath(
      "file:///home/agent/workspace/../.config/cf-ai/auth.png",
    ),
  ).toBeNull()
  expect(workspaceImagePath("/home/agent/workspace/note.txt")).toBeNull()
  expect(workspaceImagePath("/home/agent/workspace/pic.svg")).toBeNull()
  expect(workspaceImagePath("https://example.com/a.png")).toBeNull()
})

test("decodes binary image bytes and rejects other files", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ])
  const decoded = decodeWorkspaceImage({
    type: "binary",
    encoding: "base64",
    content: png.toString("base64"),
    mimeType: "text/plain",
  })
  expect(decoded?.mime).toBe("image/png")
  expect(decoded?.bytes[0]).toBe(0x89)
  expect(
    decodeWorkspaceImage({
      type: "text",
      content: "not an image",
    }),
  ).toBeNull()
  expect(
    decodeWorkspaceImage({
      type: "binary",
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
    }),
  ).toBeNull()
  const response = workspaceImageResponse({
    type: "binary",
    encoding: "base64",
    content: png.toString("base64"),
  })
  expect(response?.headers.get("content-type")).toBe("image/png")
  expect(response?.headers.get("x-content-type-options")).toBe("nosniff")
})
