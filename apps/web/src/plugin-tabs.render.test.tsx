import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  PluginAppsView,
  type PluginsViewStatus,
  type PluginTab,
} from "./plugin-tabs"

function tab(id: string): PluginTab {
  return {
    key: `stock:${id}`,
    pluginId: "stock",
    pluginName: "Stock",
    tabId: id,
    title: id,
    kind: "page",
  }
}

const ready: PluginsViewStatus = {
  status: "ready",
  error: "",
  refreshing: false,
  refresh: () => Promise.resolve(),
}

const errorStatus: PluginsViewStatus = {
  status: "error",
  error: "network down",
  refreshing: false,
  refresh: () => Promise.resolve(),
}

describe("PluginAppsView — render", () => {
  test("first load renders skeletons, not a fake empty state", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView tabs={[]} status={{ ...ready, status: "loading" }} />,
    )
    expect(html).toContain("ob-skeleton")
    expect(html).toContain("Loading apps")
  })

  test("first-load error offers Retry and never reads as 'no apps'", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView tabs={[]} status={errorStatus} />,
    )
    expect(html).toContain("Retry")
    expect(html).toContain("network down")
    expect(html).not.toContain("No plugin apps here yet")
  })

  test("an error after tabs loaded keeps the app list on screen", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView tabs={[tab("grid")]} status={errorStatus} />,
    )
    // The last good tabs stay usable…
    expect(html).toContain("grid")
    // …and the failure is a quiet banner with a retry, not a replacement.
    expect(html).toContain("network down")
    expect(html).toContain("Retry")
    expect(html).not.toContain("Apps could not load")
  })

  test("an empty ready state is a real empty, not an error", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView tabs={[]} status={ready} />,
    )
    expect(html).toContain("No plugin apps here yet")
    expect(html).not.toContain("Retry")
  })

  test("the apps filter is a native field with a visible placeholder", () => {
    // mui-lite hides ::placeholder globally (its floating-label animation
    // keys off :placeholder-shown), so the filter must be the same native
    // control as the threads filter: real placeholder attribute + label.
    const html = renderToStaticMarkup(
      <PluginAppsView tabs={[tab("grid")]} status={ready} />,
    )
    expect(html).toContain('placeholder="Filter apps"')
    expect(html).toContain('aria-label="Filter apps"')
    expect(html).toContain('type="search"')
  })
})
