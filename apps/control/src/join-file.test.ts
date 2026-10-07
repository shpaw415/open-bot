import { expect, test } from "bun:test"
import { HttpError } from "./http-error"
import {
  isUploadPath,
  joinedFilePath,
  prepareJoinedPrompt,
  safeJoinName,
} from "./join-file"

const PNG = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
const PDF = `data:application/pdf;base64,${Buffer.from("%PDF").toString("base64")}`
const SHEET = `data:application/vnd.ms-excel;base64,${Buffer.from("sheet").toString("base64")}`

test("joined file paths stay inside uploads", () => {
  expect(safeJoinName("../../.ssh/id_rsa")).toBe("id_rsa")
  expect(safeJoinName("..")).toBe("file")
  expect(joinedFilePath("abcd1234", "../../.ssh/id_rsa")).toBe(
    "/home/agent/workspace/uploads/abcd1234-id_rsa",
  )
  expect(joinedFilePath("../secret", "note.txt")).toBeNull()
  expect(isUploadPath("/home/agent/workspace/uploads/abcd1234-note.txt")).toBe(
    true,
  )
  expect(
    isUploadPath("/home/agent/workspace/uploads/../.config/auth.json"),
  ).toBe(false)
  expect(isUploadPath("/home/agent/.config/opencode/opencode.json")).toBe(false)
})

test("drops file and http parts and names every saved file", () => {
  const prepared = prepareJoinedPrompt(
    {
      parts: [
        {
          type: "file",
          mime: "text/plain",
          url: "file:///home/agent/.config/auth.json",
        },
        { type: "file", mime: "image/png", url: "https://example.com/a.png" },
        {
          type: "file",
          mime: "image/png",
          filename: "cat.png",
          url: PNG,
        },
        {
          type: "file",
          mime: "application/vnd.ms-excel",
          filename: "book.xls",
          url: SHEET,
        },
        { type: "text", text: "look at these" },
      ],
    },
    () => "abcd1234",
  )
  expect(prepared.uploads.map((item) => item.path)).toEqual([
    "/home/agent/workspace/uploads/abcd1234-cat.png",
    "/home/agent/workspace/uploads/abcd1234-book.xls",
  ])
  const parts = prepared.body.parts as {
    type: string
    text?: string
    url?: string
    mime?: string
    filename?: string
  }[]
  expect(parts.filter((part) => part.type === "file")).toEqual([
    {
      type: "file",
      mime: "image/png",
      filename: "cat.png",
      url: PNG,
    },
  ])
  expect(parts.find((part) => part.type === "text")?.text).toBe(
    "look at these\n\nJoined file: /home/agent/workspace/uploads/abcd1234-cat.png\nJoined file: /home/agent/workspace/uploads/abcd1234-book.xls",
  )
})

test("keeps a pdf for the model and still writes it", () => {
  const prepared = prepareJoinedPrompt(
    {
      parts: [
        {
          type: "file",
          mime: "application/pdf",
          filename: "note.pdf",
          url: PDF,
        },
      ],
    },
    () => "abcd1234",
  )
  const parts = prepared.body.parts as {
    type: string
    mime?: string
    text?: string
  }[]
  expect(parts[0]?.text).toBe(
    "Joined file: /home/agent/workspace/uploads/abcd1234-note.pdf",
  )
  expect(parts[1]).toMatchObject({ type: "file", mime: "application/pdf" })
})

test("rejects a sixth file and an oversized file", () => {
  const tiny = {
    type: "file",
    mime: "text/plain",
    filename: "a.txt",
    url: `data:text/plain;base64,${Buffer.from("a").toString("base64")}`,
  }
  expect(() =>
    prepareJoinedPrompt({ parts: Array.from({ length: 6 }, () => tiny) }),
  ).toThrow(HttpError)
  const big = Buffer.alloc(4 * 1024 * 1024 + 1, 1)
  expect(() =>
    prepareJoinedPrompt({
      parts: [
        {
          type: "file",
          mime: "application/octet-stream",
          filename: "big.bin",
          url: `data:application/octet-stream;base64,${big.toString("base64")}`,
        },
      ],
    }),
  ).toThrow(HttpError)
})
