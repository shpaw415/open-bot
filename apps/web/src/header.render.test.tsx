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
    const profile = indexOf(html, 'aria-label="Account — casey@example.com"')
    const theme = indexOf(html, 'aria-label="Switch to light mode"')
    const notifications = indexOf(html, 'aria-label="Notifications"')
    const search = indexOf(
      html,
      'aria-label="Search apps, threads and projects"',
    )
    expect(profile).toBeLessThan(theme)
    expect(theme).toBeLessThan(notifications)
    expect(notifications).toBeLessThan(search)
  })

  test("exactly one theme control exists anywhere in the header", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    expect(html.split('aria-label="Switch to light mode"').length - 1).toBe(1)
    // No sound toggle or native-permission bell duplicates in the header.
    expect(html).not.toContain("Reply sound")
    expect(html).not.toContain('aria-label="Turn on notifications"')
  })

  test("brand uses the normalized mark and stays a link to chat", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} />)
    expect(html).toContain('src="/logo-mark.png"')
    expect(html).toContain("open-bot")
    expect(html).toContain('aria-label="open-bot — go to chat"')
  })

  test("the nav toggle mirrors the rail state with aria-expanded", () => {
    const expanded = renderToStaticMarkup(
      <AppHeader {...baseProps} navCollapsed={false} />,
    )
    expect(expanded).toContain('aria-label="Collapse navigation"')
    expect(expanded).toContain('aria-expanded="true"')
    const collapsed = renderToStaticMarkup(
      <AppHeader {...baseProps} navCollapsed={true} />,
    )
    expect(collapsed).toContain('aria-label="Expand navigation"')
    expect(collapsed).toContain('aria-expanded="false"')
  })

  test("mobile renders a hamburger that opens navigation, not a collapse toggle", () => {
    const html = renderToStaticMarkup(<AppHeader {...baseProps} mobile />)
    expect(html).toContain('aria-label="Open navigation"')
    expect(html).not.toContain("Collapse navigation")
    // The inline search input is replaced by a search button on phones.
    expect(html).toContain('aria-label="Search"')
    expect(html).not.toContain('aria-label="Search apps, threads and projects"')
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
    expect(html).toContain('aria-label="Notifications, 12 unread"')
    clearNotices()
  })

  test("light mode advertises the dark switch", () => {
    const html = renderToStaticMarkup(
      <AppHeader {...baseProps} themeMode="light" />,
    )
    expect(html).toContain('aria-label="Switch to dark mode"')
  })
})
