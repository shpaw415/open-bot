import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const dir = import.meta.dir

function text(path: string) {
  return readFileSync(join(dir, path), "utf8")
}

test("defringe clears a white halo and keeps interior white", async () => {
  const proc = Bun.spawn(["python3", join(dir, "defringe.py"), "--self-test"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(stderr).toBe("")
  expect(stdout.trim()).toBe("ok")
  expect(code).toBe(0)
})

test("refine is seeded and the standing lines name it", () => {
  const entrypoint = text("entrypoint.sh")
  const agents = text("seed/AGENTS.md")
  const prompt = text("seed/opencode.json")
  expect(entrypoint).toContain(
    "cp /opt/open-bot/seed/skills/refine/SKILL.md /home/agent/.config/opencode/skills/refine/SKILL.md",
  )
  expect(entrypoint).toContain(
    "save a user correction or an obvious missing finish with the refine skill",
  )
  expect(agents).toContain("load the `refine` skill")
  expect(agents).toContain("add `--cutout`")
  expect(prompt).toContain(
    "save a user correction or an obvious missing finish with the refine skill",
  )
  expect(text("seed/skills/refine/SKILL.md")).toContain("Do not pass `wait`")
  expect(text("seed/skills/shortcut/SKILL.md")).not.toContain('"wait":true')
  expect(text("seed/skills/gen-image/SKILL.md")).toContain("--cutout")
  expect(text("Dockerfile")).toContain("python3-pil")
  expect(text("Dockerfile")).toContain(
    "ln -sf /opt/open-bot/defringe.py /usr/local/bin/defringe",
  )
})
