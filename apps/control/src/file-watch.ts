import { names } from "./env"

/**
 * Live file watching for the IDE: a small node watcher runs inside the
 * desktop container (fs.watch over /home/agent/workspace) and streams JSON
 * lines of changed paths over a long-lived docker exec stdout. The control
 * plane batches them and pushes them to dashboard sockets through the hub.
 */

type Watcher = {
  proc: Bun.Subprocess<"ignore", "pipe", "ignore"> | null
  retry: ReturnType<typeof setTimeout> | null
  flush: ReturnType<typeof setTimeout> | null
  batch: Set<string>
  stopped: boolean
}

const watchers = new Map<string, Watcher>()

let sink: ((userId: string, files: string[]) => void) | null = null

export function setFileWatchSink(
  fn: ((userId: string, files: string[]) => void) | null,
) {
  sink = fn
}

const WATCH_SCRIPT = `/* ob-file-watch-marker */
const { watch } = require("node:fs");
const root = "/home/agent/workspace";
let out = [];
let timer = null;
watch(root, { recursive: true }, (event, filename) => {
  if (!filename) return;
  const file = filename.startsWith("/") ? filename : root + "/" + filename;
  if (file.includes("/.git/") || file.includes("/node_modules/") || file.includes("/.open-bot/") || file.includes("/.openviking/") || file.includes("/.config/") || file.includes("/.cache/")) return;
  out.push(file);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const files = out.splice(0);
    if (files.length) console.log(JSON.stringify({ files }));
  }, 250);
});
console.log("ready");
`

function spawnOne(userId: string, watcher: Watcher) {
  if (watcher.stopped) return
  const n = names(userId)
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">
  try {
    proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-u",
        "agent",
        "-e",
        "HOME=/home/agent",
        n.opencode,
        "node",
        "-e",
        WATCH_SCRIPT,
      ],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    )
  } catch {
    scheduleRetry(userId, watcher)
    return
  }
  watcher.proc = proc
  void pump(userId, watcher, proc)
}

function scheduleRetry(userId: string, watcher: Watcher) {
  if (watcher.stopped) return
  watcher.retry = setTimeout(() => {
    watcher.retry = null
    spawnOne(userId, watcher)
  }, 2000)
}

async function pump(
  userId: string,
  watcher: Watcher,
  proc: Bun.Subprocess<"ignore", "pipe", "ignore">,
) {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        if (!line.startsWith("{")) continue
        try {
          const parsed = JSON.parse(line) as { files?: unknown }
          if (!Array.isArray(parsed.files)) continue
          for (const file of parsed.files) {
            if (
              typeof file === "string" &&
              file.startsWith("/home/agent/workspace/")
            )
              watcher.batch.add(file)
          }
        } catch {
          continue
        }
        if (watcher.batch.size > 0 && !watcher.flush) {
          watcher.flush = setTimeout(() => {
            watcher.flush = null
            const files = [...watcher.batch]
            watcher.batch.clear()
            if (files.length > 0) sink?.(userId, files)
          }, 300)
        }
      }
    }
  } catch {
    // stream torn down
  }
  watcher.proc = null
  scheduleRetry(userId, watcher)
}

export function startFileWatch(userId: string) {
  const existing = watchers.get(userId)
  if (existing) return
  const watcher: Watcher = {
    proc: null,
    retry: null,
    flush: null,
    batch: new Set(),
    stopped: false,
  }
  watchers.set(userId, watcher)
  spawnOne(userId, watcher)
}

export function stopFileWatch(userId: string) {
  const watcher = watchers.get(userId)
  if (!watcher) return
  watcher.stopped = true
  if (watcher.retry) clearTimeout(watcher.retry)
  if (watcher.flush) clearTimeout(watcher.flush)
  watcher.batch.clear()
  try {
    watcher.proc?.kill()
  } catch {
    // already gone
  }
  watchers.delete(userId)
}
