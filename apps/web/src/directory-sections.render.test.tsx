import { GlobalRegistrator } from "@happy-dom/global-registrator"

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { describe, expect, test } from "bun:test"
import { act, useId, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { DirectorySection } from "./directory-sections"

// Stateful wrapper mirroring useCollapsedDirs: the toggle must re-render.
// Real directories carry UUID ids; the harness mints one per instance the
// same way (unique — the lint refuses static id strings). Pass grouped=false
// to render the id-less Ungrouped-style bucket.
function Harness({
  label,
  initialCollapsed,
  grouped,
}: {
  label: string
  initialCollapsed?: string[]
  grouped?: boolean
}) {
  const generated = useId()
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initialCollapsed ?? []),
  )
  return (
    <DirectorySection
      group={{ id: grouped ? generated : null, label, count: 1 }}
      collapsed={collapsed}
      onToggle={(key) =>
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }
      emptyText="empty"
    >
      <div>{label}-card</div>
    </DirectorySection>
  )
}

function headerButton(root: HTMLDivElement) {
  const button = root.querySelector("button")
  if (!button) throw new Error("header button did not render")
  return button as HTMLButtonElement
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

async function click(header: HTMLButtonElement) {
  await act(async () => {
    header.click()
  })
}

describe("DirectorySection", () => {
  test("a directory section collapses and re-expands from the header", async () => {
    const { container, root } = await mount(
      <Harness grouped label="Research" />,
    )
    try {
      expect(container.textContent).toContain("Research-card")
      await click(headerButton(container))
      expect(container.textContent).not.toContain("Research-card")
      await click(headerButton(container))
      expect(container.textContent).toContain("Research-card")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("the id-less Ungrouped bucket collapses too (bug: it never did)", async () => {
    const { container, root } = await mount(<Harness label="Ungrouped" />)
    try {
      expect(container.textContent).toContain("Ungrouped-card")
      await click(headerButton(container))
      expect(container.textContent).not.toContain("Ungrouped-card")
      await click(headerButton(container))
      expect(container.textContent).toContain("Ungrouped-card")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test("a collapsed section stays closed until toggled again", async () => {
    const { container, root } = await mount(
      <Harness label="Ungrouped" initialCollapsed={["auto:Ungrouped"]} />,
    )
    try {
      expect(container.textContent).not.toContain("Ungrouped-card")
      await click(headerButton(container))
      expect(container.textContent).toContain("Ungrouped-card")
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
