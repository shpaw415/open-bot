import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ModelManifestError,
  validateModelDir,
} from "./seed/skills/gpio-3d/validate-manifest.ts"

const skillDir = join(import.meta.dir, "seed/skills/gpio-3d")
const vendoredDir = join(import.meta.dir, "gpio-3d")
const dockerfile = readFileSync(join(import.meta.dir, "Dockerfile"), "utf8")
const entrypoint = readFileSync(join(import.meta.dir, "entrypoint.sh"), "utf8")

function glbBytes(doc: unknown = { meshes: [{}] }): Uint8Array {
  const json = JSON.stringify(doc)
  const pad = (4 - (json.length % 4)) % 4
  const chunk = json + " ".repeat(pad)
  const bytes = new Uint8Array(20 + chunk.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, chunk.length, true)
  bytes.set(new TextEncoder().encode("JSON"), 16)
  bytes.set(new TextEncoder().encode(chunk), 20)
  return bytes
}

function stlBytes(): Uint8Array {
  const bytes = new Uint8Array(134)
  new DataView(bytes.buffer).setUint32(80, 1, true)
  return bytes
}

function withModel(
  parts: Array<Record<string, unknown>>,
  run: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "gpio-3d-model-"))
  const manifest = { version: 1, units: "mm", tool: "trimesh", parts }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest))
  for (const part of parts) {
    const file = part.file as string
    writeFileSync(join(dir, file), glbBytes())
    writeFileSync(join(dir, file.replace(/\.glb$/, ".stl")), stlBytes())
  }
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("dockerfile builds the gpio-3d venv and wrapper", () => {
  expect(dockerfile).toContain("COPY images/opencode/gpio-3d /opt/gpio-3d")
  expect(dockerfile).toContain(
    "--only-binary=:all: -r /opt/gpio-3d/requirements.txt",
  )
  expect(dockerfile).toContain('import trimesh, numpy, manifold3d"')
  expect(dockerfile).toContain("/usr/local/bin/gpio-3d")
})

test("entrypoint seeds the gpio-3d skill and validator", () => {
  expect(entrypoint).toContain(
    "cp /opt/open-bot/seed/skills/gpio-3d/SKILL.md /home/agent/.config/opencode/skills/gpio-3d/SKILL.md",
  )
  expect(entrypoint).toContain(
    "cp /opt/open-bot/seed/skills/gpio-3d/validate-manifest.ts /home/agent/.config/opencode/skills/gpio-3d/validate-manifest.ts",
  )
})

test("seeded skill declares itself and the workspace model dir", () => {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8")
  expect(skill).toContain("name: gpio-3d")
  expect(skill).toContain("/home/agent/workspace/model")
})

test("vendored cli and validator accept the custom fit", () => {
  const constants = readFileSync(
    join(vendoredDir, "gpio_3d/constants.py"),
    "utf8",
  )
  expect(constants).toContain('"custom"')
  const exporter = readFileSync(join(vendoredDir, "gpio_3d/export.py"), "utf8")
  expect(exporter).toContain("fits must be custom, companion-header")
  const validator = readFileSync(join(skillDir, "validate-manifest.ts"), "utf8")
  expect(validator).toContain('"custom"')
})

test("vendored cli ships the improvement-report features", () => {
  const cli = readFileSync(join(vendoredDir, "gpio_3d/cli.py"), "utf8")
  expect(cli).toContain('"--save"')
  expect(cli).toContain('"--patch"')
  expect(cli).toContain("inspect")
  const mesh = readFileSync(join(vendoredDir, "gpio_3d/mesh.py"), "utf8")
  expect(mesh).toContain("missed the solid")
  expect(mesh).toContain("enclosed void")
  expect(mesh).toContain("FACE_AXES")
  expect(mesh).toContain("count_bodies")
  const recipe = readFileSync(join(vendoredDir, "gpio_3d/recipe.py"), "utf8")
  expect(recipe).toContain("LAST_RECIPE")
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8")
  expect(skill).toContain("valign")
  expect(skill).toContain("`face`")
  expect(skill).toContain("gpio-3d inspect")
  expect(skill).toContain("/opt/gpio-3d/venv/bin/python")
})

test("validates a model directory with custom fits", () => {
  withModel(
    [
      {
        name: "test-part",
        file: "test-part.glb",
        units: "mm",
        fits: ["custom"],
        color: "#22cc88",
      },
    ],
    (dir) => {
      const manifest = validateModelDir(dir)
      expect(manifest.tool).toBe("trimesh")
      expect(manifest.parts[0]?.fits).toEqual(["custom"])
      expect(manifest.parts[0]?.color).toBe("#22cc88")
    },
  )
})

test("rejects a part that names no board", () => {
  withModel(
    [{ name: "test-part", file: "test-part.glb", units: "mm", fits: [] }],
    (dir) => {
      expect(() => validateModelDir(dir)).toThrow(ModelManifestError)
    },
  )
})

test("rejects inches and a homemade tool", () => {
  withModel(
    [
      {
        name: "test-part",
        file: "test-part.glb",
        units: "in",
        fits: ["custom"],
      },
    ],
    (dir) => {
      expect(() => validateModelDir(dir)).toThrow("parts[0].units must be mm")
    },
  )
  withModel(
    [
      {
        name: "test-part",
        file: "test-part.glb",
        units: "mm",
        fits: ["custom"],
      },
    ],
    (dir) => {
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          version: 1,
          units: "mm",
          tool: "custom-kernel",
          parts: [
            {
              name: "test-part",
              file: "test-part.glb",
              units: "mm",
              fits: ["custom"],
            },
          ],
        }),
      )
      expect(() => validateModelDir(dir)).toThrow(
        "manifest tool must be trimesh",
      )
    },
  )
})

test("rejects a packed path and an extra mesh file", () => {
  withModel(
    [
      {
        name: "test-part",
        file: "../test-part.glb",
        units: "mm",
        fits: ["custom"],
      },
    ],
    (dir) => {
      expect(() => validateModelDir(dir)).toThrow("one kebab-case .glb")
    },
  )
  withModel(
    [
      {
        name: "test-part",
        file: "test-part.glb",
        units: "mm",
        fits: ["custom"],
      },
    ],
    (dir) => {
      writeFileSync(join(dir, "extra.glb"), glbBytes())
      expect(() => validateModelDir(dir)).toThrow("unexpected file extra.glb")
    },
  )
})

test("rejects a glb that is not one mesh", () => {
  withModel(
    [
      {
        name: "test-part",
        file: "test-part.glb",
        units: "mm",
        fits: ["custom"],
      },
    ],
    (dir) => {
      writeFileSync(join(dir, "test-part.glb"), "not-a-glb")
      expect(() => validateModelDir(dir)).toThrow("test-part.glb is not a glb")
    },
  )
})
