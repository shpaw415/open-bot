import { describe, expect, test } from "bun:test"
import { MAX_JOIN_BYTES, MAX_JOIN_FILES, pickJoinableFiles } from "./join-file"

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name)
}

describe("pick joinable files", () => {
  test("a multi-file batch keeps every valid file", () => {
    const result = pickJoinableFiles(
      [makeFile("a.png", 10), makeFile("b.txt", 20), makeFile("c.md", 30)],
      0,
    )
    expect(result.accepted.map((file) => file.name)).toEqual([
      "a.png",
      "b.txt",
      "c.md",
    ])
    expect(result.errors).toEqual([])
  })

  test("an oversized file is skipped while the rest attach", () => {
    const result = pickJoinableFiles(
      [makeFile("big.bin", MAX_JOIN_BYTES + 1), makeFile("ok.txt", 5)],
      0,
    )
    expect(result.accepted.map((file) => file.name)).toEqual(["ok.txt"])
    expect(result.errors).toEqual(["That file is over 4 MB."])
  })

  test("empty files are skipped", () => {
    const result = pickJoinableFiles(
      [makeFile("empty.txt", 0), makeFile("ok.txt", 5)],
      0,
    )
    expect(result.accepted.map((file) => file.name)).toEqual(["ok.txt"])
    expect(result.errors).toEqual(["That file is empty."])
  })

  test("the cap counts existing joins and stops the batch cleanly", () => {
    const files = Array.from({ length: 7 }, (_, index) =>
      makeFile(`f${index}.txt`, 5),
    )
    const result = pickJoinableFiles(files, MAX_JOIN_FILES - 2)
    expect(result.accepted).toHaveLength(2)
    expect(result.errors).toEqual(["You can join up to 5 files."])
  })

  test("repeated identical problems are reported once", () => {
    const result = pickJoinableFiles(
      [makeFile("a.txt", 0), makeFile("b.txt", 0), makeFile("c.txt", 0)],
      0,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.errors).toEqual(["That file is empty."])
  })
})
