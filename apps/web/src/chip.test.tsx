import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Chip } from "./chip"

// The audit found <Chip label="…" /> rendering an attribute but no visible
// text (mui-lite only renders children). These tests check the RENDERED
// markup, not the React props.
describe("Chip — rendered text contract", () => {
  test("label prop produces visible text", () => {
    const html = renderToStaticMarkup(<Chip label="secret-protected" />)
    expect(html).toContain(">secret-protected<")
  })

  test("label survives status/paid-free style values", () => {
    for (const value of ["free", "$4.99", "approved", "desktop running"]) {
      expect(renderToStaticMarkup(<Chip label={value} />)).toContain(
        `>${value}<`,
      )
    }
  })

  test("children still render (native mui-lite usage)", () => {
    const html = renderToStaticMarkup(<Chip>policy: manual</Chip>)
    expect(html).toContain(">policy: manual<")
  })

  test("children win over label when both are given", () => {
    const html = renderToStaticMarkup(<Chip label="fallback">explicit</Chip>)
    expect(html).toContain(">explicit<")
    expect(html).not.toContain(">fallback<")
  })

  test("no stray label attribute leaks to the DOM", () => {
    const html = renderToStaticMarkup(<Chip label="on" />)
    expect(html).not.toContain('label="on"')
  })
})
