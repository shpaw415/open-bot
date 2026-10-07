import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@open-bot/db"
import {
  claimThreadTitle,
  guardThreadTitle,
  isStockTitle,
  nameMessage,
  promptText,
  refineThreadTitle,
  sanitizeLlmTitle,
  titleFromPrompt,
} from "./thread-title"

type Upstream = {
  base: string
  title: () => string
  patches: () => string[]
  deletes: () => string[]
  prompts: () => Record<string, unknown>[]
  replyWith: (text: string) => void
  failPrompts: () => void
  stop: () => void
}

function startUpstream(initial: string): Upstream {
  const state = { title: initial }
  const patches: string[] = []
  const deletes: string[] = []
  const prompts: Record<string, unknown>[] = []
  let runSessions: { id: string; title: string }[] = []
  let reply = ""
  let breakPrompts = false
  let runSeq = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (url.pathname === "/session" && req.method === "GET")
        return Response.json([
          { id: "ses_thread", title: state.title },
          ...runSessions,
        ])
      if (url.pathname === "/session" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          title?: string
        } | null
        const id = `ses_run_${++runSeq}`
        runSessions = [...runSessions, { id, title: body?.title ?? "" }]
        return Response.json({ id })
      }
      if (/\/session\/[^/]+\/prompt_async$/.test(url.pathname)) {
        if (breakPrompts) return new Response("nope", { status: 500 })
        const body = (await req.json().catch(() => null)) as Record<
          string,
          unknown
        >
        prompts.push(body ?? {})
        return new Response(null, { status: 204 })
      }
      if (/\/session\/[^/]+\/message$/.test(url.pathname)) {
        const id = url.pathname.split("/")[2]
        const run = runSessions.find((row) => row.id === id)
        if (!run) return Response.json([])
        return Response.json([
          { info: { role: "user" }, parts: [] },
          {
            info: { role: "assistant" },
            parts: reply ? [{ type: "text", text: reply }] : [],
          },
        ])
      }
      if (!url.pathname.startsWith("/session/"))
        return new Response("not found", { status: 404 })
      const id = decodeURIComponent(url.pathname.slice("/session/".length))
      if (req.method === "GET") {
        const run = runSessions.find((row) => row.id === id)
        return Response.json({ title: run ? run.title : state.title })
      }
      if (req.method === "PATCH") {
        const body = (await req.json().catch(() => null)) as {
          title?: string
        } | null
        if (typeof body?.title === "string") {
          state.title = body.title
          patches.push(body.title)
        }
        return Response.json({ title: state.title })
      }
      if (req.method === "DELETE") {
        deletes.push(id)
        runSessions = runSessions.filter((row) => row.id !== id)
        return Response.json({ ok: true })
      }
      return new Response("bad method", { status: 405 })
    },
  })
  return {
    base: `http://127.0.0.1:${server.port}`,
    title: () => state.title,
    patches: () => [...patches],
    deletes: () => [...deletes],
    prompts: () => [...prompts],
    replyWith: (text) => {
      reply = text
    },
    failPrompts: () => {
      breakPrompts = true
    },
    stop: () => server.stop(true),
  }
}

function tempDb() {
  return openDatabase(
    join(mkdtempSync(join(tmpdir(), "ob-title-")), "bot.sqlite"),
  )
}

const REFINE = { deadlineMs: 400, pollMs: 50 }

async function claim(up: Upstream, db: ReturnType<typeof tempDb>) {
  return claimThreadTitle(up.base, {}, db, "u", "ses_a", "check the site\nrest")
}

describe("thread titles", () => {
  test("stock OpenCode titles are replaced from the prompt", () => {
    expect(isStockTitle("")).toBe(true)
    expect(isStockTitle("New session - 2026-10-06T16:16:39.111Z")).toBe(true)
    expect(isStockTitle("Horaire Agendrix")).toBe(false)
    expect(titleFromPrompt("  check the site\nthen stop")).toBe(
      "check the site",
    )
    expect(promptText({ parts: [{ type: "text", text: "hello" }] })).toBe(
      "hello",
    )
  })

  test("sanitized model output drops wrapping, prefixes, and fences", () => {
    expect(sanitizeLlmTitle("Check the Site")).toBe("Check the Site")
    expect(sanitizeLlmTitle('"Check the Site"')).toBe("Check the Site")
    expect(sanitizeLlmTitle("Title: Check the Site.")).toBe("Check the Site")
    expect(sanitizeLlmTitle("**Check the Site**")).toBe("Check the Site")
    expect(sanitizeLlmTitle("# Check the Site")).toBe("Check the Site")
    expect(sanitizeLlmTitle("```\nCheck the Site\n```")).toBe("Check the Site")
    expect(sanitizeLlmTitle("   \n  \n")).toBe("")
    const long = sanitizeLlmTitle("a".repeat(90))
    expect(long.length).toBe(80)
    expect(long.endsWith("…")).toBe(true)
  })

  test("the name message carries the instruction and the user text", () => {
    const message = nameMessage("fix my faucet")
    expect(message).toContain("short title")
    expect(message).toContain("fix my faucet")
    expect(nameMessage("a".repeat(500))).not.toContain("a".repeat(401))
  })

  test("first prompt claims the title from the user text", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const db = tempDb()
    try {
      const claimed = await claim(up, db)
      expect(claimed).toBe(true)
      expect(up.title()).toBe("check the site")
      expect(db.threadTitle("u", "ses_a")).toMatchObject({
        userId: "u",
        sessionId: "ses_a",
        title: "check the site",
        author: "ob",
      })
    } finally {
      up.stop()
    }
  })

  test("a second prompt never rewrites a claimed title", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const db = tempDb()
    try {
      await claim(up, db)
      const again = await claim(up, db)
      expect(again).toBe(false)
      expect(up.title()).toBe("check the site")
      expect(up.patches()).toEqual(["check the site"])
    } finally {
      up.stop()
    }
  })

  test("file-only prompts claim nothing", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const db = tempDb()
    try {
      await claimThreadTitle(up.base, {}, db, "u", "ses_a", "")
      expect(up.title()).toBe("New session - 2026-10-06T16:16:39.111Z")
      expect(db.threadTitle("u", "ses_a")).toBeNull()
    } finally {
      up.stop()
    }
  })

  test("claims back off when the title is already named", async () => {
    const up = startUpstream("Horaire Agendrix")
    const db = tempDb()
    try {
      await claim(up, db)
      expect(up.title()).toBe("Horaire Agendrix")
      expect(db.threadTitle("u", "ses_a")).toBeNull()
    } finally {
      up.stop()
    }
  })

  test("the refine run renames the thread from the model output", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const db = tempDb()
    try {
      expect(await claim(up, db)).toBe(true)
      up.replyWith('"Vérifier le site"\n')
      await refineThreadTitle(up.base, {}, db, "u", "ses_a", "check the site", {
        ...REFINE,
      })
      const prompts = up.prompts()
      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.agent).toBe("namer")
      expect(JSON.stringify(prompts[0])).toContain("check the site")
      expect(up.title()).toBe("Vérifier le site")
      expect(db.threadTitle("u", "ses_a")?.title).toBe("Vérifier le site")
      expect(up.deletes()).toEqual(["ses_run_1"])
    } finally {
      up.stop()
    }
  })

  test("a failed or empty refine keeps the claimed title", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const db = tempDb()
    try {
      await claim(up, db)
      up.failPrompts()
      await refineThreadTitle(up.base, {}, db, "u", "ses_a", "check the site", {
        ...REFINE,
      })
      expect(up.title()).toBe("check the site")
      expect(db.threadTitle("u", "ses_a")?.title).toBe("check the site")
      up.replyWith("   \n  ")
      await refineThreadTitle(up.base, {}, db, "u", "ses_a", "check the site", {
        deadlineMs: 100,
        pollMs: 20,
      })
      expect(up.title()).toBe("check the site")
      expect(up.deletes()).toEqual(["ses_run_1", "ses_run_2"])
    } finally {
      up.stop()
    }
  })

  test("refine skips threads without an ob claim", async () => {
    const up = startUpstream("check the site")
    const db = tempDb()
    try {
      await refineThreadTitle(up.base, {}, db, "u", "ses_a", "check the site", {
        ...REFINE,
      })
      db.setThreadTitle({
        userId: "u",
        sessionId: "ses_b",
        title: "my name",
        author: "user",
        createdAt: 1,
      })
      await refineThreadTitle(up.base, {}, db, "u", "ses_b", "check the site", {
        ...REFINE,
      })
      expect(up.prompts()).toEqual([])
      expect(up.deletes()).toEqual([])
    } finally {
      up.stop()
    }
  })

  test("the guard protects the refined title and skips user renames", async () => {
    const up = startUpstream("VNC screen assistant")
    const db = tempDb()
    try {
      db.setThreadTitle({
        userId: "u",
        sessionId: "ses_a",
        title: "Vérifier le site",
        author: "ob",
        createdAt: 1,
      })
      await guardThreadTitle(up.base, {}, db, "u", "ses_a")
      expect(up.title()).toBe("Vérifier le site")
      db.setThreadTitle({
        userId: "u",
        sessionId: "ses_b",
        title: "my better name",
        author: "user",
        createdAt: 1,
      })
      await guardThreadTitle(up.base, {}, db, "u", "ses_b")
      expect(up.patches()).toEqual(["Vérifier le site"])
    } finally {
      up.stop()
    }
  })

  test("title rows round-trip and clear", () => {
    const db = tempDb()
    db.setThreadTitle({
      userId: "u",
      sessionId: "ses_a",
      title: "my name",
      author: "user",
      createdAt: 1,
    })
    db.setThreadTitle({
      userId: "u",
      sessionId: "ses_a",
      title: "my name 2",
      author: "ob",
      createdAt: 2,
    })
    expect(db.threadTitle("u", "ses_a")).toEqual({
      userId: "u",
      sessionId: "ses_a",
      title: "my name 2",
      author: "ob",
      createdAt: 2,
    })
    db.clearThreadTitle("u", "ses_a")
    expect(db.threadTitle("u", "ses_a")).toBeNull()
  })

  test("claim errors stay silent and leave no row", async () => {
    const up = startUpstream("New session - 2026-10-06T16:16:39.111Z")
    const base = up.base
    up.stop()
    const db = tempDb()
    await expect(
      claimThreadTitle(base, {}, db, "u", "ses_a", "check the site"),
    ).resolves.toBe(false)
    expect(db.threadTitle("u", "ses_a")).toBeNull()
  })
})
