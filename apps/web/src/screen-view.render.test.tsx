import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import type { ScreenCardState } from "./chat-view"
import { ScreenCard, type ScreenCardProps, ScreenStage } from "./ScreenView"

/**
 * The handoff card + stage are the user's hands on the agent's desktop:
 * view-only until an explicit takeover, exactly one primary action per
 * state, and finished shares collapse to receipts instead of stacking
 * live frames in the transcript. These tests pin that rendered contract.
 */

const noop = () => {}

function card(state: ScreenCardState, extra: Partial<ScreenCardProps> = {}) {
  return renderToStaticMarkup(
    <ScreenCard
      state={state}
      path="desktop/view/websockify?token=ses_abc"
      error=""
      timeLabel="14:32"
      reloadKey={0}
      takeDisabled={false}
      doneDisabled={false}
      onTakeControl={noop}
      onDone={noop}
      onReleaseSilent={noop}
      onLater={noop}
      onResume={noop}
      onOpenStage={noop}
      onCloseStage={noop}
      onRetry={noop}
      onStartDesktop={noop}
      {...extra}
    />,
  )
}

describe("ScreenCard — guided handoff states", () => {
  test("live share is view-only with steps and one primary action", () => {
    const html = card("live")
    expect(html).toContain("L’agent a besoin de vous")
    expect(html).toContain("En direct · vue seule")
    expect(html).toContain("Prenez le contrôle")
    expect(html).toContain("Faites l’action")
    expect(html).toContain("Rendez la main")
    expect(html).toContain("view_only=1")
    expect(html).toContain("Prendre le contrôle")
    expect(html).toContain("Pas maintenant")
    expect(html).not.toContain("Ctrl+Alt+Suppr")
  })

  test("held share drives in place, with send-keys and one-tap hand-back", () => {
    const html = card("held")
    expect(html).toContain("ob-screen-card-held")
    expect(html).toContain("Étape 2 — à vous de jouer")
    expect(html).toContain("Vous conduisez")
    expect(html).toContain("view_only=0")
    expect(html).toContain("Ctrl+Alt+Suppr")
    expect(html).toContain("C’est fait, à toi")
    expect(html).toContain("Rendre sans message")
  })

  test("finished, postponed and older shares are receipts, never frames", () => {
    const done = card("done")
    expect(done).toContain("Écran rendu à l’agent")
    expect(done).toContain("14:32")
    expect(done).not.toContain("<iframe")

    const later = card("later")
    expect(later).toContain("reporté — l’agent attend toujours")
    expect(later).toContain("Reprendre")
    expect(later).not.toContain("<iframe")

    const older = card("older")
    expect(older).toContain("remplacé par un partage plus récent")
    expect(older).not.toContain("<iframe")
  })

  test("opening, asleep, error and opened-aside have designed states", () => {
    expect(card("opening")).toContain("L’écran arrive…")
    const asleep = card("asleep")
    expect(asleep).toContain("Démarrer l’environnement")
    expect(asleep).not.toContain("<iframe")
    const error = card("error", { error: "délai dépassé" })
    expect(error).toContain("Écran indisponible")
    expect(error).toContain("Réessayer")
    expect(error).toContain("délai dépassé")
    const opened = card("opened")
    expect(opened).toContain("Écran ouvert à côté")
    expect(opened).not.toContain("<iframe")
  })
})

async function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<StrictMode>{node}</StrictMode>)
  })
  return {
    container,
    async unmount() {
      await act(async () => root?.unmount())
      container.remove()
    },
  }
}

function stage(held: boolean) {
  return (
    <ScreenStage
      title="Rapport hebdo"
      path="desktop/view/websockify?token=ses_abc"
      error=""
      held={held}
      reloadKey={0}
      controlDisabled={false}
      onToggleControl={noop}
      onReload={noop}
    />
  )
}

describe("ScreenStage — dock and fit", () => {
  test("view-only stage says so and hides the send-keys entry", () => {
    const html = renderToStaticMarkup(stage(false))
    expect(html).toContain("Écran de Rapport hebdo")
    expect(html).toContain("Prendre le contrôle")
    expect(html).toContain("Ajuster")
    expect(html).not.toContain("Touches")
    expect(html).toContain("resize=scale")
  })

  test("held stage offers hand-back and send-keys", () => {
    const html = renderToStaticMarkup(stage(true))
    expect(html).toContain("Vous conduisez — l’agent est en pause")
    expect(html).toContain("Rendre la main")
    expect(html).toContain("Touches")
    expect(html).toContain("view_only=0")
  })

  test("Ajuster → taille réelle remounts the frame at native resolution", async () => {
    const view = await mount(stage(false))
    try {
      const fitButton = [...view.container.querySelectorAll("button")].find(
        (b) => b.textContent?.includes("Ajuster"),
      )
      expect(fitButton).toBeDefined()
      await act(async () => fitButton?.click())
      const native = [...view.container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Taille réelle"),
      )
      expect(native).toBeDefined()
      await act(async () => native?.click())
      const frame = view.container.querySelector("iframe")
      expect(frame?.getAttribute("src")).toContain("resize=off")
    } finally {
      await view.unmount()
    }
  })
})
