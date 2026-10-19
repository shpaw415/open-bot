import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AppHeader } from "./AppHeader"
import type { Me } from "./api"
import { clearNotices, pushNotice } from "./notices"

const baseUser: Me = {
  id: "u1",
  email: "casey@example.com",
  role: "user",
}

const baseProps = {
  me: baseUser,
  mobile: false,
  pageContext: "Chat",
  themeMode: "dark" as const,
  onToggleTheme: () => {},
  onToggleNav: () => {},
  appTabs: [{ key: "stock:grid", title: "Grid", pluginName: "Stock" }],
  onOpenThread: () => {},
  go: () => {},
  onLogout: () => {},
}

function indexOf(html: string, marker: string): number {
  const at = html.indexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  return at
}

describe("AppHeader — render", () => {
  test("actions render in the required order: Profile · Theme · Notifications · Search", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    const profile = indexOf(html, 'aria-label="Compte — casey@example.com"')
    const theme = indexOf(html, 'aria-label="Passer en mode clair"')
    const notifications = indexOf(html, 'aria-label="Notifications"')
    const search = indexOf(
      html,
      'aria-label="Rechercher des destinations, applications, conversations et projets"',
    )
    expect(profile).toBeLessThan(theme)
    expect(theme).toBeLessThan(notifications)
    expect(notifications).toBeLessThan(search)
  })

  test("exactly one theme control exists anywhere in the header", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    expect(html.split('aria-label="Passer en mode clair"').length - 1).toBe(1)
    // No sound toggle or native-permission bell duplicates in the header.
    expect(html).not.toContain("Son de réponse")
    expect(html).not.toContain(
      'aria-label="Activer les notifications du navigateur"',
    )
  })

  test("brand uses the normalized mark and stays a link to chat", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    expect(html).toContain('src="/logo-mark.png"')
    expect(html).toContain("open-bot")
    expect(html).toContain('aria-label="open-bot — aller à l’accueil"')
  })

  test("the nav toggle mirrors the rail state with aria-expanded", () => {
    const expanded = renderToStaticMarkup(
      <AppHeader {...baseProps} navCollapsed={false} />,
    )
    expect(expanded).toContain('aria-label="Replier la navigation"')
    expect(expanded).toContain('aria-expanded="true"')
    const collapsed = renderToStaticMarkup(
      <AppHeader {...baseProps} navCollapsed={true} />,
    )
    expect(collapsed).toContain('aria-label="Déplier la navigation"')
    expect(collapsed).toContain('aria-expanded="false"')
  })

  test("mobile renders a hamburger that opens navigation, not a collapse toggle", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} mobile />)
    expect(html).toContain('aria-label="Ouvrir la navigation"')
    expect(html).not.toContain("Replier la navigation")
    // The inline search input is replaced by a search button on phones.
    expect(html).toContain('aria-label="Recherche"')
    expect(html).not.toContain(
      'aria-label="Rechercher des destinations, applications, conversations et projets"',
    )
  })

  test("the page context is announced next to the brand", () => {
    const html = renderToStaticMarkup(
      <AppHeader {...baseProps} pageContext="Settings · Plugins" />,
    )
    expect(html).toContain("Settings · Plugins")
  })

  test("the bell count caps at 9+ and names the unread count", () => {
    clearNotices()
    for (let index = 0; index < 12; index += 1) {
      pushNotice(
        { id: `n${index}`, kind: "reply", title: `N${index}`, body: "" },
        index + 1,
      )
    }
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    expect(html).toContain("9+")
    expect(html).toContain('aria-label="Notifications, 12 non lues"')
    clearNotices()
  })

  test("the notifications bell keeps its tooltip wrapper (stable trigger node)", () => {
    // The bell must render inside the ToolTip container unconditionally.
    // Swapping the wrapper out while the panel is open remounts the button,
    // so the opening click lands on a detached node and ClickAwayListener
    // closes the panel in the same event. Suppression while open is the
    // `disabled` prop, not a structure swap.
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    const bell = html.indexOf('aria-haspopup="dialog"')
    expect(bell).toBeGreaterThanOrEqual(0)
    const tipContainer = html.lastIndexOf("MUI_Tooltip-Container", bell)
    expect(tipContainer).toBeGreaterThanOrEqual(0)
    const wrapperClose = html.indexOf("</span>", tipContainer)
    expect(wrapperClose).toBeGreaterThan(bell)
  })

  test("light mode advertises the dark switch", () => {
    const html = renderToStaticMarkup(
      <AppHeader {...baseProps} themeMode="light" />,
    )
    expect(html).toContain('aria-label="Passer en mode sombre"')
  })
})
