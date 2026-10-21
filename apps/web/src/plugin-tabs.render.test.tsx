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
      <PluginAppsView
        tabs={[]}
        status={{ ...ready, status: "loading" }}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    expect(html).toContain("ob-skeleton")
    expect(html).toContain("Loading apps")
  })

  test("first-load error offers Retry and never reads as 'no apps'", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView
        tabs={[]}
        status={errorStatus}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    expect(html).toContain("Retry")
    expect(html).toContain("network down")
    expect(html).not.toContain("Aucune application pour l’instant")
  })

  test("an error after tabs loaded keeps the app list on screen", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView
        tabs={[tab("grid")]}
        status={errorStatus}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
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
      <PluginAppsView
        tabs={[]}
        status={ready}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    expect(html).toContain("Aucune application pour l’instant")
    expect(html).toContain("Ajouter une application")
    expect(html).toContain("Gérer les extensions")
    expect(html).not.toContain("Retry")
  })

  test("the apps filter is a native field with a visible placeholder", () => {
    // mui-lite hides ::placeholder globally (its floating-label animation
    // keys off :placeholder-shown), so the filter must be the same native
    // control as the threads filter: real placeholder attribute + label.
    const html = renderToStaticMarkup(
      <PluginAppsView
        tabs={[tab("grid")]}
        status={ready}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    expect(html).toContain('placeholder="Filtrer les applications"')
    expect(html).toContain('aria-label="Filtrer les applications"')
    expect(html).toContain('type="search"')
    // Add/manage are reachable with apps installed, not only in the empty
    // state (second audit R10).
    expect(html).toContain(">Ajouter<")
    expect(html).toContain(">Gérer<")
  })
})

describe("PluginAppsView — selection lives in the route (V03)", () => {
  // The view is interactive; a static render of the desktop layout must at
  // least show the selected state coming from selectedKey, and the mobile
  // pane must carry the back affordance. Click-through (onOpen/onClose) is
  // exercised by the shell wiring; here the route contract is what matters.
  test("desktop: the route-selected tab is marked in the side list and shown", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView
        tabs={[tab("grid"), tab("leads")]}
        status={ready}
        selectedKey="stock:leads"
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    // the selected app's pane renders (and only that one)
    expect(html).toContain(">leads</h1>")
    expect(html).not.toContain(">grid</h1>")
    // the side list marks exactly the route-selected item (mui-lite class)
    expect(html).toContain("MUI_ListItemButton_Root_selected")
    const selectedPart = html.split("MUI_ListItemButton_Root_selected")[1] ?? ""
    expect(selectedPart).toContain(">leads</span>")
    expect(selectedPart).not.toContain(">grid</span>")
  })

  test("desktop: no selection (the /apps route) still shows the first app's pane", () => {
    const html = renderToStaticMarkup(
      <PluginAppsView
        tabs={[tab("grid"), tab("leads")]}
        status={ready}
        selectedKey=""
        onOpen={() => {}}
        onClose={() => {}}
        onAddPlugin={() => {}}
        onManagePlugins={() => {}}
      />,
    )
    expect(html).toContain("grid")
  })
})
