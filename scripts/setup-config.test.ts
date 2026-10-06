import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  defaultPublishHost,
  defaultPublishPort,
  manualCommands,
  parseDeployEnv,
  renderDeployEnv,
  stubAiSource,
  stubMarker,
  validatePublish,
  vikingImage,
} from "./setup-config.ts"

describe("setup config", () => {
  test("round-trips deploy env and does not collect a provider", () => {
    const publish = { publishHost: "127.0.0.1", publishPort: 9000 }
    expect(parseDeployEnv(renderDeployEnv(publish))).toEqual(publish)
    expect(
      validatePublish({ publishHost: "bad host", publishPort: 0 }),
    ).toHaveLength(2)
    const stub = stubAiSource()
    expect(stub).toContain(stubMarker)
    expect(stub).not.toContain("openai-compatible")
    expect(manualCommands().join("\n")).not.toContain("AI_BASE_URL")
  })

  test("compose publish defaults match the wizard", () => {
    const root = join(import.meta.dir, "..")
    const compose = readFileSync(join(root, "deploy/compose.yml"), "utf8")
    const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8")
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8")
    expect(compose).toContain(
      `"\${PUBLISH_HOST:-${defaultPublishHost}}:\${PUBLISH_PORT:-${defaultPublishPort}}:8787"`,
    )
    expect(compose).toContain('BIND_HOST: "0.0.0.0"')
    expect(compose).toContain("OPEN_BOT_AI_CONFIG: /app/config/ai.ts")
    expect(compose).toContain("../config/ai.ts:/app/config/ai.ts:ro")
    expect(dockerignore).toContain("config/ai.ts")
    expect(gitignore).toContain("deploy/.env")
    expect(manualCommands()[2]).toBe(`docker pull ${vikingImage}`)
  })
})
