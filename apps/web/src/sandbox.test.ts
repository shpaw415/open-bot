import { expect, test } from "bun:test"
import {
  emptySandboxProfile,
  mergeSandboxSessions,
  sandboxExpiryLabel,
  sandboxModelLabel,
  sandboxProfileSummary,
  type SandboxThreadInfo,
} from "./sandbox"

const row = (over: Partial<SandboxThreadInfo> = {}): SandboxThreadInfo => ({
  sessionId: "ses-sbx",
  sandboxId: "sb1",
  title: "Bac à sable · locked",
  profile: "locked",
  network: "off",
  bash: false,
  state: "running",
  running: false,
  createdAt: 100,
  expiresAt: 200,
  lastActiveAt: 150,
  ...over,
})

test("merge adds sandbox-only sessions and keeps desktop duplicates", () => {
  const desktop = [{ id: "ses-desk", title: "Chat" }]
  const merged = mergeSandboxSessions(desktop, [row()])
  expect(merged.sessions.map((session) => session.id)).toEqual([
    "ses-desk",
    "ses-sbx",
  ])
  expect(merged.bySession.get("ses-sbx")?.sandboxId).toBe("sb1")
  const dup = mergeSandboxSessions([{ id: "ses-sbx", title: "Desktop win" }], [
    row(),
  ])
  expect(dup.sessions).toHaveLength(1)
  expect(dup.sessions[0]?.title).toBe("Desktop win")
  expect(dup.bySession.has("ses-sbx")).toBe(true)
})

test("expiry labels read in French minutes and hours", () => {
  const now = 1_000_000
  expect(sandboxExpiryLabel(now - 1, now)).toBe("expiré")
  expect(sandboxExpiryLabel(now + 5 * 60_000, now)).toBe("expire dans 5 min")
  expect(sandboxExpiryLabel(now + 120 * 60_000, now)).toBe("expire dans 2 h")
  expect(sandboxExpiryLabel(now + 125 * 60_000, now)).toBe(
    "expire dans 2 h 05",
  )
})

test("profile summary names the grant in one line", () => {
  expect(sandboxProfileSummary(emptySandboxProfile("x"))).toBe(
    "aucune compétence · aucun MCP · sans terminal · hors ligne",
  )
  const rich = emptySandboxProfile("y")
  rich.skills = ["research", "media"]
  rich.mcp = ["stock"]
  rich.tools.bash = true
  rich.network = "on"
  expect(sandboxProfileSummary(rich)).toBe(
    "2 compétences · 1 MCP · terminal · internet",
  )
})

test("model labels distinguish instance and vault-brokered refs", () => {
  expect(sandboxModelLabel(undefined)).toBe("Modèle de l'instance (chat)")
  expect(sandboxModelLabel("chat")).toBe("Modèle de l'instance (chat)")
  expect(sandboxModelLabel("small")).toBe("Modèle de l'instance (small)")
  expect(sandboxModelLabel("xai/grok-4.5")).toBe("Clé du coffre · xai/grok-4.5")
})
