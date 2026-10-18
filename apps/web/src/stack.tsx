import { useClassNames, useStyle } from "@shpaw415/mui-lite/theme"
import {
  Children,
  type CSSProperties,
  createElement,
  type ElementType,
  Fragment,
  type ReactNode,
} from "react"

export type StackDirection = "row" | "row-reverse" | "column" | "column-reverse"

export type StackProps = {
  children?: ReactNode
  component?: ElementType
  direction?: StackDirection
  spacing?: number | string
  divider?: ReactNode
  useFlexGap?: boolean
  alignItems?: CSSProperties["alignItems"]
  justifyContent?: CSSProperties["justifyContent"]
  flexWrap?: CSSProperties["flexWrap"]
} & Omit<React.HTMLAttributes<HTMLElement>, "style"> & {
    sx?: Parameters<typeof useStyle>[0]
    style?: CSSProperties
    ref?: React.RefObject<HTMLElement | null>
  }

function spacingToCss(spacing: number | string | undefined) {
  if (spacing === undefined) return undefined
  if (typeof spacing === "number") return `${spacing * 8}px`
  return spacing
}

/**
 * Local Stack: identical output to @shpaw415/mui-lite's Stack (same
 * MUI_Stack_* classes, same inline style contract) with one repair — the
 * upstream 0.1.12 component passes `className` to `useClassNames` as an
 * array, and `useClassNames` stringifies that array with Array.toString(),
 * so every custom token rendered as "ob-composer," (trailing comma) and
 * every sx-generated class landed as ",sxcls" — dead tokens the CSS could
 * never match. This copy joins the parts into one real string first.
 */
export default function Stack({
  children,
  component = "div",
  direction = "column",
  spacing = 0,
  divider,
  useFlexGap = true,
  alignItems,
  justifyContent,
  flexWrap,
  className,
  sx,
  style,
  ...props
}: StackProps) {
  const gap = spacingToCss(spacing)
  const sxStyle = useStyle(sx)
  const root = useClassNames({
    component_name: "Stack",
    className: [className, sxStyle.classNameFromSx].filter(Boolean).join(" "),
    state: [direction, useFlexGap && "gap"],
  })
  const childArray = Children.toArray(children).filter(Boolean)
  const content =
    divider != null
      ? childArray.flatMap((child, i) =>
          i === 0
            ? [child]
            : [createElement(Fragment, { key: `d-${i}` }, divider), child],
        )
      : childArray
  const gapStyle = useFlexGap
    ? { gap }
    : ({ "--stack-spacing": gap } as CSSProperties)
  return createElement(
    component,
    {
      ...props,
      className: root.combined,
      style: {
        flexDirection: direction,
        alignItems,
        justifyContent,
        flexWrap,
        ...gapStyle,
        ...sxStyle.styleFromSx,
        ...style,
      },
    },
    content,
  )
}
