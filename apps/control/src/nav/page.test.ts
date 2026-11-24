import { expect, test } from "bun:test"
import { normalize } from "./cdp"
import {
  parseTypeSecretArgs,
  parseUploadArgs,
  readSecretInput,
  secretOriginError,
  shapeView,
} from "./page"

const probe = {
  url: "https://example.test/",
  title: "Example",
  text: "hello",
  canScrollDown: true,
  canScrollUp: false,
  elementsTruncated: true,
  elements: [
    {
      targetId: "n7",
      role: "button",
      label: "Go",
      value: "",
      editable: false,
      actionable: true,
    },
  ],
}

test("read shapes probe plus viewport into one json line", () => {
  const view = shapeView(probe, {
    width: 1920,
    height: 1200,
    scrollY: 2400,
    scrollHeight: 9000,
  })
  expect(view.url).toBe("https://example.test/")
  expect(view.text).toBe("hello")
  expect(view.viewport).toEqual({ width: 1920, height: 1200 })
  expect(view.scrollY).toBe(2400)
  expect(view.canScrollDown).toBe(true)
  expect(view.elementsTruncated).toBe(true)
  expect(view.elements[0]).toEqual({
    id: "n7",
    role: "button",
    label: "Go",
    value: "",
    editable: false,
    sensitive: false,
    options: undefined,
  })
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
})

test("a raw page-world probe keeps ids and scroll flags after normalize", () => {
  const raw = {
    url: "https://fr.wikipedia.org/wiki/Raspberry_Pi_5",
    title: "Raspberry Pi 5",
    text: "specs",
    can_scroll_down: true,
    can_scroll_up: false,
    elements_truncated: false,
    elements: [
      {
        target_id: "n3",
        role: "input",
        label: "Rechercher sur Wikipédia",
        value: "",
        editable: true,
        actionable: true,
      },
    ],
  }
  const view = shapeView(normalize(raw), {
    width: 1911,
    height: 1074,
    scrollY: 0,
    scrollHeight: 1074,
  })
  expect(view.elements[0]?.id).toBe("n3")
  expect(view.canScrollDown).toBe(true)
  expect(JSON.stringify(view)).toContain('"id":"n3"')
})

test("read view carries the mask, never the password value (#123)", () => {
  const view = shapeView(
    normalize({
      elements: [
        {
          target_id: "n9",
          role: "input",
          label: "Password",
          value: "autofilled-secret",
          editable: true,
          sensitive: true,
        },
      ],
    }),
    { width: 800, height: 600, scrollY: 0, scrollHeight: 600 },
  )
  expect(JSON.stringify(view)).not.toContain("autofilled-secret")
  expect(view.elements[0]?.value).toBe("••••••••")
  expect(view.elements[0]?.sensitive).toBe(true)
})

test("type-secret takes only an element id and exact expected origin (#148)", () => {
  expect(
    parseTypeSecretArgs(["n3", "--origin", "https://accounts.example.test"]),
  ).toEqual({ id: "n3", origin: "https://accounts.example.test" })
  expect(() => parseTypeSecretArgs(["n3"])).toThrow("usage:")
  expect(() =>
    parseTypeSecretArgs(["n3", "--origin", "https://x.test", "123456"]),
  ).toThrow("usage:")
  expect(() => parseTypeSecretArgs(["n3", "--text", "123456"])).toThrow(
    "usage:",
  )
})

test("secret origin check is exact and secure by default (#148)", () => {
  expect(
    secretOriginError(
      "https://accounts.example.test/login",
      "https://accounts.example.test/verify?next=1",
    ),
  ).toBeNull()
  expect(
    secretOriginError(
      "accounts.example.test",
      "https://accounts.example.test/",
    ),
  ).toBeNull()
  expect(
    secretOriginError("https://example.test", "https://evil.example.test/"),
  ).toContain("origin mismatch")
  expect(
    secretOriginError("http://example.test", "http://example.test/"),
  ).toContain("https")
  expect(
    secretOriginError("http://127.0.0.1:8131", "http://127.0.0.1:8131/login"),
  ).toBeNull()
  expect(secretOriginError("file:///tmp/a", "file:///tmp/a")).not.toBeNull()
})

test("secret stdin is bounded and errors never echo it (#148)", async () => {
  async function* chunks(...parts: string[]) {
    for (const part of parts) yield new TextEncoder().encode(part)
  }
  expect(await readSecretInput(chunks("123", "456\n"))).toBe("123456")
  expect(await readSecretInput(chunks(" pass phrase \n"))).toBe(" pass phrase ")
  await expect(readSecretInput(chunks(""))).rejects.toThrow("no secret")
  const secret = "SYNTHETIC-SECRET-148"
  await expect(
    readSecretInput(chunks(`${secret}\u0000tail`)),
  ).rejects.not.toThrow(secret)
  await expect(readSecretInput(chunks("x".repeat(2048)))).rejects.toThrow(
    "too long",
  )
})

test("upload args take an element id plus at least one file (#82)", () => {
  expect(parseUploadArgs(["n4", "/home/agent/save.json"])).toEqual({
    id: "n4",
    files: ["/home/agent/save.json"],
  })
  expect(parseUploadArgs(["n4", "a.png", "b.png"]).files).toEqual([
    "a.png",
    "b.png",
  ])
  expect(() => parseUploadArgs([])).toThrow("usage:")
  expect(() => parseUploadArgs(["n4"])).toThrow("usage:")
})

test("upload paths must be absolute files under the desktop home (#82)", async () => {
  const { uploadPathsError } = (await import("./page")) as {
    uploadPathsError: (paths: string[]) => string | null
  }
  expect(uploadPathsError(["/home/agent/workspace/a.png"])).toBeNull()
  expect(
    uploadPathsError(["/home/agent/a.png", "/home/agent/b.pdf"]),
  ).toBeNull()
  expect(uploadPathsError([])).not.toBeNull()
  expect(uploadPathsError(["relative.png"])).not.toBeNull()
  expect(uploadPathsError(["/etc/passwd"])).not.toBeNull()
  expect(uploadPathsError(["/home/agent/../etc/passwd"])).not.toBeNull()
})
