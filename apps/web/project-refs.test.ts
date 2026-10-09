import { describe, expect, test } from "bun:test"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { projectRefUrl, remarkProjectRefs } from "./src/project-refs"

const markdownPlugins = [remarkGfm]
const refs = [{ name: "demo", path: "/home/agent/demo" }]

function render(text: string, withRefs: boolean) {
  const plugins = withRefs
    ? [...markdownPlugins, () => remarkProjectRefs(refs)]
    : markdownPlugins
  return Markdown({ remarkPlugins: plugins, children: text } as never)
}

function collectRefHrefs(node: unknown, hits: string[] = []): string[] {
  const element = node as { props?: { href?: string; children?: unknown } }
  if (element?.props?.href?.startsWith("#project-ref/"))
    hits.push(element.props.href)
  const children = element?.props?.children
  if (Array.isArray(children))
    for (const child of children) collectRefHrefs(child, hits)
  return hits
}

describe("remarkProjectRefs", () => {
  const text =
    "see @projects/demo here\n\n```js\n// @projects/demo in code\n```\n"

  test("the plugin must be attached as a factory, not invoked eagerly", () => {
    expect(() =>
      Markdown({
        remarkPlugins: [...markdownPlugins, remarkProjectRefs(refs)],
        children: text,
      } as never),
    ).toThrow()
  })

  test("wraps mentions as inert ref links", () => {
    const hrefs = collectRefHrefs(render(text, true))
    expect(hrefs).toEqual([projectRefUrl("demo", refs[0].path)])
  })

  test("leaves code blocks untouched", () => {
    const out = render(text, true)
    expect(JSON.stringify(out)).toContain("@projects/demo in code")
    expect(collectRefHrefs(out)).toHaveLength(1)
  })

  test("renders plain markdown without refs", () => {
    expect(collectRefHrefs(render(text, false))).toEqual([])
  })
})
