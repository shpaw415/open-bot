"no action"

import { adminAuthorized } from "../../../lib/auth"
import {
  getIssue,
  ISSUE_NOTE_MAX,
  ISSUE_STATUSES,
  type IssueStatus,
  issuesSchemaSelfCheck,
  setIssueStatus,
} from "../../../lib/issues"

// Admin management of one relayed issue: read it, or PATCH its status
// (open|done|wontfix) and note. Closing here only closes the marketplace
// row — the GitHub issue is closed on GitHub (by the fix), never remotely.

export async function onRequestGet(context: EventContext<Env, "id", never>) {
  const schema = await issuesSchemaSelfCheck(context.env.DB)
  if (!schema.ok) {
    return Response.json(
      { error: schema.error, code: "migration_missing" },
      { status: 503 },
    )
  }
  if (!(await adminAuthorized(context.request, context.env.ADMIN_TOKEN))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  const issue = await getIssue(context.env.DB, id)
  if (!issue) {
    return Response.json({ error: "issue not found" }, { status: 404 })
  }
  return Response.json({ issue })
}

export async function onRequestPatch(context: EventContext<Env, "id", never>) {
  const schema = await issuesSchemaSelfCheck(context.env.DB)
  if (!schema.ok) {
    return Response.json(
      { error: schema.error, code: "migration_missing" },
      { status: 503 },
    )
  }
  if (!(await adminAuthorized(context.request, context.env.ADMIN_TOKEN))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const id = decodeURIComponent(context.params.id as string)
  let body: { status?: unknown; note?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 })
  }
  const status = typeof body.status === "string" ? body.status : ""
  if (!(ISSUE_STATUSES as readonly string[]).includes(status)) {
    return Response.json(
      { error: "status must be open, done, or wontfix" },
      { status: 400 },
    )
  }
  let note: string | null | undefined
  if (body.note !== undefined) {
    if (typeof body.note !== "string") {
      return Response.json({ error: "note must be a string" }, { status: 400 })
    }
    const trimmed = body.note.trim()
    if (trimmed.length > ISSUE_NOTE_MAX) {
      return Response.json(
        { error: `note must be at most ${ISSUE_NOTE_MAX} characters` },
        { status: 400 },
      )
    }
    note = trimmed || null
  }
  const issue = await setIssueStatus(
    context.env.DB,
    id,
    status as IssueStatus,
    note,
  )
  if (!issue) {
    return Response.json({ error: "issue not found" }, { status: 404 })
  }
  return Response.json({ issue })
}
