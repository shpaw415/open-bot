import { expect, test } from "bun:test"
import {
  agentFilePath,
  decodeWorkspaceFile,
  workspaceFileResponse,
} from "./workspace-file"

test("allows only agent-home file paths with viewable extensions", () => {
  expect(agentFilePath("/home/agent/workspace/report.pdf")).toBe(
    "/home/agent/workspace/report.pdf",
  )
  expect(agentFilePath("/home/agent/projects/site/src/app.ts")).toBe(
    "/home/agent/projects/site/src/app.ts",
  )
  expect(agentFilePath("file:///home/agent/notes.md")).toBe(
    "/home/agent/notes.md",
  )
  expect(agentFilePath("/home/agent/workspace/README")).toBe(
    "/home/agent/workspace/README",
  )
  expect(agentFilePath("/etc/passwd")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/../.ssh/id_rsa.pub")).toBeNull()
  expect(agentFilePath("/home/agent/.config/open-bot/token.txt")).toBeNull()
  expect(agentFilePath("/home/agent/.open-bot/state.json")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/.env")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/key.pem")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/auth.json")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/tool.exe")).toBeNull()
  expect(agentFilePath("/home/agent/workspace/")).toBeNull()
  expect(agentFilePath("relative/notes.txt")).toBeNull()
})

test("decodes text payloads as plain text, never active content", () => {
  const html = decodeWorkspaceFile("/home/agent/workspace/page.html", {
    type: "text",
    content: "<script>alert(1)</script>",
  })
  expect(html?.mime).toBe("text/plain; charset=utf-8")
  expect(new TextDecoder().decode(html?.bytes)).toBe(
    "<script>alert(1)</script>",
  )
  const readme = decodeWorkspaceFile("/home/agent/workspace/README", {
    type: "text",
    content: "hello",
  })
  expect(readme?.mime).toBe("text/plain; charset=utf-8")
  expect(
    decodeWorkspaceFile("/home/agent/workspace/README", {
      type: "binary",
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
    }),
  ).toBeNull()
})

test("decodes pdf and svg, and rejects spoofed bytes", () => {
  const pdf = Buffer.from("%PDF-1.7 fake")
  const ok = decodeWorkspaceFile("/home/agent/workspace/report.pdf", {
    type: "binary",
    encoding: "base64",
    content: pdf.toString("base64"),
  })
  expect(ok?.mime).toBe("application/pdf")
  expect(ok?.inline).toBe(true)
  expect(
    decodeWorkspaceFile("/home/agent/workspace/report.pdf", {
      type: "binary",
      encoding: "base64",
      content: Buffer.from("not a pdf").toString("base64"),
    }),
  ).toBeNull()
  const svg = decodeWorkspaceFile("/home/agent/workspace/pic.svg", {
    type: "text",
    content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  })
  expect(svg?.mime).toBe("image/svg+xml")
  expect(
    decodeWorkspaceFile("/home/agent/workspace/pic.svg", {
      type: "text",
      content: "hello",
    }),
  ).toBeNull()
})

test("serves downloads for archives and sandboxes every response", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])
  const res = workspaceFileResponse("/home/agent/workspace/bundle.zip", {
    type: "binary",
    encoding: "base64",
    content: zip.toString("base64"),
  })
  expect(res?.headers.get("content-type")).toBe("application/zip")
  expect(res?.headers.get("content-disposition")).toContain("attachment")
  expect(res?.headers.get("x-content-type-options")).toBe("nosniff")
  expect(res?.headers.get("content-security-policy")).toContain("sandbox")
  const md = workspaceFileResponse("/home/agent/notes.md", {
    type: "text",
    content: "# Notes",
  })
  expect(md?.headers.get("content-disposition")).toContain("inline")
  expect(md?.headers.get("content-disposition")).toContain("notes.md")
  expect(md?.headers.get("content-security-policy")).toContain("sandbox")
  expect(await md?.text()).toBe("# Notes")
  // PDF reaches the browser viewer inside the preview pane: no sandbox
  const pdf = workspaceFileResponse("/home/agent/workspace/report.pdf", {
    type: "binary",
    encoding: "base64",
    content: Buffer.from("%PDF-1.7 fake").toString("base64"),
  })
  expect(pdf?.headers.get("content-security-policy")).toBeNull()
  expect(
    workspaceFileResponse("/home/agent/workspace/tool.exe", {
      type: "binary",
      encoding: "base64",
      content: Buffer.from("MZ").toString("base64"),
    }),
  ).toBeNull()
})
