import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useId, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { api } from "./api"
import {
  ConfigItemCard,
  EmptyState,
  GhostCards,
  ItemAvatar,
  PluginBadge,
} from "./ConfigList"
import { ConfigSection } from "./ConfigSection"
import { Chip } from "./chip"
import { confirmDiscard, snapshotDirty } from "./discard-guard"
import { FaceIcon, LockIcon, PersonIcon } from "./icons"
import Stack from "./stack"
import { Tip } from "./Tip"

export type PersonaInfo = {
  id: string
  name: string
  instruction: string
  builtin: boolean
  plugin?: { id: string; name: string }
  skills?: string[] | null
  skillsExtra?: string[] | null
  skillsEffective?: string[] | null
  mcp?: string[] | null
  mcpExtra?: string[] | null
  mcpEffective?: string[] | null
}

// Same shape the server enforces: a stray glob character would re-open the
// whole allowlist under opencode's minimatch.
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MCP_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/

type Draft = {
  id: string
  name: string
  instruction: string
  // User personas: the editable base lists (null = all).
  skills: string[] | null
  mcp: string[] | null
  // Plugin personas: locked bases plus the user's editable extras.
  pluginName: string | null
  baseLocked: string[] | null
  mcpBaseLocked: string[] | null
  extras: string[]
  mcpExtras: string[]
  skillsTouched: boolean
  mcpTouched: boolean
}

function draftFrom(persona: PersonaInfo): Draft {
  const plugin = persona.plugin ?? null
  return {
    id: persona.id,
    name: persona.name,
    instruction: persona.instruction,
    skills: plugin ? null : (persona.skills ?? null),
    mcp: plugin ? null : (persona.mcp ?? null),
    pluginName: plugin?.name ?? null,
    baseLocked: plugin ? (persona.skills ?? null) : null,
    mcpBaseLocked: plugin ? (persona.mcp ?? null) : null,
    extras: persona.skillsExtra ?? [],
    mcpExtras: persona.mcpExtra ?? [],
    skillsTouched: false,
    mcpTouched: false,
  }
}

function mergeLocked(base: string[] | null, extras: string[]): string[] | null {
  if (base === null) return null
  const merged = [...base]
  for (const name of extras) if (!merged.includes(name)) merged.push(name)
  return merged
}

function restrictedSkills(draft: Draft): string[] | null {
  if (draft.baseLocked !== null)
    return mergeLocked(draft.baseLocked, draft.extras)
  return draft.skills && draft.skills.length > 0 ? draft.skills : null
}

function restrictedMcp(draft: Draft): string[] | null {
  if (draft.mcpBaseLocked !== null)
    return mergeLocked(draft.mcpBaseLocked, draft.mcpExtras)
  return draft.mcp && draft.mcp.length > 0 ? draft.mcp : null
}

type DraftSnapshot = Pick<
  Draft,
  "id" | "name" | "instruction" | "skills" | "extras" | "mcp" | "mcpExtras"
>

function snapshotOf(draft: Draft): DraftSnapshot {
  return {
    id: draft.id,
    name: draft.name,
    instruction: draft.instruction,
    skills: draft.skills,
    extras: draft.extras,
    mcp: draft.mcp,
    mcpExtras: draft.mcpExtras,
  }
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase()
}

// One allowlist section of the persona dialog (skills or MCP servers),
// rendered as grouped chip clouds: "From <plugin>" sections, the user's
// directories, and Ungrouped. Each group carries a tri-state `All` chip —
// filled when every member is selected, `All · n/m` (outlined) when partial.
// Clicking All batch-allows the group's (search-filtered) members; a click
// that would push the selection past `max` is refused with an inline error,
// never silently clipped. The locked chips are a plugin's base list;
// everything else is the user's. MCP passes noneChip/noneActive/onBlockAll
// for its third state — an empty allowlist blocks every server.
export type ScopeEntry = {
  name: string
  description: string
  dirId: string | null
  pluginName: string | null
  /** Manifest group label (skills only): refines the plugin section title. */
  groupLabel?: string | null
  /** Desktop seed skill: unfiled ones render under the Built-in section. */
  seed?: boolean
}

export type ScopeGroup = { id: string | null; label: string }

const BUILTIN_LABEL = "Built-in"

function scopePickerGroups(
  entries: ScopeEntry[],
  dirs: ScopeGroup[],
): ScopeGroup[] {
  const plugins = new Set<string>()
  let builtin = false
  for (const entry of entries) {
    if (entry.dirId) continue
    if (entry.pluginName) {
      plugins.add(
        entry.groupLabel
          ? `From ${entry.pluginName} · ${entry.groupLabel}`
          : `From ${entry.pluginName}`,
      )
      continue
    }
    if (entry.seed) builtin = true
  }
  return [
    ...[...plugins].sort().map((label) => ({ id: null, label })),
    ...dirs,
    ...(builtin ? [{ id: null, label: BUILTIN_LABEL }] : []),
    { id: null, label: "Ungrouped" },
  ]
}

// Which picker group an entry renders under: a user directory wins (the
// user moved it there), then the plugin section, then Built-in for unfiled
// seed skills, then Ungrouped.
function entryGroupLabel(entry: ScopeEntry, dirs: ScopeGroup[]): string {
  if (entry.dirId) {
    const dir = dirs.find((group) => group.id === entry.dirId)
    if (dir) return dir.label
  }
  if (entry.pluginName)
    return entry.groupLabel
      ? `From ${entry.pluginName} · ${entry.groupLabel}`
      : `From ${entry.pluginName}`
  if (entry.seed) return BUILTIN_LABEL
  return "Ungrouped"
}

export function ScopePicker(props: {
  sectionTitle: string
  caption: string
  filterLabel: string
  allChip: string
  emptyBase: string
  noMatch: string
  loading: string
  manualLabel: string
  manualPlaceholder: string
  manualError: string
  entries: ScopeEntry[]
  dirs: ScopeGroup[]
  max: number
  baseLocked: string[] | null
  selected: string[]
  catalogLoading: boolean
  catalogFailed: boolean
  filter: string
  manual: string
  lockedTitle: string
  noneChip?: string
  noneActive?: boolean
  onBlockAll?: () => void
  onFilter: (value: string) => void
  onManual: (value: string) => void
  onManualAdd: () => void
  onToggle: (name: string) => void
  onToggleGroup: (names: string[], select: boolean) => void
  onClearAll: () => void
}) {
  const query = props.filter.trim().toLowerCase()
  const pool = new Map<string, ScopeEntry>()
  for (const entry of props.entries) pool.set(entry.name, entry)
  for (const name of props.baseLocked ?? [])
    if (!pool.has(name))
      pool.set(name, {
        name,
        description: "",
        dirId: null,
        pluginName: null,
      })
  for (const name of props.selected)
    if (!pool.has(name))
      pool.set(name, {
        name,
        description: "",
        dirId: null,
        pluginName: null,
      })
  const matches = (entry: ScopeEntry) =>
    !query ||
    entry.name.toLowerCase().includes(query) ||
    entry.description.toLowerCase().includes(query)
  // Selected count for the live cap counter.
  const cap = props.selected.length
  const capTone =
    cap >= props.max
      ? "error"
      : cap >= props.max - (props.max >= 32 ? 8 : 2)
        ? "warning"
        : undefined
  const atCap = cap >= props.max
  const groups = scopePickerGroups([...pool.values()], props.dirs)
  const grouped = groups
    .map((group) => {
      const members = [...pool.values()].filter(
        (entry) => entryGroupLabel(entry, props.dirs) === group.label,
      )
      const visible = members.filter(matches)
      return { group, members, visible }
    })
    .filter((item) => item.visible.length > 0)
  const [groupError, setGroupError] = useState<string>("")
  const clearGroupError = () => {
    if (groupError) setGroupError("")
  }
  function toggleGroup(members: ScopeEntry[], select: boolean) {
    const selectable = members.filter(
      (entry) => !(props.baseLocked ?? []).includes(entry.name),
    )
    if (select) {
      const adding = selectable.filter(
        (entry) => !props.selected.includes(entry.name),
      )
      if (adding.length === 0) return
      if (cap + adding.length > props.max) {
        setGroupError(
          `This would exceed the limit of ${props.max} — select fewer.`,
        )
        return
      }
      props.onToggleGroup(
        adding.map((entry) => entry.name),
        true,
      )
      clearGroupError()
      return
    }
    const removing = selectable.filter((entry) =>
      props.selected.includes(entry.name),
    )
    if (removing.length === 0) return
    props.onToggleGroup(
      removing.map((entry) => entry.name),
      false,
    )
    clearGroupError()
  }
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
      >
        <Typography variant="subtitle2">{props.sectionTitle}</Typography>
        <Chip
          size="small"
          variant="outlined"
          color={capTone}
          sx={{ borderRadius: "8px" }}
        >
          {cap} / {props.max}
        </Chip>
      </Stack>
      <Typography
        variant="caption"
        color="textSecondary"
        sx={{ display: "block", mb: 1 }}
      >
        {props.caption}
      </Typography>
      {props.baseLocked !== null ? (
        <Stack spacing={1.25} sx={{ mb: 1.25 }}>
          <Box>
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              From {props.lockedTitle}
            </Typography>
            <Stack
              direction="row"
              spacing={0.75}
              useFlexGap
              sx={{ flexWrap: "wrap", rowGap: 0.75 }}
            >
              {props.baseLocked.length === 0 ? (
                <Typography variant="caption" color="textSecondary">
                  {props.emptyBase}
                </Typography>
              ) : (
                props.baseLocked.map((name) => (
                  <ScopeChip
                    key={name}
                    name={name}
                    locked
                    selected
                    lockedTitle={props.lockedTitle}
                    onToggle={props.onToggle}
                  />
                ))
              )}
            </Stack>
          </Box>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ display: "block", mb: 0.5 }}
          >
            Added by you
          </Typography>
        </Stack>
      ) : null}
      <Stack spacing={1}>
        <TextField
          label={props.filterLabel}
          value={props.filter}
          placeholder="Search by name or description…"
          onChange={(event) => props.onFilter(event.currentTarget.value)}
        />
        {props.catalogFailed ? (
          <Alert severity="info" sx={{ py: 0.75 }}>
            The live list is unavailable — add entries by name below.
          </Alert>
        ) : null}
        {groupError ? (
          <Alert severity="warning" sx={{ py: 0.75 }}>
            {groupError}
          </Alert>
        ) : null}
        {atCap ? (
          <Typography variant="caption" color="error">
            Limit reached: {props.max} maximum.
          </Typography>
        ) : null}
        <Box
          sx={{
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: "8px",
            border: "1px solid rgba(var(--text-main), 0.12)",
            p: 1,
          }}
        >
          {props.catalogLoading ? (
            <Typography variant="caption" color="textSecondary">
              {props.loading}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {props.baseLocked === null ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  sx={{ flexWrap: "wrap", rowGap: 0.75 }}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    onClick={props.onClearAll}
                    sx={{
                      borderRadius: "8px",
                      color:
                        !props.noneActive && props.selected.length === 0
                          ? "rgba(var(--text-main), 0.5)"
                          : undefined,
                    }}
                  >
                    {props.allChip}
                  </Chip>
                  {props.noneChip ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      onClick={props.onBlockAll}
                      sx={{
                        borderRadius: "8px",
                        color: props.noneActive
                          ? "rgba(var(--text-main), 0.5)"
                          : undefined,
                      }}
                    >
                      {props.noneChip}
                    </Chip>
                  ) : null}
                </Stack>
              ) : null}
              {grouped.length === 0 ? (
                <Typography variant="caption" color="textSecondary">
                  {query
                    ? `No results for « ${props.filter.trim()} »`
                    : props.noMatch}
                </Typography>
              ) : (
                grouped.map(({ group, members, visible }) => {
                  const selectable = members.filter(
                    (entry) => !(props.baseLocked ?? []).includes(entry.name),
                  )
                  const selectedCount = selectable.filter((entry) =>
                    props.selected.includes(entry.name),
                  ).length
                  const allSelected =
                    selectable.length > 0 && selectedCount === selectable.length
                  const partial = selectedCount > 0 && !allSelected
                  return (
                    <Box key={group.label}>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        sx={{ mb: 0.5, flexWrap: "wrap", rowGap: 0.5 }}
                      >
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                        >
                          {group.label}
                        </Typography>
                        <Tip
                          title={
                            allSelected
                              ? "Unselect the whole group"
                              : "Allow the whole group"
                          }
                        >
                          <Chip
                            size="small"
                            variant={allSelected ? "filled" : "outlined"}
                            disabled={atCap && !allSelected}
                            aria-pressed={allSelected}
                            onClick={() => toggleGroup(visible, !allSelected)}
                            sx={{ borderRadius: "8px" }}
                          >
                            {partial
                              ? `${props.allChip.split(" ")[0]} · ${selectedCount}/${selectable.length}`
                              : props.allChip.split(" ")[0]}
                          </Chip>
                        </Tip>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        useFlexGap
                        sx={{ flexWrap: "wrap", rowGap: 0.75 }}
                      >
                        {visible.map((entry) => (
                          <ScopeChip
                            key={entry.name}
                            name={entry.name}
                            locked={(props.baseLocked ?? []).includes(
                              entry.name,
                            )}
                            selected={props.selected.includes(entry.name)}
                            lockedTitle={props.lockedTitle}
                            onToggle={(name) => {
                              clearGroupError()
                              props.onToggle(name)
                            }}
                            title={entry.description || undefined}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )
                })
              )}
            </Stack>
          )}
        </Box>
        {props.catalogFailed || props.manual !== "" ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label={props.manualLabel}
              value={props.manual}
              placeholder={props.manualPlaceholder}
              disabled={atCap}
              onChange={(event) => props.onManual(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  props.onManualAdd()
                }
              }}
              sx={{ maxWidth: 280 }}
            />
            <Button
              size="small"
              variant="text"
              disabled={atCap}
              onClick={props.onManualAdd}
            >
              Add
            </Button>
          </Stack>
        ) : null}
        {props.manualError ? (
          <Typography variant="caption" color="error">
            {props.manualError}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
}

function ScopeChip({
  name,
  locked,
  selected,
  lockedTitle,
  onToggle,
  title,
}: {
  name: string
  locked: boolean
  selected: boolean
  lockedTitle: string
  onToggle: (name: string) => void
  title?: string
}) {
  const chip = (
    <Chip
      size="small"
      variant={selected && !locked ? "filled" : "outlined"}
      disabled={locked}
      onClick={locked ? undefined : () => onToggle(name)}
      icon={
        locked ? (
          <LockIcon width={13} height={13} style={{ marginLeft: "8px" }} />
        ) : undefined
      }
      sx={{ borderRadius: "8px" }}
    >
      {name}
    </Chip>
  )
  if (!locked) return title ? <Tip title={title}>{chip}</Tip> : chip
  return (
    <Tip key={name} title={`From ${lockedTitle} — always allowed`}>
      {chip}
    </Tip>
  )
}

function scopedDescription(kind: string, names: string[]): string {
  const head = names.slice(0, 2).join(", ")
  const rest = names.length - 2
  return rest > 0
    ? `Only loads ${kind}: ${head}, +${rest} more`
    : `Only loads ${kind}: ${head}`
}

export function Personalities() {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  // The draft as it opened: closing compares against this so an intact
  // form closes silently and real edits ask before being dropped.
  const [pristine, setPristine] = useState<DraftSnapshot | null>(null)
  const [confirmId, setConfirmId] = useState("")
  const [skillCatalog, setSkillCatalog] = useState<ScopeEntry[] | null>(null)
  const [mcpCatalog, setMcpCatalog] = useState<ScopeEntry[] | null>(null)
  const [skillDirs, setSkillDirs] = useState<ScopeGroup[]>([])
  const [mcpDirs, setMcpDirs] = useState<ScopeGroup[]>([])
  const [catalogFailed, setCatalogFailed] = useState(false)
  // live:false is a sleeping desktop answering empty lists — not an error,
  // but the grouped picker would look broken with no hint, so it degrades
  // exactly like a failed catalog (info alert + manual add stay visible).
  const [catalogLive, setCatalogLive] = useState(true)
  const [filter, setFilter] = useState("")
  const [manualName, setManualName] = useState("")
  const [mcpFilter, setMcpFilter] = useState("")
  const [manualMcp, setManualMcp] = useState("")
  const titleId = useId()

  const load = useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      const body = await api<{ personas?: PersonaInfo[] }>("/api/personas")
      setPersonas(body.personas ?? [])
    } catch (caught) {
      setPersonas([])
      setError(
        caught instanceof Error
          ? caught.message
          : "failed to load personalities",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The scope catalog is only needed inside the dialog; a failure falls back
  // to free-text entry and never blocks saving. Keyed by the persona the
  // dialog opened for, so keystrokes in the draft never refetch it.
  const [catalogFor, setCatalogFor] = useState<string | null>(null)
  useEffect(() => {
    if (!catalogFor) return
    let cancelled = false
    setSkillCatalog(null)
    setMcpCatalog(null)
    setCatalogFailed(false)
    setCatalogLive(true)
    setFilter("")
    setManualName("")
    setMcpFilter("")
    setManualMcp("")
    api<{
      skills?: {
        name: string
        description?: string
        plugin?: { name: string } | null
        group?: string | null
        dirId?: string | null
        seed?: boolean
      }[]
      mcp?: {
        name: string
        plugin?: string | null
        dirId?: string | null
      }[]
      dirs?: {
        skill?: { id: string; label: string }[]
        mcp?: { id: string; label: string }[]
      }
      live?: boolean
    }>("/api/personas/skill-catalog")
      .then((body) => {
        if (cancelled) return
        setCatalogLive(body.live !== false)
        setSkillCatalog(
          (body.skills ?? []).map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            pluginName: skill.plugin?.name ?? null,
            groupLabel: skill.group ?? null,
            dirId: skill.dirId ?? null,
            seed: skill.seed ?? false,
          })),
        )
        setMcpCatalog(
          (body.mcp ?? []).map((server) => ({
            name: server.name,
            description: "",
            pluginName: server.plugin ?? null,
            dirId: server.dirId ?? null,
          })),
        )
        setSkillDirs(
          (body.dirs?.skill ?? []).map((dir) => ({
            id: dir.id,
            label: dir.label,
          })),
        )
        setMcpDirs(
          (body.dirs?.mcp ?? []).map((dir) => ({
            id: dir.id,
            label: dir.label,
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        setSkillCatalog([])
        setMcpCatalog([])
        setCatalogFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [catalogFor])

  function openNew() {
    setError("")
    setSaved("")
    setConfirmId("")
    const fresh: Draft = {
      id: "",
      name: "",
      instruction: "",
      skills: null,
      mcp: null,
      pluginName: null,
      baseLocked: null,
      mcpBaseLocked: null,
      extras: [],
      mcpExtras: [],
      skillsTouched: false,
      mcpTouched: false,
    }
    setDraft(fresh)
    setPristine(snapshotOf(fresh))
    setCatalogFor("new")
  }

  function openEdit(persona: PersonaInfo) {
    setError("")
    setSaved("")
    setConfirmId("")
    const next = draftFrom(persona)
    setDraft(next)
    setPristine(snapshotOf(next))
    setCatalogFor(persona.id)
  }

  function toggleSkill(name: string) {
    if (!draft) return
    if (draft.baseLocked !== null) {
      setDraft({
        ...draft,
        extras: draft.extras.includes(name)
          ? draft.extras.filter((item) => item !== name)
          : [...draft.extras, name],
        skillsTouched: true,
      })
      return
    }
    const current = draft.skills ?? []
    const next = current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]
    setDraft({ ...draft, skills: next, skillsTouched: true })
  }

  function toggleMcp(name: string) {
    if (!draft) return
    if (draft.mcpBaseLocked !== null) {
      setDraft({
        ...draft,
        mcpExtras: draft.mcpExtras.includes(name)
          ? draft.mcpExtras.filter((item) => item !== name)
          : [...draft.mcpExtras, name],
        mcpTouched: true,
      })
      return
    }
    const current = draft.mcp ?? []
    const next = current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]
    setDraft({ ...draft, mcp: next, mcpTouched: true })
  }

  function clearSkills() {
    if (!draft) return
    if (draft.baseLocked !== null) {
      setDraft({ ...draft, extras: [], skillsTouched: true })
      return
    }
    setDraft({ ...draft, skills: null, skillsTouched: true })
  }

  // Batch allow/deny a whole group (directory or plugin section). The picker
  // only sends names that are selectable and change state; the cap check ran
  // there too — this stays the single write path into the draft.
  function toggleSkillsGroup(names: string[], select: boolean) {
    if (!draft || names.length === 0) return
    if (draft.baseLocked !== null) {
      const extras = select
        ? [...draft.extras, ...names.filter((n) => !draft.extras.includes(n))]
        : draft.extras.filter((n) => !names.includes(n))
      setDraft({ ...draft, extras, skillsTouched: true })
      return
    }
    const current = draft.skills ?? []
    const next = select
      ? [...current, ...names.filter((n) => !current.includes(n))]
      : current.filter((n) => !names.includes(n))
    setDraft({ ...draft, skills: next, skillsTouched: true })
  }

  function toggleMcpGroup(names: string[], select: boolean) {
    if (!draft || names.length === 0) return
    if (draft.mcpBaseLocked !== null) {
      const extras = select
        ? [
            ...draft.mcpExtras,
            ...names.filter((n) => !draft.mcpExtras.includes(n)),
          ]
        : draft.mcpExtras.filter((n) => !names.includes(n))
      setDraft({ ...draft, mcpExtras: extras, mcpTouched: true })
      return
    }
    const current = draft.mcp ?? []
    const next = select
      ? [...current, ...names.filter((n) => !current.includes(n))]
      : current.filter((n) => !names.includes(n))
    setDraft({ ...draft, mcp: next, mcpTouched: true })
  }

  function clearMcp() {
    if (!draft) return
    if (draft.mcpBaseLocked !== null) {
      setDraft({ ...draft, mcpExtras: [], mcpTouched: true })
      return
    }
    setDraft({ ...draft, mcp: null, mcpTouched: true })
  }

  function addManual() {
    const name = manualName.trim()
    if (!draft || !name) return
    if (!SKILL_NAME.test(name)) {
      setError(
        "Skill names use lowercase letters, digits, hyphens, or underscores.",
      )
      return
    }
    setError("")
    setManualName("")
    if (draft.baseLocked !== null) {
      if (draft.extras.includes(name)) return
      setDraft({
        ...draft,
        extras: [...draft.extras, name],
        skillsTouched: true,
      })
      return
    }
    const current = draft.skills ?? []
    if (current.includes(name)) return
    setDraft({
      ...draft,
      skills: [...current, name],
      skillsTouched: true,
    })
  }

  function addManualMcp() {
    const name = manualMcp.trim()
    if (!draft || !name) return
    if (!MCP_NAME.test(name)) {
      setError(
        "MCP server names use letters, digits, dots, hyphens, or underscores.",
      )
      return
    }
    setError("")
    setManualMcp("")
    if (draft.mcpBaseLocked !== null) {
      if (draft.mcpExtras.includes(name)) return
      setDraft({
        ...draft,
        mcpExtras: [...draft.mcpExtras, name],
        mcpTouched: true,
      })
      return
    }
    const current = draft.mcp ?? []
    if (current.includes(name)) return
    setDraft({
      ...draft,
      mcp: [...current, name],
      mcpTouched: true,
    })
  }

  /** Escape, backdrop and Cancel share this: real edits ask first. */
  function requestClose() {
    if (busy) return
    if (
      draft &&
      snapshotDirty(
        pristine as Record<string, unknown> | null,
        snapshotOf(draft) as Record<string, unknown>,
      ) &&
      !confirmDiscard()
    )
      return
    setDraft(null)
    setPristine(null)
  }

  async function save() {
    if (!draft) return
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const restricted = restrictedSkills(draft)
      const mcpRestricted = restrictedMcp(draft)
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        instruction: draft.instruction.trim(),
      }
      if (draft.baseLocked !== null) {
        if (draft.skillsTouched) body.skillsExtra = draft.extras
      } else if (draft.skillsTouched || restricted) {
        body.skills = restricted
      }
      if (draft.mcpBaseLocked !== null) {
        if (draft.mcpTouched) body.mcpExtra = draft.mcpExtras
      } else if (draft.mcpTouched || mcpRestricted) {
        body.mcp = mcpRestricted
      }
      const payload = JSON.stringify(body)
      if (draft.id) {
        await api(`/api/personas/${encodeURIComponent(draft.id)}`, {
          method: "PUT",
          body: payload,
        })
      } else {
        await api("/api/personas", { method: "POST", body: payload })
      }
      const scopeNote = [
        restricted ? "Only the allowed skills load in new threads." : "",
        mcpRestricted
          ? mcpRestricted.length > 0
            ? "Only the allowed MCP servers load in new threads."
            : "Every MCP server is blocked in new threads."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
      setDraft(null)
      setPristine(null)
      setSaved(
        `Saved. Start a new thread and pick it.${scopeNote ? ` ${scopeNote}` : ""}`,
      )
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api(`/api/personas/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (draft?.id === id) {
        setDraft(null)
        setPristine(null)
      }
      setConfirmId("")
      setSaved("Removed. Threads that used it fall back to Assistant.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  const customCount = personas.filter((persona) => !persona.builtin).length

  const lockedTitle = draft?.pluginName ?? "the plugin"

  return (
    <ConfigSection
      icon={<PersonIcon />}
      title="Personalities"
      description="A name and how the bot should behave. Pick one when starting a thread. It stays for that thread. The bot can add the same customs."
      status={
        personas.length > 0
          ? {
              label: `${personas.length} total · ${customCount} custom`,
            }
          : null
      }
    >
      <Stack spacing={1.5} sx={{ position: "relative" }}>
        {error && !draft ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {loading && personas.length === 0 ? (
          <GhostCards />
        ) : personas.length === 0 ? (
          <EmptyState
            icon={<FaceIcon width={24} height={24} />}
            title="No personalities yet"
            subtext="Add one below, or ask the bot to create one. Plugins can install their own."
          />
        ) : (
          personas.map((persona) => {
            const restricted = persona.skillsEffective ?? null
            const mcpRestricted = persona.mcpEffective ?? null
            return (
              <ConfigItemCard
                key={persona.id}
                avatar={
                  persona.builtin ? (
                    <Tip title="Built-in — cannot edit or delete">
                      <ItemAvatar tone="muted">
                        <LockIcon width={20} height={20} />
                      </ItemAvatar>
                    </Tip>
                  ) : (
                    <ItemAvatar tone={persona.plugin ? "secondary" : "primary"}>
                      {initial(persona.name)}
                    </ItemAvatar>
                  )
                }
                title={persona.name}
                badge={
                  <>
                    {persona.plugin ? (
                      <PluginBadge plugin={persona.plugin} />
                    ) : null}
                    {persona.builtin ? (
                      <Tip title="Built-in — cannot edit or delete">
                        <LockIcon
                          width={16}
                          height={16}
                          style={{
                            color: "rgba(var(--text-main), 0.6)",
                            flexShrink: 0,
                          }}
                        />
                      </Tip>
                    ) : null}
                    {restricted ? (
                      <Tip title={`Allowed skills: ${restricted.join(", ")}`}>
                        <Chip
                          size="small"
                          variant="outlined"
                          sx={{ borderRadius: "8px", flexShrink: 0 }}
                        >
                          {restricted.length} skills only
                        </Chip>
                      </Tip>
                    ) : null}
                    {mcpRestricted ? (
                      <Tip
                        title={
                          mcpRestricted.length > 0
                            ? `Allowed MCP servers: ${mcpRestricted.join(", ")}`
                            : "Every MCP server is blocked for this personality"
                        }
                      >
                        <Chip
                          size="small"
                          variant="outlined"
                          sx={{ borderRadius: "8px", flexShrink: 0 }}
                        >
                          {mcpRestricted.length === 0
                            ? "MCP blocked"
                            : `${mcpRestricted.length} ${
                                mcpRestricted.length === 1
                                  ? "server"
                                  : "servers"
                              } only`}
                        </Chip>
                      </Tip>
                    ) : null}
                  </>
                }
                description={
                  persona.builtin
                    ? `${persona.instruction || "Default voice. No extra instructions."} Built-in personalities always have all skills.`
                    : persona.instruction ||
                      (restricted
                        ? scopedDescription("skills", restricted)
                        : mcpRestricted
                          ? mcpRestricted.length > 0
                            ? scopedDescription("MCP servers", mcpRestricted)
                            : "MCP is blocked for this personality"
                          : "Default voice. No extra instructions.")
                }
                pluginOwned={Boolean(persona.plugin)}
                actions={
                  persona.builtin ? undefined : (
                    <>
                      <Button
                        size="small"
                        variant="text"
                        disabled={busy}
                        onClick={() => openEdit(persona)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        color="error"
                        disabled={busy}
                        onClick={() => {
                          if (confirmId === persona.id) {
                            void remove(persona.id)
                            return
                          }
                          setConfirmId(persona.id)
                        }}
                      >
                        {confirmId === persona.id ? "Confirm delete" : "Delete"}
                      </Button>
                    </>
                  )
                }
              />
            )
          })
        )}
        {draft ? (
          <AccessibleDialog
            open
            fullWidth
            scroll="paper"
            aria-labelledby={titleId}
            slotProps={{ paper: { sx: { maxWidth: 900, minWidth: "45%" } } }}
            onClose={() => {
              requestClose()
            }}
          >
            <DialogTitle id={titleId}>
              {draft.id ? "Edit personality" : "New personality"}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Name"
                  value={draft.name}
                  placeholder="Brand designer"
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
                <TextField
                  label="How to behave"
                  value={draft.instruction}
                  multiline
                  rows={6}
                  placeholder="Speak as a brand designer. Prefer concrete visual choices. Keep replies short."
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      instruction: event.currentTarget.value,
                    })
                  }
                />
                <ScopePicker
                  sectionTitle="Allowed skills"
                  caption="Empty means all skills. A restricted persona loads only the ones listed."
                  filterLabel="Search skills"
                  allChip="All skills"
                  emptyBase="All skills (no restriction declared)"
                  noMatch="No skills match the filter."
                  loading="Loading skills…"
                  manualLabel="Add skill by name"
                  manualPlaceholder="research"
                  manualError={error}
                  entries={skillCatalog ?? []}
                  dirs={skillDirs}
                  max={64}
                  baseLocked={draft.baseLocked}
                  selected={
                    draft.baseLocked !== null
                      ? draft.extras
                      : (draft.skills ?? [])
                  }
                  catalogLoading={skillCatalog === null}
                  catalogFailed={catalogFailed || !catalogLive}
                  filter={filter}
                  manual={manualName}
                  lockedTitle={lockedTitle}
                  onFilter={setFilter}
                  onManual={setManualName}
                  onManualAdd={addManual}
                  onToggle={toggleSkill}
                  onToggleGroup={toggleSkillsGroup}
                  onClearAll={clearSkills}
                />
                <ScopePicker
                  sectionTitle="Allowed MCP servers"
                  caption="Empty means all servers. A restricted persona loads only the listed servers' tools."
                  filterLabel="Search servers"
                  allChip="All servers"
                  emptyBase="All servers (no restriction declared)"
                  noMatch="No servers match the filter."
                  loading="Loading servers…"
                  manualLabel="Add server by name"
                  manualPlaceholder="stock"
                  manualError=""
                  entries={mcpCatalog ?? []}
                  dirs={mcpDirs}
                  max={16}
                  baseLocked={draft.mcpBaseLocked}
                  selected={
                    draft.mcpBaseLocked !== null
                      ? draft.mcpExtras
                      : (draft.mcp ?? [])
                  }
                  catalogLoading={mcpCatalog === null}
                  catalogFailed={catalogFailed || !catalogLive}
                  filter={mcpFilter}
                  manual={manualMcp}
                  lockedTitle={lockedTitle}
                  onFilter={setMcpFilter}
                  onManual={setManualMcp}
                  onManualAdd={addManualMcp}
                  onToggle={toggleMcp}
                  onToggleGroup={toggleMcpGroup}
                  onClearAll={clearMcp}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="text" disabled={busy} onClick={requestClose}>
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={
                  busy || !draft.name.trim() || !draft.instruction.trim()
                }
                onClick={() => void save()}
              >
                Save personality
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        <Button
          variant="contained"
          disabled={busy || loading}
          onClick={openNew}
        >
          Add personality
        </Button>
      </Stack>
    </ConfigSection>
  )
}
