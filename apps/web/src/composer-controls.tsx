import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import { List, ListItemButton, ListItemText } from "@shpaw415/mui-lite/List"
import Menu from "@shpaw415/mui-lite/Menu"
import TextField from "@shpaw415/mui-lite/TextField"
import { useEffect, useMemo, useRef, useState } from "react"
import { effortLabel, effortOptions } from "./chat-controls"
import { ChevronDownIcon, StarBorderIcon, StarIcon } from "./icons"
import {
  type ChatModel,
  FAVORITES_EVENT,
  modelKey,
  modelTitle,
  readFavorites,
  sortModels,
  toggleFavorite,
  writeFavorites,
} from "./model-favorites"

export type PickerModel = ChatModel & { variants?: string[] }

function useModelFavorites(userId: string) {
  const [ids, setIds] = useState(() => readFavorites(localStorage, userId))
  useEffect(() => {
    const sync = () => setIds(readFavorites(localStorage, userId))
    sync()
    window.addEventListener(FAVORITES_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [userId])
  const toggle = (id: string) => {
    writeFavorites(
      localStorage,
      userId,
      toggleFavorite(readFavorites(localStorage, userId), id),
    )
    window.dispatchEvent(new Event(FAVORITES_EVENT))
  }
  return { ids, toggle }
}

/** Move focus between the menu rows with the arrow keys; Enter/Tab stay native. */
function menuKeyNav(close: () => void) {
  return (event: React.KeyboardEvent) => {
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-ob-menu-item]:not(:disabled)",
      ),
    )
    if (!rows.length) return
    const active = document.activeElement as HTMLButtonElement | null
    const at = rows.indexOf(active as HTMLButtonElement)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      rows[(at + 1 + rows.length) % rows.length]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      rows[(at - 1 + rows.length) % rows.length]?.focus()
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  }
}

/**
 * The two chat controls that write real settings: the model picker and the
 * thinking-effort picker. Both persist through the same server routes the
 * Config page uses (PUT /api/model, PUT /api/thinking) — the parent owns the
 * save flow, this component only presents honest state and menus that open
 * above the composer.
 */
export function ComposerPickers({
  mobile,
  models,
  model,
  onModel,
  effort,
  effortSaving,
  onEffort,
  userId,
  disabled,
  modelButtonId,
}: {
  mobile: boolean
  models: PickerModel[]
  model: string
  onModel: (value: string) => void
  /** Saved effort for the current model; "" means model default. */
  effort: string
  effortSaving: boolean
  onEffort: (value: string) => void
  userId: string
  disabled?: boolean
  modelButtonId?: string
}) {
  const { ids, toggle } = useModelFavorites(userId)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [query, setQuery] = useState("")
  const modelBtnRef = useRef<HTMLButtonElement | null>(null)
  const effortBtnRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const variants = useMemo(
    () => models.find((item) => modelKey(item) === model)?.variants ?? [],
    [models, model],
  )
  const selected = models.find((item) => modelKey(item) === model)
  const modelLabel = selected ? modelTitle(selected) : model || "Model"

  const filtered = useMemo(() => {
    const ordered = sortModels(models, ids)
    const needle = query.trim().toLowerCase()
    if (!needle) return ordered
    return ordered.filter((item) =>
      `${modelTitle(item)} ${modelKey(item)}`.toLowerCase().includes(needle),
    )
  }, [models, ids, query])

  useEffect(() => {
    if (!modelOpen) return
    setQuery("")
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [modelOpen])

  const closeModel = () => {
    setModelOpen(false)
    modelBtnRef.current?.focus()
  }
  const closeEffort = () => {
    setEffortOpen(false)
    effortBtnRef.current?.focus()
  }

  const pickModel = (id: string) => {
    setModelOpen(false)
    onModel(id)
  }

  const options = effortOptions(variants, effort)
  const noVariants = models.length > 0 && variants.length === 0 && !effort

  return (
    <>
      <Button
        id={modelButtonId}
        ref={modelBtnRef}
        size="small"
        variant="outlined"
        aria-haspopup="menu"
        aria-expanded={modelOpen}
        disabled={disabled}
        onClick={() => setModelOpen(true)}
        endIcon={<ChevronDownIcon width={16} height={16} />}
        className="ob-composer-picker"
        title={modelLabel}
        sx={{
          maxWidth: mobile ? 150 : 220,
          minWidth: 0,
          px: 1,
          "& .MUI_Button_endIcon": { ml: 0.25 },
        }}
      >
        <Box Element="span" className="ob-composer-picker-label">
          {modelLabel}
        </Box>
      </Button>
      <Menu
        open={modelOpen}
        anchorEl={modelBtnRef}
        placement="top"
        onClose={closeModel}
        sx={{ width: "min(360px, 92vw)" }}
      >
        <Box
          data-ob-menu-root=""
          sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" &&
              document.activeElement === searchRef.current
            ) {
              event.preventDefault()
              event.currentTarget
                .querySelector<HTMLButtonElement>("[data-ob-menu-item]")
                ?.focus()
              return
            }
            menuKeyNav(closeModel)(event)
          }}
        >
          <Box sx={{ px: 1, pt: 1 }}>
            <TextField
              label="Search models"
              value={query}
              ref={searchRef}
              onChange={(event) => setQuery(event.currentTarget.value)}
              sx={{ width: "100%" }}
            />
          </Box>
          <List
            dense
            disablePadding
            sx={{ maxHeight: 320, overflowY: "auto", py: 0.5 }}
          >
            {filtered.map((item) => {
              const id = modelKey(item)
              return (
                <ListItemButton
                  key={id}
                  data-ob-menu-item=""
                  selected={id === model}
                  onClick={() => pickModel(id)}
                  title={modelTitle(item)}
                >
                  <ListItemText
                    primary={
                      <span className="ob-composer-model-row">
                        <span className="ob-composer-model-name">
                          {modelTitle(item)}
                        </span>
                        <Box
                          Element="span"
                          role="button"
                          tabIndex={0}
                          aria-label={
                            ids.includes(id)
                              ? `Unfavorite ${modelTitle(item)}`
                              : `Favorite ${modelTitle(item)}`
                          }
                          aria-pressed={ids.includes(id)}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggle(id)
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return
                            event.preventDefault()
                            event.stopPropagation()
                            toggle(id)
                          }}
                          sx={{
                            display: "inline-flex",
                            flexShrink: 0,
                            cursor: "pointer",
                            color: ids.includes(id)
                              ? "primary.main"
                              : "text.secondary",
                            lineHeight: 0,
                          }}
                        >
                          {ids.includes(id) ? (
                            <StarIcon width={16} height={16} />
                          ) : (
                            <StarBorderIcon width={16} height={16} />
                          )}
                        </Box>
                      </span>
                    }
                  />
                </ListItemButton>
              )
            })}
            {filtered.length === 0 ? (
              <ListItemButton disabled>
                <ListItemText primary="No model matches" />
              </ListItemButton>
            ) : null}
          </List>
        </Box>
      </Menu>

      <Button
        ref={effortBtnRef}
        size="small"
        variant={effort ? "outlined" : "text"}
        aria-haspopup="menu"
        aria-expanded={effortOpen}
        disabled={disabled || effortSaving || noVariants}
        onClick={() => setEffortOpen(true)}
        endIcon={<ChevronDownIcon width={16} height={16} />}
        className="ob-composer-picker"
        title={
          noVariants
            ? "Not available for this model"
            : "Thinking effort — applies to the next message in every thread"
        }
        sx={{
          maxWidth: mobile ? 130 : 190,
          minWidth: 0,
          px: 1,
          "& .MUI_Button_endIcon": { ml: 0.25 },
        }}
      >
        <Box Element="span" className="ob-composer-picker-label">
          {noVariants ? "Default" : effort ? effortLabel(effort) : "Default"}
        </Box>
      </Button>
      <Menu
        open={effortOpen}
        anchorEl={effortBtnRef}
        placement="top"
        onClose={closeEffort}
        sx={{ width: "min(300px, 92vw)" }}
      >
        <Box sx={{ py: 0.5 }} onKeyDown={menuKeyNav(closeEffort)}>
          {options.map((value) => (
            <ListItemButton
              key={value || "default"}
              data-ob-menu-item=""
              selected={value === effort}
              onClick={() => {
                setEffortOpen(false)
                onEffort(value)
              }}
            >
              <ListItemText
                primary={value === "" ? "Model default" : effortLabel(value)}
                secondary={
                  value === ""
                    ? "Let the model decide"
                    : value === effort
                      ? "Current"
                      : undefined
                }
              />
            </ListItemButton>
          ))}
          {noVariants ? (
            <ListItemButton disabled>
              <ListItemText primary="Not available for this model" />
            </ListItemButton>
          ) : null}
          <Box Element="p" className="ob-composer-menu-note">
            Applies to the next message in every thread.
          </Box>
        </Box>
      </Menu>
    </>
  )
}
