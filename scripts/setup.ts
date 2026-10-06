#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { join } from "node:path"
import {
  defaultPublishHost,
  defaultPublishPort,
  manualCommands,
  type PublishAnswers,
  parseDeployEnv,
  renderDeployEnv,
  stubAiSource,
  validatePublish,
  vikingImage,
} from "./setup-config.ts"

const root = join(import.meta.dir, "..")
const aiPath = join(root, "config/ai.ts")
const envPath = join(root, "deploy/.env")

await main()

async function main() {
  if (existsSync("/.dockerenv") || process.env.OPEN_BOT_IN_DOCKER === "1") {
    console.error("run setup on the host, not inside the open-bot container")
    process.exit(1)
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("setup needs an interactive terminal")
    process.exit(1)
  }

  console.log("open-bot setup")
  step(1, "Prerequisites")
  const missing = await missingTools()
  if (missing.length > 0) {
    for (const label of missing) console.log(`  missing ${label}`)
    console.log(
      "install the missing tools, start Docker, then re-run bun run setup",
    )
    process.exit(1)
  }
  console.log("  bun, docker, compose, daemon ok")

  step(2, "Publish address")
  const hints = ipv4Hosts()
  if (hints.length > 0) console.log(`  addresses: ${hints.join(", ")}`)
  const publish = await collectPublish(loadPublish())

  step(3, "Write")
  console.log(`  url: http://${publish.publishHost}:${publish.publishPort}`)
  console.log("  OpenViking models and chat providers are set in the web UI.")
  if (!(await confirm("  Write deploy/.env?", true))) {
    console.log("aborted; nothing written")
    return
  }
  mkdirSync(join(root, "deploy"), { recursive: true })
  writeFileSync(envPath, renderDeployEnv(publish), { mode: 0o600 })
  console.log(`  wrote ${envPath}`)
  if (!existsSync(aiPath)) {
    writeFileSync(aiPath, stubAiSource(), { mode: 0o600 })
    console.log(`  wrote ${aiPath}`)
  }

  step(4, "Bring up")
  const start = await confirm(
    "  Install, build images, pull OpenViking, and start Compose?",
    true,
  )
  if (!start) {
    console.log("\nwhen you are ready:")
    for (const command of manualCommands()) console.log(`  ${command}`)
    return
  }
  const commands: [string, string[]][] = [
    ["bun", ["install"]],
    ["bun", ["run", "images"]],
    ["docker", ["pull", vikingImage]],
    [
      "docker",
      [
        "compose",
        "--env-file",
        "deploy/.env",
        "-f",
        "deploy/compose.yml",
        "up",
        "--build",
        "-d",
      ],
    ],
  ]
  for (const [command, args] of commands) {
    console.log(`\n> ${command} ${args.join(" ")}`)
    const code = await runInherit(command, args)
    if (code !== 0) process.exit(code)
  }
  console.log(`\nopen http://${publish.publishHost}:${publish.publishPort}`)
  console.log("login: admin@localhost / changeme")
  console.log("the first login must set a new password")
  console.log("then set OpenViking models in Admin")
  console.log("chat models are connected on the Providers page")
}

function step(n: number, title: string) {
  console.log(`\n${n}/4 ${title}`)
}

function loadPublish(): PublishAnswers {
  const parsed = parseDeployEnv(readText(envPath) ?? "")
  return {
    publishHost: parsed.publishHost || defaultPublishHost,
    publishPort: parsed.publishPort || defaultPublishPort,
  }
}

async function collectPublish(
  current: PublishAnswers,
): Promise<PublishAnswers> {
  const publishHost = await ask("Host", current.publishHost)
  const publishPort = await askInt("Port", current.publishPort, 1, 65535)
  const next = { publishHost, publishPort }
  const errors = validatePublish(next)
  if (errors.length === 0) return next
  for (const error of errors) console.log(`  ${error}`)
  return collectPublish(current)
}

async function missingTools() {
  const checks: [string, string, string[]][] = [
    ["bun", "bun", ["--version"]],
    ["docker", "docker", ["--version"]],
    ["compose", "docker", ["compose", "version"]],
    ["daemon", "docker", ["info"]],
  ]
  const missing: string[] = []
  for (const [label, command, args] of checks) {
    if (!(await runOk(command, args))) missing.push(label)
  }
  return missing
}

function runOk(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" })
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })
}

function runInherit(command: string, args: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

function ipv4Hosts() {
  const found: string[] = []
  for (const rows of Object.values(networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === "IPv4" && !row.internal) found.push(row.address)
    }
  }
  return found
}

function readText(path: string) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

async function ask(label: string, current: string) {
  const shown = current === "" ? "" : ` [${current}]`
  const answer = (await readLine(`  ${label}${shown}: `)).trim()
  return answer === "" ? current : answer
}

async function askInt(
  label: string,
  current: number,
  min: number,
  max: number,
) {
  while (true) {
    const answer = (await readLine(`  ${label} [${current}]: `)).trim()
    if (answer === "") return current
    const value = Number(answer)
    if (Number.isInteger(value) && value >= min && value <= max) return value
    console.log(`  enter an integer from ${min} to ${max}`)
  }
}

async function confirm(label: string, fallback: boolean): Promise<boolean> {
  const hint = fallback ? "Y/n" : "y/N"
  const answer = (await readLine(`${label} [${hint}] `)).trim().toLowerCase()
  if (answer === "") return fallback
  if (answer === "y" || answer === "yes") return true
  if (answer === "n" || answer === "no") return false
  console.log("  enter y or n")
  return confirm(label, fallback)
}

function readLine(prompt: string) {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin
    const stdout = process.stdout
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let value = ""
    const cleanup = () => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    const onData = (text: string) => {
      if (text.includes("\u0003")) {
        cleanup()
        stdout.write("\n")
        process.exit(130)
      }
      let rest = text
      while (rest.length > 0) {
        if (rest.startsWith("\u001b")) return
        if (
          rest.startsWith("\r\n") ||
          rest.startsWith("\n") ||
          rest.startsWith("\r")
        ) {
          cleanup()
          stdout.write("\n")
          resolve(value)
          return
        }
        if (rest.startsWith("\u007f") || rest.startsWith("\b")) {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write("\b \b")
          }
          rest = rest.slice(1)
          continue
        }
        const char = [...rest][0] ?? ""
        if (char < " ") {
          rest = rest.slice(char.length || 1)
          continue
        }
        value += char
        stdout.write(char)
        rest = rest.slice(char.length)
      }
    }
    stdin.on("data", onData)
  })
}
