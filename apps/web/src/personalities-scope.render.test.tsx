import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { type ScopeEntry, type ScopeGroup, ScopePicker } from "./Personalities"

// The picker is controlled: the harness holds the selection the way the
// persona dialog does, so batch (All) clicks land in the same state.
function Harness({
  entries,
  dirs,
  max = 64,
  catalogFailed = false,
  filter = "",
}: {
  entries: ScopeEntry[]
  dirs: ScopeGroup[]
  max?: number
  catalogFailed?: boolean
  filter?: string
}) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <ScopePicker
      sectionTitle="Allowed skills"
      caption="Empty means all skills."
      filterLabel="Search skills"
      allChip="All skills"
      emptyBase="All skills (no restriction declared)"
      noMatch="No skills match the filter."
      loading="Loading skills…"
      manualLabel="Add skill by name"
      manualPlaceholder="research"
      manualError=""
      entries={entries}
      dirs={dirs}
      max={max}
      baseLocked={null}
      selected={selected}
      catalogLoading={false}
      catalogFailed={catalogFailed}
      filter={filter}
      manual=""
      lockedTitle="the plugin"
      onFilter={() => {}}
      onManual={() => {}}
      onManualAdd={() => {}}
      onToggle={(name) =>
        setSelected((prev) =>
          prev.includes(name)
            ? prev.filter((item) => item !== name)
            : [...prev, name],
        )
      }
      onToggleGroup={(names, select) =>
        setSelected((prev) =>
          select
            ? [...prev, ...names.filter((name) => !prev.includes(name))]
            : prev.filter((name) => !names.includes(name)),
        )
      }
      onClearAll={() => setSelected([])}
    />
  )
}

const entries: ScopeEntry[] = [
  {
    name: "research",
    description: "Research products across the web",
    dirId: "d1",
    pluginName: null,
  },
  {
    name: "media",
    description: "File pictures into the vault",
    dirId: "d1",
    pluginName: null,
  },
  {
    name: "headline-lab",
    description: "Draft headlines",
    dirId: null,
    pluginName: "writer-tools",
    groupLabel: "Writing",
  },
  {
    name: "loose-skill",
    description: "",
    dirId: null,
    pluginName: null,
  },
  {
    name: "desktop",
    description: "Drive this Linux desktop",
    dirId: null,
    pluginName: null,
    seed: true,
  },
]

const dirs: ScopeGroup[] = [{ id: "d1", label: "Research" }]

// mui-lite Chips are clickable divs (.MUI_Chip_Root); Buttons are <button>s.
function clickables(container: HTMLDivElement) {
  return [
    ...container.querySelectorAll("button, .MUI_Chip_Root"),
  ] as HTMLElement[]
}

function byText(
  container: HTMLDivElement,
  text: string,
  exact = false,
): HTMLElement {
  const found = clickables(container).find((el) => {
    const label = el.textContent?.trim() ?? ""
    return exact ? label === text : label.includes(text)
  })
  if (!found) throw new Error(`no clickable containing « ${text} »`)
  return found
}

// A group's batch chip: the caption span and the All chip share the group
// header row, so scope the lookup to that group's box.
function groupAllChip(container: HTMLDivElement, groupLabel: string) {
  const caption = [...container.querySelectorAll("*")].find(
    (el) => el.textContent?.trim() === groupLabel && el.children.length === 0,
  )
  if (!caption) throw new Error(`no group caption « ${groupLabel} »`)
  const groupBox = caption.parentElement?.parentElement
  const chip = groupBox?.querySelector<HTMLElement>(".MUI_Chip_Root")
  if (!chip) throw new Error(`no All chip in group « ${groupLabel} »`)
  return chip
}

async function mount(children: React.ReactNode) {
  const container = document.createElement("div")
  document.body.append(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(children)
  })
  return { container, root }
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}

describe("ScopePicker (advanced allowlist)", () => {
  test("renders grouped clouds: directories, plugin sections, Ungrouped", async () => {
    const { container, root } = await mount(
      <Harness entries={entries} dirs={dirs} />,
    )
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("Research")
      expect(text).toContain("From writer-tools · Writing")
      expect(text).toContain("Ungrouped")
      expect(text).toContain("headline-lab")
      // unfiled seed skills get their own Built-in section, not Ungrouped
      expect(text).toContain("Built-in")
      expect(text).toContain("desktop")
      // live cap counter
      expect(text).toContain("0 / 64")
      // every group — Ungrouped included — carries a batch chip
      expect(groupAllChip(container, "Ungrouped")).toBeTruthy()
      expect(groupAllChip(container, "Built-in")).toBeTruthy()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("the directory All chip batch-allows the group, then unselects", async () => {
    const { container, root } = await mount(
      <Harness entries={entries} dirs={dirs} />,
    )
    try {
      const all = groupAllChip(container, "Research")
      await click(all)
      expect(container.textContent).toContain("2 / 64")
      expect(all.getAttribute("aria-pressed")).toBe("true")
      await click(all)
      expect(container.textContent).toContain("0 / 64")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("partial selection shows All · n/m", async () => {
    const { container, root } = await mount(
      <Harness entries={entries} dirs={dirs} />,
    )
    try {
      await click(byText(container, "research", true))
      expect(groupAllChip(container, "Research").textContent).toContain(
        "All · 1/2",
      )
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("a batch that would exceed the cap is refused with an inline error", async () => {
    const { container, root } = await mount(
      <Harness entries={entries} dirs={dirs} max={3} />,
    )
    try {
      await click(byText(container, "headline-lab", true))
      await click(byText(container, "loose-skill", true))
      expect(container.textContent).toContain("2 / 3")
      // Batching the 2-member directory would land on 4 > 3: refused, the
      // selection and the counter stay put, the inline warning shows.
      await click(groupAllChip(container, "Research"))
      expect(container.textContent).toContain(
        "This would exceed the limit of 3",
      )
      expect(container.textContent).toContain("2 / 3")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("search matches descriptions, not just names", async () => {
    // "vault" appears only in media's description: its group keeps the
    // matching member, the rest of the catalog is filtered away.
    const { container, root } = await mount(
      <Harness entries={entries} dirs={dirs} filter="vault" />,
    )
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("media")
      expect(text).not.toContain("research")
      expect(text).not.toContain("headline-lab")
      expect(text).not.toContain("loose-skill")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("an unavailable catalog degrades to the manual-add affordance", async () => {
    const { container, root } = await mount(
      <Harness entries={[]} dirs={[]} catalogFailed />,
    )
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("The live list is unavailable")
      expect(text).toContain("Add skill by name")
      expect(text).toContain("No skills match the filter.")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
