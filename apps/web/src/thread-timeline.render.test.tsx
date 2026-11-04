import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  QueueDock,
  type ThreadQueueItemView,
  WorkLine,
} from "./thread-timeline"

const noop = () => {}
const saveNoop = async () => true

const item = (id: string, text: string): ThreadQueueItemView => ({
  id,
  sessionId: "s1",
  text,
  files: [],
  createdAt: 1,
})

describe("QueueDock — rendered contract", () => {
  test("renders nothing for an empty queue", () => {
    const html = renderToStaticMarkup(
      <QueueDock
        items={[]}
        busyId=""
        onSendNow={noop}
        onRemove={noop}
        onSaveEdit={saveNoop}
      />,
    )
    expect(html).toBe("")
  })

  test("queued text renders dashed, in full, with send/edit/remove actions", () => {
    const html = renderToStaticMarkup(
      <QueueDock
        items={[item("q1", "relis le rapport\npuis résume")]}
        busyId=""
        onSendNow={noop}
        onRemove={noop}
        onSaveEdit={saveNoop}
      />,
    )
    expect(html).toContain("ob-queue-card")
    expect(html).toContain("relis le rapport")
    expect(html).toContain("Envoyer maintenant")
    expect(html).toContain("Modifier le message en attente")
    expect(html).toContain("Retirer de la file d’attente")
  })

  test("a long queue collapses behind a show-all control", () => {
    const html = renderToStaticMarkup(
      <QueueDock
        items={[
          item("q1", "un"),
          item("q2", "deux"),
          item("q3", "trois"),
          item("q4", "quatre"),
          item("q5", "cinq"),
        ]}
        busyId=""
        onSendNow={noop}
        onRemove={noop}
        onSaveEdit={saveNoop}
      />,
    )
    expect(html).toContain("Afficher les 5 messages en attente")
    expect(html).toContain("un")
    expect(html).not.toContain("quatre")
  })

  test("image files render as thumbnails, other files as chips", () => {
    const html = renderToStaticMarkup(
      <QueueDock
        items={[
          {
            ...item("q1", "avec pièces"),
            files: [
              {
                id: "f1",
                name: "photo.png",
                mime: "image/png",
                url: "data:image/png;base64,QQ==",
              },
              {
                id: "f2",
                name: "notes.txt",
                mime: "text/plain",
                url: "data:text/plain;base64,QQ==",
              },
            ],
          },
        ]}
        busyId=""
        onSendNow={noop}
        onRemove={noop}
        onSaveEdit={saveNoop}
      />,
    )
    expect(html).toContain("ob-queue-thumb")
    expect(html).toContain("notes.txt")
  })
})

describe("WorkLine — rendered contract", () => {
  test("a finished turn reads as one summary line", () => {
    const html = renderToStaticMarkup(
      <WorkLine
        work={{
          steps: [
            { tool: "read", title: "src/app.ts", status: "completed" },
            { tool: "bash", title: "bash", status: "completed" },
          ],
          durationMs: 134_000,
          running: false,
        }}
      />,
    )
    expect(html).toContain("A travaillé 2 min 14 s · 2 étapes")
    // Steps stay hidden until the row is expanded.
    expect(html).not.toContain("src/app.ts")
  })

  test("a live turn reads as in-progress", () => {
    const html = renderToStaticMarkup(
      <WorkLine
        work={{
          steps: [{ tool: "bash", title: "bash", status: "running" }],
          durationMs: null,
          running: true,
        }}
      />,
    )
    expect(html).toContain("En cours · 1 étape")
    expect(html).toContain("ob-work-dot")
  })
})
