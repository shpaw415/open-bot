import { agentFilePath, findAgentFilePaths } from "./chat-view"

type MdNode = {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

/**
 * Remark plugin: linkifies bare desktop file paths in chat prose
 * ("saved to /home/agent/workspace/report.pdf") and backticked ones
 * ("see `/home/agent/notes.md`"), so every disk reference an agent makes
 * can be opened. Runs on mdast text/inlineCode only — code fences,
 * existing links, and link destinations are never touched; the href is
 * routed to the file endpoint by chat-markdown's urlTransform.
 */
export function remarkAgentFiles() {
  return (tree: MdNode) => {
    const walk = (node: MdNode, inLink: boolean): void => {
      if (!node.children) return
      const next: MdNode[] = []
      let changed = false
      for (const child of node.children) {
        if (!inLink && child.type === "text" && child.value) {
          const hits = findAgentFilePaths(child.value)
          if (hits.length) {
            changed = true
            let pos = 0
            for (const hit of hits) {
              if (hit.start < pos) continue
              if (hit.start > pos)
                next.push({
                  type: "text",
                  value: child.value.slice(pos, hit.start),
                })
              next.push({
                type: "link",
                url: hit.path,
                children: [
                  {
                    type: "text",
                    value: child.value.slice(hit.start, hit.end),
                  },
                ],
              })
              pos = hit.end
            }
            if (pos < child.value.length)
              next.push({ type: "text", value: child.value.slice(pos) })
            continue
          }
        }
        if (!inLink && child.type === "inlineCode" && child.value) {
          const path = agentFilePath(child.value.trim())
          if (path && child.value.trim() === child.value) {
            changed = true
            next.push({
              type: "link",
              url: path,
              children: [{ type: "inlineCode", value: child.value }],
            })
            continue
          }
        }
        walk(child, inLink || child.type === "link")
        next.push(child)
      }
      if (changed) node.children = next
    }
    walk(tree, false)
  }
}
