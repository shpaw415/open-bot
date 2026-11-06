import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MessageSkeletons } from "./message-skeletons"

describe("MessageSkeletons — rendered contract", () => {
  test("renders bubble-shaped skeletons, not a spinner or loading text", () => {
    const html = renderToStaticMarkup(
      <MessageSkeletons
        rows={3}
        label="Chargement des messages plus anciens…"
      />,
    )
    expect(html).toContain("ob-msg-skeletons")
    expect(html).toContain("ob-msg-user")
    expect(html).toContain("ob-msg-assistant")
    expect(html).toContain("Skeleton")
    // The loading wording stays available to assistive tech only
    // (<output> carries the status role).
    expect(html).toContain("<output")
    expect(html).toContain('aria-label="Chargement des messages plus anciens…"')
    expect(html).not.toContain("CircularProgress")
    expect(html).not.toContain(">Chargement des messages plus anciens…<")
  })

  test("rows controls how many skeleton bubbles render", () => {
    const html = renderToStaticMarkup(<MessageSkeletons rows={2} />)
    expect(html.match(/ob-msg-skeleton(?![\w-])/g) ?? []).toHaveLength(2)
  })

  test("defaults to three skeleton bubbles", () => {
    const html = renderToStaticMarkup(<MessageSkeletons />)
    expect(html.match(/ob-msg-skeleton(?![\w-])/g) ?? []).toHaveLength(3)
  })
})
