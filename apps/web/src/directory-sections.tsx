import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Typography from "@shpaw415/mui-lite/Typography"
import { type ReactNode, useCallback, useState } from "react"
import { Chip } from "./chip"
import { ChevronDownIcon, ChevronRightIcon } from "./icons"
import Stack from "./stack"

export type DirectoryGroup = {
  /** Directory id; null is the always-present ungrouped bucket. */
  id: string | null
  label: string
  count: number
  /** Plugin auto-section: header carries the badge, no user actions. */
  locked?: boolean
  badge?: ReactNode
  /** Rename/delete/reorder affordances. Siblings of the toggle button —
   * never nested inside it (interactive-in-interactive is invalid HTML). */
  actions?: ReactNode
}

// Collapse state persists per tab ("skills" / "mcp") in localStorage, the
// same pattern as the dashboard's thread folders.
export function useCollapsedDirs(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const toggle = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]))
        } catch {
          // storage denied (sandboxed frame): collapse just does not persist
        }
        return next
      })
    },
    [storageKey],
  )
  return [collapsed, toggle] as const
}

// One collapsible labeled section of the skills/MCP directory. The header is
// a real button (chevron + label + count + badge); the section body renders
// `children` when expanded, or the empty caption when the group has none.
// Every section collapses — user directories by id, and the id-less buckets
// (Ungrouped, plugin sections) by their stable label.
export function DirectorySection({
  group,
  collapsed,
  onToggle,
  emptyText,
  children,
}: {
  group: DirectoryGroup
  collapsed: Set<string>
  onToggle: (id: string) => void
  emptyText: string
  children: ReactNode
}) {
  const collapseKey = group.id ?? `auto:${group.label}`
  const open = !collapsed.has(collapseKey)
  const regionId = `dir-region-${collapseKey}`
  const toggle = () => onToggle(collapseKey)
  return (
    <Box role="region" aria-label={group.label} id={regionId}>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ minHeight: 40 }}
      >
        <Button
          variant="text"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={regionId}
          sx={{
            flex: 1,
            minWidth: 0,
            justifyContent: "flex-start",
            px: 1,
            py: 0.5,
            textTransform: "none",
            textAlign: "left",
            gap: 0.75,
            color: "var(--text-secondary)",
            "@media (pointer: coarse)": { minHeight: 44 },
          }}
        >
          {open ? (
            <ChevronDownIcon width={16} height={16} aria-hidden />
          ) : (
            <ChevronRightIcon width={16} height={16} aria-hidden />
          )}
          <Typography
            variant="subtitle2"
            component="span"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.label}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            sx={{
              height: 22,
              borderRadius: "8px",
              flexShrink: 0,
              "& .MUI_Chip_Content": { padding: 0, paddingRight: "8px" },
            }}
          >
            {group.count}
          </Chip>
          {group.badge}
        </Button>
        {group.actions}
      </Stack>
      {open ? (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {group.count === 0 ? (
            <Typography variant="caption" color="textSecondary" sx={{ pl: 1 }}>
              {emptyText}
            </Typography>
          ) : (
            children
          )}
        </Stack>
      ) : null}
    </Box>
  )
}
