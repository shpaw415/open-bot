import { expect, test } from "bun:test"
import {
  decodeWorkspaceModel3d,
  workspaceModel3dPath,
  workspaceModel3dResponse,
} from "./workspace-model3d"

function glb(): Buffer {
  const json = JSON.stringify({ meshes: [{}] })
  const bytes = Buffer.alloc(20 + json.length)
  bytes.write("glTF", 0, "ascii")
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(json.length, 12)
  bytes.write("JSON", 16, "ascii")
  bytes.write(json, 20, "ascii")
  return bytes
}

test("allows only workspace glb paths", () => {
  expect(workspaceModel3dPath("/home/agent/workspace/owl.glb")).toBe(
    "/home/agent/workspace/owl.glb",
  )
  expect(workspaceModel3dPath("/home/agent/workspace/sub/owl.GLB")).toBe(
    "/home/agent/workspace/sub/owl.GLB",
  )
  expect(workspaceModel3dPath("file:///home/agent/workspace/owl.glb")).toBe(
    "/home/agent/workspace/owl.glb",
  )
  expect(workspaceModel3dPath("/home/agent/.config/cf-ai/auth.json")).toBeNull()
  expect(
    workspaceModel3dPath("/home/agent/workspace/../.config/cf-ai/auth.json"),
  ).toBeNull()
  expect(
    workspaceModel3dPath("/home/agent/workspace/%2e%2e/secret.glb"),
  ).toBeNull()
  expect(
    workspaceModel3dPath("file:///home/agent/workspace/../.config/auth.glb"),
  ).toBeNull()
  expect(workspaceModel3dPath("/home/agent/workspace/note.txt")).toBeNull()
  expect(workspaceModel3dPath("/home/agent/workspace/pic.png")).toBeNull()
  expect(workspaceModel3dPath("/home/agent/workspace/clip.mp4")).toBeNull()
  expect(workspaceModel3dPath("https://example.com/a.glb")).toBeNull()
})

test("decodes binary glb bytes and rejects other files", () => {
  const decoded = decodeWorkspaceModel3d({
    type: "binary",
    encoding: "base64",
    content: glb().toString("base64"),
  })
  expect(decoded?.mime).toBe("model/gltf-binary")
  const stl = Buffer.alloc(84)
  stl.write("solid", 0, "ascii")
  expect(
    decodeWorkspaceModel3d({
      type: "binary",
      encoding: "base64",
      content: stl.toString("base64"),
    }),
  ).toBeNull()
  expect(
    decodeWorkspaceModel3d({
      type: "text",
      content: "not a mesh",
    }),
  ).toBeNull()
  const truncated = glb()
  truncated.writeUInt32LE(4096, 8)
  expect(
    decodeWorkspaceModel3d({
      type: "binary",
      encoding: "base64",
      content: truncated.toString("base64"),
    }),
  ).toBeNull()
  const response = workspaceModel3dResponse({
    type: "binary",
    encoding: "base64",
    content: glb().toString("base64"),
  })
  expect(response?.headers.get("content-type")).toBe("model/gltf-binary")
  expect(response?.headers.get("x-content-type-options")).toBe("nosniff")
})
