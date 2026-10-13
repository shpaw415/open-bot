// Phone-style home screen for plugin dashboard tabs: a paginated grid of app
// tiles. Swipe changes page, long-press enters edit mode (jiggle + drag to
// move), dropping a tile on another entry creates a folder whose name is
// edited inline in the folder overlay. Layout persists per user via
// GET/PUT /api/plugins/dashboard-layout.
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import TextField from "@shpaw415/mui-lite/TextField"
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { api } from "./api"
import { AppTileIcon, ArrowBackIcon, tileHue } from "./icons"
import type { PluginTab } from "./plugin-tabs"

type LayoutApp = { type: "app"; key: string }
type LayoutFolder = {
  type: "folder"
  id: string
  name: string
  items: LayoutApp[]
}
type LayoutItem = LayoutApp | LayoutFolder

const LONG_PRESS_MS = 420
const MOVE_SLOP = 10
const TAP_MS = 600
const EDGE = 30
const FLIP_MS = 700
const MAX_FOLDER_ITEMS = 16
const DOTS_SPACE = 34
const MAX_ROWS = 6

function newFolderId() {
  return `f${Math.random().toString(36).slice(2, 8)}${Date.now()
    .toString(36)
    .slice(-3)}`
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return [[...items]]
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size))
  if (pages.length === 0) pages.push([])
  return pages
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

function tileBackground(seed: string) {
  const hue = tileHue(seed)
  return `linear-gradient(145deg, hsl(${hue} 62% 56%), hsl(${(hue + 28) % 360} 58% 44%))`
}

function TileFace({ tab, size }: { tab: PluginTab; size: number }): ReactNode {
  return (
    <AppTileIcon
      icon={tab.icon}
      name={tab.title}
      size={Math.round(size * 0.46)}
    />
  )
}

function AppTile({
  tab,
  tileSize,
  label = true,
}: {
  tab: PluginTab
  tileSize: number
  label?: boolean
}) {
  return (
    <>
      <Box
        sx={{
          width: tileSize,
          height: tileSize,
          borderRadius: `${Math.round(tileSize * 0.26)}px`,
          background: tileBackground(tab.key),
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 6px rgba(0,0,0,.28)",
          userSelect: "none",
        }}
      >
        <TileFace tab={tab} size={tileSize} />
      </Box>
      {label ? (
        <Box
          sx={{
            mt: 0.5,
            maxWidth: tileSize + 22,
            fontSize: 11.5,
            lineHeight: 1.15,
            textAlign: "center",
            color: "text.primary",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            textShadow: "0 1px 2px rgba(0,0,0,.35)",
          }}
        >
          {tab.title}
        </Box>
      ) : null}
    </>
  )
}

function FolderFace({
  folder,
  tabFor,
  tileSize,
}: {
  folder: LayoutFolder
  tabFor: Map<string, PluginTab>
  tileSize: number
}) {
  const mini = Math.round(tileSize * 0.4)
  const gap = Math.max(2, Math.round(tileSize * 0.06))
  const cells: { key: string; tab?: PluginTab }[] = folder.items
    .slice(0, 4)
    .map((entry) => ({ key: entry.key, tab: tabFor.get(entry.key) }))
  for (let pad = cells.length; pad < 4; pad += 1)
    cells.push({ key: `pad-${pad}` })
  return (
    <Box
      sx={{
        width: tileSize,
        height: tileSize,
        borderRadius: `${Math.round(tileSize * 0.26)}px`,
        background: "rgba(255,255,255,.14)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,.22)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: `${gap}px`,
        padding: `${gap + 2}px`,
        userSelect: "none",
      }}
    >
      {cells.map((cell) => (
        <Box
          key={cell.key}
          sx={{
            borderRadius: `${Math.round(mini * 0.3)}px`,
            background: cell.tab ? tileBackground(cell.tab.key) : "transparent",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {cell.tab ? (
            <AppTileIcon
              icon={cell.tab.icon}
              name={cell.tab.title}
              size={Math.round(mini * 0.6)}
            />
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

export function HomeScreen({
  tabs,
  onOpen,
}: {
  tabs: PluginTab[]
  onOpen: (key: string) => void
}) {
  const tabFor = useMemo(
    () => new Map(tabs.map((tab) => [tab.key, tab])),
    [tabs],
  )
  const defaults = useMemo(
    () => tabs.map((tab) => ({ type: "app", key: tab.key }) as LayoutItem),
    [tabs],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [flat, setFlat] = useState<LayoutItem[] | null>(null)
  const [page, setPage] = useState(0)
  const [edit, setEdit] = useState(false)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const capacityRef = useRef(8)

  const mobile = size.w > 0 && size.w < 560
  const cols = mobile ? 4 : 7
  const cellH = mobile ? 92 : 100
  const tileSize = mobile ? 56 : 60
  const rows = clamp(Math.floor((size.h - DOTS_SPACE) / cellH), 1, MAX_ROWS)
  const capacity = cols * rows
  capacityRef.current = capacity

  // Measure the pane so pages chunk to the visible capacity.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ w: rect.width, h: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Load the saved layout once; unknown/stale keys are dropped at load and
  // tabs missing from the layout are appended in manifest order.
  useEffect(() => {
    let alive = true
    const defaults = () =>
      tabs.map((tab) => ({ type: "app", key: tab.key }) as LayoutApp)
    api<{ layout: string | null }>("/api/plugins/dashboard-layout")
      .then(({ layout }) => {
        if (!alive) return
        if (!layout) {
          setFlat(defaults())
          return
        }
        try {
          const parsed = JSON.parse(layout) as {
            pages?: { items?: LayoutItem[] }[]
          }
          const known = new Set(tabs.map((tab) => tab.key))
          const isValidApp = (item: unknown): item is LayoutApp =>
            typeof item === "object" &&
            item !== null &&
            (item as LayoutApp).type === "app" &&
            typeof (item as LayoutApp).key === "string" &&
            known.has((item as LayoutApp).key)
          const seen = new Set<string>()
          const items: LayoutItem[] = []
          for (const page_ of parsed.pages ?? []) {
            for (const item of page_.items ?? []) {
              if (isValidApp(item) && !seen.has(item.key)) {
                seen.add(item.key)
                items.push(item)
              } else if (
                typeof item === "object" &&
                item !== null &&
                (item as LayoutFolder).type === "folder" &&
                Array.isArray((item as LayoutFolder).items)
              ) {
                const folder = item as LayoutFolder
                const inner = folder.items.filter(
                  (entry) => isValidApp(entry) && !seen.has(entry.key),
                )
                inner.forEach((entry) => {
                  seen.add(entry.key)
                })
                if (inner.length > 0)
                  items.push({
                    type: "folder",
                    id: String(folder.id ?? newFolderId()),
                    name: String(folder.name ?? "").slice(0, 48),
                    items: inner,
                  })
              }
            }
          }
          items.push(...defaults().filter((item) => !seen.has(item.key)))
          setFlat(items)
        } catch {
          setFlat(defaults())
        }
      })
      .catch(() => {
        if (alive) setFlat(defaults())
      })
    return () => {
      alive = false
    }
  }, [tabs])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((next: LayoutItem[]) => {
    setFlat(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const pages = chunk(next, capacityRef.current).map((page_) => ({
        items: page_,
      }))
      void api("/api/plugins/dashboard-layout", {
        method: "PUT",
        body: JSON.stringify({ layout: JSON.stringify({ pages }) }),
      }).catch(() => {})
    }, 350)
  }, [])

  const items = flat ?? defaults
  const pages = useMemo(
    () => chunk(items, Math.max(1, capacity)),
    [items, capacity],
  )

  useEffect(() => {
    if (page > pages.length - 1) setPage(pages.length - 1)
  }, [pages.length, page])

  // Keep the track transform in sync with page + size (direct DOM so swiping
  // never re-renders the grid).
  const applyTransform = useCallback(
    (targetPage: number, animate: boolean, translatePx?: number) => {
      const el = trackRef.current
      if (!el) return
      el.style.transition = animate
        ? "transform .26s cubic-bezier(.22,.61,.36,1)"
        : "none"
      el.style.transform = `translateX(${translatePx ?? -targetPage * size.w}px)`
    },
    [size.w],
  )
  useEffect(() => {
    applyTransform(page, true)
  }, [applyTransform, page])

  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    startT: number
    slot: number | null
    timer: ReturnType<typeof setTimeout> | null
    mode: "press" | "swipe" | "drag"
  } | null>(null)
  const dragSlot = useRef<number | null>(null)
  const lastPointer = useRef({ x: 0, y: 0 })
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPress = () => {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer)
  }

  const clearFlip = () => {
    if (flipTimer.current) clearTimeout(flipTimer.current)
    flipTimer.current = null
  }

  const armFlip = (dir: -1 | 1) => {
    clearFlip()
    flipTimer.current = setTimeout(() => {
      setPage((current) => clamp(current + dir, 0, pages.length - 1))
      // Re-arm while the pointer stays on the edge.
      if (
        (dir === -1 && lastPointer.current.x <= EDGE) ||
        (dir === 1 && lastPointer.current.x >= size.w - EDGE)
      )
        armFlip(dir)
    }, FLIP_MS)
  }

  const moveGhost = (x: number, y: number) => {
    const ghost = ghostRef.current
    if (ghost)
      ghost.style.transform = `translate(${x - tileSize / 2 - 14}px, ${
        y - tileSize - 26
      }px)`
  }

  const startDrag = (slot: number, x: number, y: number) => {
    dragSlot.current = slot
    setDragging(slot)
    setEdit(true)
    setOverSlot(slot)
    lastPointer.current = { x, y }
    moveGhost(x, y)
    document.body.classList.add("ob-home-dragging")
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (flat === null || openFolder !== null) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    const slot = Number(
      (event.target as Element)
        .closest?.("[data-slot]")
        ?.getAttribute("data-slot") ?? Number.NaN,
    )
    const hasTile = Number.isFinite(slot)
    event.currentTarget.setPointerCapture(event.pointerId)
    const next: NonNullable<typeof gesture.current> = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startT: Date.now(),
      slot: hasTile ? slot : null,
      timer: null,
      mode: "press",
    }
    if (edit && hasTile) {
      next.mode = "drag"
      startDrag(slot, event.clientX, event.clientY)
    } else if (hasTile) {
      next.timer = setTimeout(() => {
        const current = gesture.current
        if (!current || current.mode !== "press") return
        // Bail if the pointer already travelled — that is a swipe, not a hold.
        const travelled = Math.hypot(
          lastPointer.current.x - current.startX,
          lastPointer.current.y - current.startY,
        )
        if (travelled > MOVE_SLOP) return
        current.mode = "drag"
        startDrag(
          current.slot ?? 0,
          lastPointer.current.x,
          lastPointer.current.y,
        )
      }, LONG_PRESS_MS)
    }
    gesture.current = next
  }

  const drop = () => {
    const from = dragSlot.current
    const at = overSlot
    dragSlot.current = null
    setDragging(null)
    setOverSlot(null)
    document.body.classList.remove("ob-home-dragging")
    clearFlip()
    if (from === null || at === null || from === at) return
    const next = [...items]
    const moved = next[from]
    if (!moved) return
    next.splice(from, 1)
    const target = at > from ? at - 1 : at
    const occupant = next[target]
    if (occupant && moved.type === "app" && occupant.type === "app") {
      const folder: LayoutFolder = {
        type: "folder",
        id: newFolderId(),
        name: "",
        items: [occupant, moved],
      }
      next[target] = folder
      scheduleSave(next)
      setOpenFolder(folder.id)
      return
    }
    if (occupant && occupant.type === "folder" && moved.type === "app") {
      if (occupant.items.length < MAX_FOLDER_ITEMS) {
        next[target] = { ...occupant, items: [...occupant.items, moved] }
        scheduleSave(next)
        return
      }
    }
    if (occupant && moved.type === "folder" && occupant.type === "app") {
      if (moved.items.length < MAX_FOLDER_ITEMS) {
        next[target] = { ...moved, items: [...moved.items, occupant] }
        scheduleSave(next)
        return
      }
    }
    if (
      occupant &&
      moved.type === "folder" &&
      occupant.type === "folder" &&
      moved.items.length + occupant.items.length <= MAX_FOLDER_ITEMS
    ) {
      next[target] = {
        type: "folder",
        id: occupant.id,
        name: occupant.name,
        items: [...occupant.items, ...moved.items],
      }
      scheduleSave(next)
      return
    }
    next.splice(clamp(target, 0, next.length), 0, moved)
    scheduleSave(next)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = gesture.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    lastPointer.current = { x: event.clientX, y: event.clientY }
    if (state.mode === "drag") {
      moveGhost(event.clientX, event.clientY)
      const hit = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-slot]")
        ?.getAttribute("data-slot")
      const slot = hit === null ? Number.NaN : Number(hit)
      const target = Number.isFinite(slot) ? slot : items.length
      setOverSlot((current) => (current === target ? current : target))
      if (size.w > 0) {
        if (event.clientX <= EDGE) armFlip(-1)
        else if (event.clientX >= size.w - EDGE) armFlip(1)
        else clearFlip()
      }
      return
    }
    if (state.mode === "press" || state.mode === "swipe") {
      if (Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP) cancelPress()
      if (
        size.w > 0 &&
        Math.abs(dx) > MOVE_SLOP &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        state.mode = "swipe"
        // Follow the finger with rubber-band resistance past the ends.
        const max = (pages.length - 1) * size.w
        let tx = -page * size.w + dx
        if (tx > 0) tx *= 0.35
        else if (tx < -max) tx = -max + (tx + max) * 0.35
        applyTransform(page, false, tx)
      }
    }
  }

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = gesture.current
    if (!state || state.pointerId !== event.pointerId) return
    gesture.current = null
    cancelPress()
    clearFlip()
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const elapsed = Date.now() - state.startT
    if (state.mode === "drag") {
      drop()
      return
    }
    if (state.mode === "swipe") {
      const moved = Math.abs(dx)
      const dir = dx < 0 ? 1 : -1
      const canGo = dir === 1 ? page < pages.length - 1 : page > 0
      const flick = moved > 48 && elapsed < 240
      const nextPage =
        canGo && (moved > size.w * 0.2 || flick) ? page + dir : page
      // Always land the track on a real page, even when nothing changed —
      // a same-value setPage would skip the sync effect and leave the grid
      // stranded at the dragged offset.
      setPage(nextPage)
      applyTransform(nextPage, true)
      return
    }
    // A tap: open the tab / folder, or leave edit mode on background.
    if (
      elapsed < TAP_MS &&
      Math.abs(dx) < MOVE_SLOP &&
      Math.abs(dy) < MOVE_SLOP
    ) {
      if (state.slot !== null) {
        if (edit) return
        const item = items[state.slot]
        if (item?.type === "folder") setOpenFolder(item.id)
        else if (item) onOpen(item.key)
      } else if (edit) setEdit(false)
    }
  }

  const folder = openFolder
    ? (items.find((item) => item.type === "folder" && item.id === openFolder) as
        | LayoutFolder
        | undefined)
    : undefined

  const removeFromFolder = (key: string) => {
    if (!folder) return
    const index = items.findIndex(
      (item) => item.type === "folder" && item.id === folder.id,
    )
    if (index < 0) return
    const remaining = folder.items.filter((entry) => entry.key !== key)
    const next = [...items]
    const back: LayoutItem = { type: "app", key }
    if (remaining.length === 0) {
      // Empty folder: deleted outright.
      next.splice(index, 1, back)
    } else if (remaining.length === 1 && remaining[0]) {
      // A folder needs two apps — dissolve and return both to the grid.
      next.splice(index, 1, { type: "app", key: remaining[0].key }, back)
    } else {
      next[index] = { ...folder, items: remaining }
      next.splice(index + 1, 0, back)
    }
    scheduleSave(next)
  }

  const renameFolder = (name: string) => {
    if (!folder) return
    scheduleSave(
      items.map((item) =>
        item.type === "folder" && item.id === folder.id
          ? { ...item, name: name.slice(0, 48) }
          : item,
      ),
    )
  }

  // Long-press inside the folder overlay enters its edit mode (jiggle + the
  // "–" badges that move apps back out of the folder).
  const folderItemDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (edit) return
    const el = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const timer = setTimeout(() => setEdit(true), LONG_PRESS_MS)
    let move: (e: PointerEvent) => void
    const cleanup = () => {
      clearTimeout(timer)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", cleanup)
      el.removeEventListener("pointercancel", cleanup)
    }
    move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_SLOP)
        cleanup()
    }
    el.setPointerCapture(event.pointerId)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", cleanup)
    el.addEventListener("pointercancel", cleanup)
  }

  const dragItem = dragging !== null ? items[dragging] : undefined
  const dragTab =
    dragItem?.type === "app"
      ? tabFor.get(dragItem.key)
      : dragItem?.type === "folder"
        ? tabFor.get(dragItem.items[0]?.key ?? "")
        : undefined

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        bgcolor: "background.default",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(103,80,164,.16), transparent 42%), radial-gradient(circle at 85% 85%, rgba(4,80,123,.14), transparent 46%)",
      }}
    >
      {flat === null ? null : (
        <Box
          sx={{
            position: "absolute",
            top: 6,
            right: 8,
            zIndex: 3,
          }}
        >
          {edit ? (
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => setEdit(false)}
              sx={{ minWidth: 0, borderRadius: 999, px: 1.5, py: 0.1 }}
            >
              Done
            </Button>
          ) : null}
        </Box>
      )}
      <Box
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        style={{
          display: "flex",
          height: "100%",
          willChange: "transform",
        }}
      >
        {pages.map((pageItems, pageIndex) => (
          <Box
            // biome-ignore lint/suspicious/noArrayIndexKey: pages are positional chunks of one ordered list
            key={pageIndex}
            sx={{
              width: size.w || "100%",
              flexShrink: 0,
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridAutoRows: `${cellH}px`,
              justifyItems: "center",
              alignContent: "start",
              pt: 2,
              px: 1,
            }}
          >
            {pageItems.map((item) => {
              const slot = items.indexOf(item)
              const isDragged = dragging === slot
              const highlighted =
                overSlot === slot && dragging !== null && dragging !== slot
              if (item.type === "app") {
                const tab = tabFor.get(item.key)
                return (
                  <Box
                    key={item.key}
                    data-slot={slot}
                    sx={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      cursor: edit ? "grab" : "pointer",
                      opacity: isDragged ? 0.3 : 1,
                      outline: highlighted
                        ? "2px dashed rgba(255,255,255,.65)"
                        : "none",
                      outlineOffset: 4,
                      borderRadius: 2,
                    }}
                  >
                    <Box className={edit ? "ob-tile-jiggle" : undefined}>
                      {tab ? <AppTile tab={tab} tileSize={tileSize} /> : null}
                    </Box>
                  </Box>
                )
              }
              return (
                <Box
                  key={item.id}
                  data-slot={slot}
                  sx={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: edit ? "grab" : "pointer",
                    opacity: isDragged ? 0.3 : 1,
                    outline: highlighted
                      ? "2px dashed rgba(255,255,255,.65)"
                      : "none",
                    outlineOffset: 4,
                    borderRadius: 2,
                  }}
                >
                  <Box className={edit ? "ob-tile-jiggle" : undefined}>
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      <FolderFace
                        folder={item}
                        tabFor={tabFor}
                        tileSize={tileSize}
                      />
                      <Box
                        sx={{
                          mt: 0.5,
                          maxWidth: tileSize + 22,
                          fontSize: 11.5,
                          textAlign: "center",
                          color: "text.primary",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          textShadow: "0 1px 2px rgba(0,0,0,.35)",
                        }}
                      >
                        {item.name || "Folder"}
                      </Box>
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>

      {pages.length > 1 ? (
        <Box
          onPointerDown={(event) => event.stopPropagation()}
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 8,
            display: "flex",
            justifyContent: "center",
            gap: 0.75,
          }}
        >
          {pages.map((_, index) => (
            <Box
              // biome-ignore lint/suspicious/noArrayIndexKey: page dots are positional
              key={index}
              onClick={() => setPage(index)}
              sx={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                bgcolor:
                  index === page ? "common.white" : "rgba(255,255,255,.38)",
                border: "1px solid rgba(0,0,0,.25)",
                cursor: "pointer",
              }}
            />
          ))}
        </Box>
      ) : null}

      {/* Drag ghost (positioned directly via ref, never re-renders) */}
      <Box
        ref={ghostRef}
        sx={{
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: 60,
          pointerEvents: "none",
          display: dragging !== null ? "flex" : "none",
          filter: "drop-shadow(0 10px 14px rgba(0,0,0,.45))",
          transformOrigin: "center",
          scale: "1.08",
        }}
      >
        {dragItem?.type === "folder" ? (
          <FolderFace folder={dragItem} tabFor={tabFor} tileSize={tileSize} />
        ) : dragTab ? (
          <AppTile tab={dragTab} tileSize={tileSize} label={false} />
        ) : null}
      </Box>

      {/* Folder overlay */}
      {folder ? (
        <Box
          onPointerDown={(event) => {
            const target = event.target as Element
            if (
              target.closest?.("[data-folder-item]") ||
              target.closest?.("[data-folder-head]")
            )
              return
            // Editing: first background tap leaves edit mode; then it closes.
            if (edit) setEdit(false)
            else setOpenFolder(null)
          }}
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            bgcolor: "rgba(10,10,16,.72)",
            backdropFilter: "blur(14px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pt: 3,
            px: 2,
            overflowY: "auto",
          }}
        >
          <Box
            data-folder-head
            sx={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 1,
              justifyContent: "center",
              mb: 2,
            }}
          >
            <Box
              onClick={() => setOpenFolder(null)}
              sx={{ cursor: "pointer", color: "text.primary" }}
            >
              <ArrowBackIcon />
            </Box>
            <TextField
              autoFocus
              value={folder.name}
              placeholder="Folder name"
              onChange={(event) => renameFolder(event.currentTarget.value)}
              sx={{
                width: 240,
                "& input": { textAlign: "center", fontWeight: 600 },
              }}
            />
            {edit ? (
              <Button
                variant="contained"
                color="primary"
                onClick={() => setEdit(false)}
                sx={{
                  minWidth: 0,
                  borderRadius: 999,
                  px: 1.5,
                  py: 0.2,
                  fontSize: 13,
                }}
              >
                Done
              </Button>
            ) : null}
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: `repeat(4, 1fr)`,
              gap: 2,
              justifyItems: "center",
              width: "100%",
              maxWidth: 420,
            }}
          >
            {folder.items.map((entry) => {
              const tab = tabFor.get(entry.key)
              if (!tab) return null
              return (
                <Box
                  key={entry.key}
                  data-folder-item
                  sx={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: edit ? "grab" : "pointer",
                  }}
                  onPointerDown={folderItemDown}
                  onClick={() => {
                    if (!edit) onOpen(tab.key)
                  }}
                >
                  <Box className={edit ? "ob-tile-jiggle" : undefined}>
                    <AppTile tab={tab} tileSize={58} />
                  </Box>
                  {edit ? (
                    <Box
                      onClick={(event) => {
                        event.stopPropagation()
                        removeFromFolder(tab.key)
                      }}
                      sx={{
                        position: "absolute",
                        top: -6,
                        left: -6,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        bgcolor: "grey.700",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 15,
                        lineHeight: 1,
                        boxShadow: "0 1px 4px rgba(0,0,0,.5)",
                      }}
                    >
                      –
                    </Box>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
