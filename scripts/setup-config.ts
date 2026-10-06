export const defaultPublishHost = "100.96.0.3"
export const defaultPublishPort = 8787
export const stubMarker = "replace config/ai.ts with your provider"
export const vikingImage = "ghcr.io/volcengine/openviking:latest"

export type PublishAnswers = {
  publishHost: string
  publishPort: number
}

export function renderDeployEnv(input: PublishAnswers) {
  return `PUBLISH_HOST=${input.publishHost}\nPUBLISH_PORT=${input.publishPort}\n`
}

export function parseDeployEnv(source: string): Partial<PublishAnswers> {
  const values = new Map<string, string>()
  for (const line of source.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  const publishHost = values.get("PUBLISH_HOST")
  const port = Number(values.get("PUBLISH_PORT"))
  return {
    publishHost: publishHost || undefined,
    publishPort: Number.isInteger(port) ? port : undefined,
  }
}

export function validatePublish(input: PublishAnswers) {
  const errors: string[] = []
  if (!input.publishHost || /[\s:]/.test(input.publishHost)) {
    errors.push("publish host must be an IPv4 address or hostname")
  }
  if (
    !Number.isInteger(input.publishPort) ||
    input.publishPort < 1 ||
    input.publishPort > 65535
  ) {
    errors.push("publish port must be 1-65535")
  }
  return errors
}

export function stubAiSource() {
  return `import { defineAi } from "../packages/ai/src/index.ts"

export default defineAi({
  models: {
    chat: { id: "unset", name: "Unset", context: 8192, output: 1024 },
    small: { id: "unset", name: "Unset", context: 8192, output: 1024 },
    embed: { id: "unset", name: "Unset", dimension: 8 },
    vlm: { id: "unset", name: "Unset", context: 8192, output: 1024 },
  },
  api: {
    async chat() {
      throw new Error("${stubMarker}")
    },
    async embed() {
      throw new Error("${stubMarker}")
    },
  },
})
`
}

export function manualCommands() {
  return [
    "bun install",
    "bun run images",
    `docker pull ${vikingImage}`,
    "docker compose --env-file deploy/.env -f deploy/compose.yml up --build -d",
  ]
}
