import { expect, test } from "bun:test"
import {
  chatImageUrl,
  embedWorkspaceImages,
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
