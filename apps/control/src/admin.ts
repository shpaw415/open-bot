import type { Db, Role, User } from "@open-bot/db"
import { desktopPhase, destroyDesktop, stopDesktop } from "./docker"
import { randomToken } from "./passwords"
import { dayLabel, fillDays, usageDays, utcDay } from "./usage"

const kinds = ["chat", "small", "embed", "vlm"] as const

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function readJson(req: Request) {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>
}

export function accountActionError(
  actorId: string,
  target: { id: string; role: Role; disabled: boolean },
  action: "delete" | "disable" | "demote",
  enabledAdmins: number,
) {
  if (action === "delete" && actorId === target.id)
    return "cannot delete yourself"
  if (action === "disable" && actorId === target.id)
    return "cannot disable yourself"
  const removesAdmin =
    target.role === "admin" &&
    !target.disabled &&
    (action === "delete" || action === "disable" || action === "demote")
  if (removesAdmin && enabledAdmins <= 1) return "cannot remove the last admin"
  return null
}

function emptyKind() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
}

export async function handleAdmin(req: Request, url: URL, db: Db, actor: User) {
  if (actor.role !== "admin") return json({ error: "admin only" }, 403)
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const users = db.listUsers()
    const phases = await Promise.all(
      users.map(async (row) => ({
        ...row,
        desktop: await desktopPhase(row.id),
      })),
    )
    return json({ users: phases })
  }
  if (url.pathname === "/api/admin/usage" && req.method === "GET") {
    const days = usageDays(url.searchParams.get("days"))
    const userId = url.searchParams.get("userId") || undefined
    const since = utcDay(Date.now()) - (days - 1) * 86_400_000
    const rows = db.usageGrouped(since, userId)
    const emails = new Map(db.listUsers().map((row) => [row.id, row.email]))
    const totals = emptyKind()
    const byKind = new Map(kinds.map((kind) => [kind, emptyKind()]))
    const daily = new Map<
      number,
      Map<
        string,
        {
          email: string
          byKind: Record<string, ReturnType<typeof emptyKind>>
        }
      >
    >()
    for (const day of fillDays(Date.now(), days)) daily.set(day, new Map())
    for (const row of rows) {
      totals.promptTokens += row.promptTokens
      totals.completionTokens += row.completionTokens
      totals.totalTokens += row.totalTokens
      totals.calls += row.calls
      const kindBucket = byKind.get(row.kind as (typeof kinds)[number])
      if (kindBucket) {
        kindBucket.promptTokens += row.promptTokens
        kindBucket.completionTokens += row.completionTokens
        kindBucket.totalTokens += row.totalTokens
        kindBucket.calls += row.calls
      }
      const bucket = daily.get(row.day) ?? new Map()
      daily.set(row.day, bucket)
      const user = bucket.get(row.userId) ?? {
        email: emails.get(row.userId) ?? row.userId,
        byKind: Object.fromEntries(kinds.map((kind) => [kind, emptyKind()])),
      }
      const slot = user.byKind[row.kind] ?? emptyKind()
      slot.promptTokens += row.promptTokens
      slot.completionTokens += row.completionTokens
      slot.totalTokens += row.totalTokens
      slot.calls += row.calls
      user.byKind[row.kind] = slot
      bucket.set(row.userId, user)
    }
    return json({
      days,
      totals,
      byKind: kinds.map((kind) => ({ kind, ...byKind.get(kind) })),
      daily: [...daily.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, users]) => ({
          day: dayLabel(day),
          users: [...users.entries()].map(([id, user]) => ({
            userId: id,
            email: user.email,
            byKind: user.byKind,
          })),
        })),
    })
  }
  if (url.pathname === "/api/admin/invites" && req.method === "GET") {
    return json({ invites: db.listInvites() })
  }
  if (url.pathname === "/api/admin/invites" && req.method === "POST") {
    const code = randomToken().slice(0, 16)
    db.createInvite(code, null)
    return json({ code })
  }
  const inviteMatch = url.pathname.match(/^\/api\/admin\/invites\/([^/]+)$/)
  if (inviteMatch && req.method === "DELETE") {
    const code = decodeURIComponent(inviteMatch[1] ?? "")
    if (!db.revokeInvite(code)) return json({ error: "invite not found" }, 404)
    return json({ ok: true })
  }
  const userMatch = url.pathname.match(
    /^\/api\/admin\/users\/([^/]+)(?:\/(disable|enable|reset-password))?$/,
  )
  if (!userMatch) return json({ error: "not found" }, 404)
  const target = db.userById(decodeURIComponent(userMatch[1] ?? ""))
  if (!target) return json({ error: "user not found" }, 404)
  const action = userMatch[2]
  if (req.method === "POST" && action === "disable") {
    const error = accountActionError(
      actor.id,
      target,
      "disable",
      db.enabledAdminCount(),
    )
    if (error) return json({ error }, 400)
    db.setDisabled(target.id, true)
    db.deleteUserSessions(target.id)
    await stopDesktop(target.id)
    return json({ ok: true })
  }
  if (req.method === "POST" && action === "enable") {
    db.setDisabled(target.id, false)
    return json({ ok: true })
  }
  if (req.method === "POST" && action === "reset-password") {
    db.forcePasswordReset(target.id)
    db.deleteUserSessions(target.id)
    return json({ ok: true })
  }
  if (req.method === "PATCH" && !action) {
    const body = await readJson(req)
    const role =
      body.role === "admin" ? "admin" : body.role === "user" ? "user" : ""
    if (!role) return json({ error: "role must be admin or user" }, 400)
    if (role === "user") {
      const error = accountActionError(
        actor.id,
        target,
        "demote",
        db.enabledAdminCount(),
      )
      if (error) return json({ error }, 400)
    }
    db.setRole(target.id, role)
    return json({ ok: true })
  }
  if (req.method === "DELETE" && !action) {
    const error = accountActionError(
      actor.id,
      target,
      "delete",
      db.enabledAdminCount(),
    )
    if (error) return json({ error }, 400)
    await destroyDesktop(target.id)
    db.deleteUser(target.id)
    return json({ ok: true })
  }
  return json({ error: "not found" }, 404)
}
