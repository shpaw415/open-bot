import AutoComplete from "@shpaw415/mui-lite/AutoComplete"
import Box from "@shpaw415/mui-lite/Box"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useMemo, useState } from "react"
import { StarBorderIcon, StarIcon } from "./icons"
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

const DESKTOP_DEFAULT_LABEL = "__desktop-default__"

type ModelChoice = {
  label: string
  id: string
  title: string
  providerID: string
  modelID: string
}

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

  const toggle = useCallback(
    (id: string) => {
      const next = toggleFavorite(readFavorites(localStorage, userId), id)
      writeFavorites(localStorage, userId, next)
      window.dispatchEvent(new Event(FAVORITES_EVENT))
    },
    [userId],
  )

  return { ids, toggle }
}

function FavoriteStar({
  pressed,
  title,
  onToggle,
}: {
  pressed: boolean
  title: string
  onToggle: () => void
}) {
  return (
    <Box
      Element="span"
      role="button"
      tabIndex={0}
      aria-label={pressed ? `Unfavorite ${title}` : `Favorite ${title}`}
      aria-pressed={pressed}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      sx={{
        display: "inline-flex",
        flexShrink: 0,
        cursor: "pointer",
        color: pressed ? "primary.main" : "text.secondary",
        lineHeight: 0,
      }}
    >
      {pressed ? (
        <StarIcon width={18} height={18} />
      ) : (
        <StarBorderIcon width={18} height={18} />
      )}
    </Box>
  )
}

export function ModelSelect({
  name,
  label,
  models,
  value,
  onSelect,
  disabled,
  userId,
  leading,
}: {
  name: string
  label: string
  models: ChatModel[]
  value: string
  onSelect: (value: string) => void
  disabled?: boolean
  userId: string
  leading?: { id: string; title: string }
}) {
  const { ids, toggle } = useModelFavorites(userId)
  const [query, setQuery] = useState<string | null>(null)
  const inputId = `ob-model-${name}`
  const favoriteKey = ids.join("|")
  const listKey = useMemo(
    () => `${favoriteKey}\n${models.map((item) => modelKey(item)).join("|")}`,
    [favoriteKey, models],
  )
  const leadingId = leading?.id
  const leadingTitle = leading?.title

  const options = useMemo(() => {
    const choices: ModelChoice[] = sortModels(models, ids).map((item) => {
      const id = modelKey(item)
      return {
        label: id,
        id,
        title: modelTitle(item),
        providerID: item.providerID,
        modelID: item.modelID,
      }
    })
    if (
      value &&
      value !== leadingId &&
      !choices.some((item) => item.id === value)
    ) {
      const extra: ModelChoice = {
        label: value,
        id: value,
        title: value,
        providerID: "",
        modelID: "",
      }
      if (ids.includes(value)) choices.unshift(extra)
      else choices.push(extra)
    }
    if (leadingTitle != null) {
      choices.unshift({
        label: DESKTOP_DEFAULT_LABEL,
        id: leadingId ?? "",
        title: leadingTitle,
        providerID: "",
        modelID: "",
      })
    }
    return choices
  }, [models, ids, value, leadingId, leadingTitle])

  const selected = options.find((item) => item.id === value)
  const display = selected?.title ?? ""

  useEffect(() => {
    const input = document.getElementById(inputId)
    if (!(input instanceof HTMLInputElement)) return
    input.dataset.list = String(listKey.length)
    let timer = 0
    const onBlur = () => {
      timer = window.setTimeout(() => setQuery(null), 200)
    }
    const onFocus = () => window.clearTimeout(timer)
    input.addEventListener("blur", onBlur)
    input.addEventListener("focus", onFocus)
    return () => {
      window.clearTimeout(timer)
      input.removeEventListener("blur", onBlur)
      input.removeEventListener("focus", onFocus)
    }
  }, [inputId, listKey])

  return (
    <AutoComplete
      key={listKey}
      options={options}
      value={query ?? display}
      onChange={(event) => setQuery(event.currentTarget.value)}
      onFilter={(opt, input) => {
        const needle = input.trim().toLowerCase()
        if (!needle || (query === null && needle === display.toLowerCase()))
          return true
        return (
          opt.title.toLowerCase().includes(needle) ||
          opt.label.toLowerCase().includes(needle) ||
          opt.providerID.toLowerCase().includes(needle) ||
          opt.modelID.toLowerCase().includes(needle)
        )
      }}
      formatInput={(opt) => opt.title}
      formatSelect={(opt) => opt.id === value}
      onSelect={(opt) => {
        setQuery(null)
        onSelect(opt.id)
      }}
      SlotProps={{
        input: {
          id: inputId,
          label,
          disabled,
          variant: "outlined",
          className: "ob-model-select",
          sx: { width: "100%" },
        },
        listButton: { className: inputId },
      }}
      listItemRender={(opt) => (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", minWidth: 0, width: "100%" }}
        >
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {opt.title}
          </Typography>
          {opt.id ? (
            <FavoriteStar
              pressed={ids.includes(opt.id)}
              title={opt.title}
              onToggle={() => {
                setQuery(null)
                toggle(opt.id)
              }}
            />
          ) : null}
        </Stack>
      )}
    />
  )
}
