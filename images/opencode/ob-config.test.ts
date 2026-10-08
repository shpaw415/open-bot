import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "../..")

test("ob-config ships in the image and is documented as the durable fix", () => {
  const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
  expect(dockerfile).toContain(
    "COPY scripts/ob-config.sh /usr/local/bin/ob-config",
  )
  expect(dockerfile).toContain("/usr/local/bin/ob-config")
  const script = readFileSync(join(root, "scripts/ob-config.sh"), "utf8")
  expect(script).toContain("/api/agent-config")
  expect(script).toContain("set-model")
  expect(script).not.toContain("image-auth.json.tmp")
  const agents = readFileSync(join(import.meta.dir, "seed/AGENTS.md"), "utf8")
  expect(agents).toContain("ob-config set-model")
  expect(agents).toContain("Never hand-edit")
})
