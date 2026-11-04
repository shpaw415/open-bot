import { expect, test } from "bun:test"
import { agentFilePath, chatImageUrl, chatLinkUrl } from "./chat-view"
import {
  filePathFromSrc,
  filePreviewKind,
  truncateTextPreview,
} from "./file-view"

test("filePreviewKind classifies what the previewer can show", () => {
  expect(filePreviewKind("/home/agent/notes.md")).toBe("markdown")
  expect(filePreviewKind("/home/agent/NOTES.MARKDOWN")).toBe("markdown")
  expect(filePreviewKind("/home/agent/src/app.ts")).toBe("text")
  expect(filePreviewKind("/home/agent/data.csv")).toBe("text")
  expect(filePreviewKind("/home/agent/README")).toBe("text")
  expect(filePreviewKind("/home/agent/pic.svg")).toBe("image")
  expect(filePreviewKind("/home/agent/clip.mp4")).toBe("video")
  expect(filePreviewKind("/home/agent/song.mp3")).toBe("audio")
  expect(filePreviewKind("/home/agent/report.pdf")).toBe("pdf")
  expect(filePreviewKind("/home/agent/owl.glb")).toBe("model3d")
  expect(filePreviewKind("/home/agent/bundle.zip")).toBe("download")
})

test("filePathFromSrc recovers the disk path from served file URLs", () => {
  expect(
    filePathFromSrc("/api/workspace/file?path=%2Fhome%2Fagent%2Fnotes.md"),
  ).toBe("/home/agent/notes.md")
  expect(
    filePathFromSrc(
      "/api/workspace/image?path=%2Fhome%2Fagent%2Fworkspace%2Fkoi.png",
    ),
  ).toBe("/home/agent/workspace/koi.png")
  expect(filePathFromSrc("/api/workspace/snapshot/s1/koi.png")).toBeNull()
  expect(filePathFromSrc("/api/media/items/x/note.pdf")).toBeNull()
  expect(filePathFromSrc("https://example.com/x.md")).toBeNull()
  expect(filePathFromSrc(undefined)).toBeNull()
  expect(filePathFromSrc("/api/workspace/file?path=%2Fetc%2Fpasswd")).toBeNull()
})

test("relative links resolve against the open file's folder", () => {
  const dir = "/home/agent/projects/site/docs"
  expect(agentFilePath("guide.md", dir)).toBe(
    "/home/agent/projects/site/docs/guide.md",
  )
  expect(agentFilePath("../src/app.ts", dir)).toBe(
    "/home/agent/projects/site/src/app.ts",
  )
  expect(chatLinkUrl("guide.md", dir)).toContain(
    encodeURIComponent("/home/agent/projects/site/docs/guide.md"),
  )
  expect(chatImageUrl("diagram.png", dir)).toContain(
    encodeURIComponent("/home/agent/projects/site/docs/diagram.png"),
  )
  // the chat default stays the workspace working directory
  expect(agentFilePath("guide.md")).toBe("/home/agent/workspace/guide.md")
})

test("truncateTextPreview caps huge text bodies", () => {
  expect(truncateTextPreview("short")).toEqual({
    text: "short",
    truncated: false,
  })
  const big = truncateTextPreview("x".repeat(2_000_000))
  expect(big.truncated).toBe(true)
  expect(big.text.length).toBeLessThan(2_000_000)
})
