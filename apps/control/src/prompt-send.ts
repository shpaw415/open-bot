import type { Db, User } from "@open-bot/db"
import { writeAgentUpload } from "./docker"
import { applyThreadModelChoice, basicOpencodeAuth } from "./effort"
import { JOINED_REPLY, prepareJoinedPrompt } from "./join-file"
import {
  applyPersonaScope,
  mergeSystem,
  personaSystem,
  resolvePersona,
} from "./personas"
import { PREVIEW_REPLY } from "./preview"
import { resolveReferenceLine } from "./references"
import {
  ensureThreadScreen,
  holdSystemLine,
  resolveRootSession,
  screenHeld,
} from "./screens"
import { claimThreadTitle, promptText, refineThreadTitle } from "./thread-title"
import { FILE_REPLY } from "./workspace-file"
import { IMAGE_REPLY } from "./workspace-image"
import { MODEL3D_REPLY } from "./workspace-model3d"
import { VIDEO_REPLY } from "./workspace-video"

/**
 * Turns a dashboard prompt body ({parts, model?}) into the exact body
 * opencode receives: joined-file uploads written to the desktop, the
 * persona + screen + reply-hint + reference system line merged in, the
 * thread title claimed, and the per-thread model/effort pick stamped.
 * Shared by the dashboard prompt proxy (server.ts) and the persisted
 * queue flush (thread-queue.ts) so a queued send is indistinguishable
 * from a direct one.
 */
export async function prepareDashboardPrompt(
  db: Db,
  user: User,
  opencodePassword: string,
  base: string,
  auth: HeadersInit,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prepared = prepareJoinedPrompt(body)
  for (const upload of prepared.uploads)
    await writeAgentUpload(user.id, upload.path, upload.bytes)
  const outbound = prepared.body
  const text = promptText(body)
  const root = await resolveRootSession(base, auth, sessionId)
  // The persona is resolved here for the system line anyway; the same
  // binding re-applies the skill ruleset (PATCH, fire-and-forget) so
  // persona edits, opencode restarts, and binding moves stay scoped
  // without a config write. One local ms-level call on persona-bound
  // threads only. Only an explicit binding scopes the thread — an
  // unbound thread has no persona at all and stays unrestricted.
  const binding = db.threadPersona(user.id, sessionId)
  const boundPersona = binding
    ? resolvePersona(db, user.id, binding.personaId)
    : null
  if (boundPersona)
    void applyPersonaScope(
      db,
      user.id,
      base,
      basicOpencodeAuth(opencodePassword),
      sessionId,
      boundPersona,
    )
  const screen = await Promise.race([
    ensureThreadScreen(db, user.id, root).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
  const line = [
    personaSystem(boundPersona),
    screen?.system ??
      `This thread's screen id (also your session id, for ob-thread --from) is ${root}. The screen is still starting: run the browser or screen command again in a moment and it will answer. Do not guess a VNC port. Do not call vncdo.`,
    screen &&
    (await Promise.race([
      screenHeld(user.id, root),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]))
      ? holdSystemLine()
      : "",
    prepared.uploads.length ? JOINED_REPLY : "",
    IMAGE_REPLY,
    VIDEO_REPLY,
    MODEL3D_REPLY,
    FILE_REPLY,
    PREVIEW_REPLY,
    await resolveReferenceLine(db, user, text),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
  if (text) {
    const claimed = await claimThreadTitle(base, auth, db, user.id, root, text)
    if (claimed) void refineThreadTitle(base, auth, db, user.id, root, text)
  }
  await applyThreadModelChoice(db, user.id, root, outbound)
  return { ...outbound, system: mergeSystem(outbound.system, line) }
}

/** Prepares and fires a dashboard prompt as a new turn. True when opencode accepted it. */
export async function sendDashboardPrompt(
  db: Db,
  user: User,
  opencodePassword: string,
  base: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const auth = basicOpencodeAuth(opencodePassword)
  const prepared = await prepareDashboardPrompt(
    db,
    user,
    opencodePassword,
    base,
    auth,
    sessionId,
    body,
  ).catch(() => null)
  if (!prepared) return false
  const res = await fetch(
    `${base}/session/${encodeURIComponent(sessionId)}/prompt_async`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(prepared),
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => null)
  return Boolean(res?.ok)
}
