import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import Stack from "./stack"

function classes(html: string): string[] {
  const match = /class="([^"]*)"/.exec(html)
  if (!match) throw new Error("no class attribute rendered")
  return match[1].split(/\s+/).filter(Boolean)
}

describe("local Stack — className contract", () => {
  test("a custom className lands as one exact token", () => {
    const html = renderToStaticMarkup(
      <Stack className="ob-input-row ob-composer" spacing={1}>
        x
      </Stack>,
    )
    const tokens = classes(html)
    expect(tokens).toContain("ob-composer")
    expect(tokens).toContain("ob-input-row")
    // the upstream bug rendered the array join: "ob-composer," with a comma
    expect(tokens.some((token) => token.includes(","))).toBe(false)
  })

  test("classList.contains finds the hook class (querySelector-safe)", () => {
    const html = renderToStaticMarkup(
      <Stack className="ob-composer" sx={{ p: 1 }}>
        x
      </Stack>,
    )
    const tokens = classes(html)
    expect(tokens).toContain("ob-composer")
  })

  test("sx classes join without comma-corruption", () => {
    const html = renderToStaticMarkup(
      <Stack sx={{ flex: 1, "&:hover": { opacity: 0.5 } } as never}>x</Stack>,
    )
    const tokens = classes(html)
    expect(tokens.some((token) => token.startsWith(","))).toBe(false)
  })

  test("keeps the mui-lite layout classes and inline direction/gap", () => {
    const html = renderToStaticMarkup(
      <Stack direction="row" spacing={0.5} alignItems="center">
        x
      </Stack>,
    )
    const tokens = classes(html)
    expect(tokens).toContain("MUI_Stack")
    expect(tokens).toContain("MUI_Stack_row")
    expect(tokens).toContain("MUI_Stack_gap")
    expect(html).toContain("flex-direction:row")
    expect(html).toContain("gap:4px")
  })

  test("divider slots still render between children", () => {
    const html = renderToStaticMarkup(<Stack divider={<hr />}>a</Stack>)
    // single child: no divider
    expect(html).not.toContain("<hr")
    const two = renderToStaticMarkup(
      <Stack divider={<hr />}>
        <span>a</span>
        <span>b</span>
      </Stack>,
    )
    expect(two.split("<hr").length - 1).toBe(1)
  })
})
