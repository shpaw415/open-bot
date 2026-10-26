type MdNode = {
  type: string
  children?: MdNode[]
}

/**
 * Remark plugin: lifts paragraphs whose children are all images out of the
 * paragraph, so block-level media renderers (ob-media-wrap, Model3dView)
 * never end up nested inside a <p> — React warns on <p> > <div> and browsers
 * silently repair the markup. Inline images among text stay put; the img
 * renderer pairs this with an inline-safe (span) wrapper for that case.
 */
export function unwrapMediaParagraphs() {
  return (tree: MdNode) => {
    const walk = (node: MdNode): void => {
      const children = node.children
      if (!children) return
      for (const child of children) walk(child)
      let index = 0
      while (index < children.length) {
        const child = children[index]
        const inner = child.children
        if (
          child.type === "paragraph" &&
          inner &&
          inner.length > 0 &&
          inner.every((item) => item.type === "image")
        ) {
          children.splice(index, 1, ...inner)
          index += inner.length
        } else {
          index += 1
        }
      }
    }
    walk(tree)
  }
}
