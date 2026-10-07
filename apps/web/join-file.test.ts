import { expect, test } from "bun:test"
import { joinedImage, joinFileError, promptParts } from "./src/join-file"

test("join limits and prompt parts", () => {
  const small = { size: 12, name: "a.txt" } as File
  const empty = { size: 0, name: "a.txt" } as File
  const huge = { size: 4 * 1024 * 1024 + 1, name: "a.txt" } as File
  expect(joinFileError(small, 0)).toBeNull()
  expect(joinFileError(empty, 0)).toBe("That file is empty.")
  expect(joinFileError(huge, 0)).toBe("That file is over 4 MB.")
  expect(joinFileError(small, 5)).toBe("You can join up to 5 files.")
  expect(
    promptParts("  hello ", [
      {
        id: "1",
        name: "cat.png",
        mime: "image/png",
        url: "data:image/png;base64,YQ==",
      },
    ]),
  ).toEqual([
    {
      type: "file",
      mime: "image/png",
      filename: "cat.png",
      url: "data:image/png;base64,YQ==",
    },
    { type: "text", text: "hello" },
  ])
  expect(promptParts("", [])).toEqual([])
  expect(
    joinedImage({
      id: "1",
      name: "cat.png",
      mime: "image/png",
      url: "data:image/png;base64,YQ==",
    }),
  ).toBe(true)
  expect(
    joinedImage({
      id: "2",
      name: "notes.txt",
      mime: "text/plain",
      url: "data:text/plain;base64,YQ==",
    }),
  ).toBe(false)
})
