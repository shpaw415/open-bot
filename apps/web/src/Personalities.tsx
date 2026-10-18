import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { api } from "./api"
import { Chip } from "./chip"
import {
  ConfigItemCard,
  EmptyState,
  GhostCards,
  ItemAvatar,
  PluginBadge,
} from "./ConfigList"
import { ConfigSection } from "./ConfigSection"
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
}

// Same shape the server enforces: a stray glob character would re-open the
// whole allowlist under opencode's minimatch.
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

type Draft = {
  id: string
  name: string
  instruction: string
  // User personas: the editable base list (null = all skills).
  skills: string[] | null
  // Plugin personas: locked base plus the user's editable extras.
  pluginName: string | null
  baseLocked: string[] | null
  extras: string[]
  skillsTouched: boolean
}

function draftFrom(persona: PersonaInfo): Draft {
  const plugin = persona.plugin ?? null
  return {
    id: persona.id,
    name: persona.name,
    instruction: persona.instruction,
    skills: plugin ? null : (persona.skills ?? null),
    pluginName: plugin?.name ?? null,
    baseLocked: plugin ? (persona.skills ?? null) : null,
    extras: persona.skillsExtra ?? [],
    skillsTouched: false,
  }
}

function restrictedNames(draft: Draft): string[] | null {
  if (draft.baseLocked !== null) {
    const merged = [...draft.baseLocked]
    for (const name of draft.extras)
      if (!merged.includes(name)) merged.push(name)
    return merged
  }
  return draft.skills && draft.skills.length > 0 ? draft.skills : null
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase()
}

function scopedDescription(names: string[]): string {
  const head = names.slice(0, 2).join(", ")
  const rest = names.length - 2
  return rest > 0 ? `Only loads: ${head}, +${rest} more` : `Only loads: ${head}`
}

function SkillChip({
  name,
  locked,
  selected,
  lockedTitle,
  onToggle,
}: {
  name: string
  locked: boolean
  selected: boolean
  lockedTitle: string
  onToggle: (name: string) => void
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
  if (!locked) return chip
  return (
    <Tip key={name} title={`From ${lockedTitle} — always allowed`}>
      {chip}
    </Tip>
  )
}

export function Personalities() {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmId, setConfirmId] = useState("")
  const [catalog, setCatalog] = useState<string[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [filter, setFilter] = useState("")
  const [manualName, setManualName] = useState("")

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

  // The skill catalog is only needed inside the dialog; a failure falls back
  // to free-text entry and never blocks saving.
  useEffect(() => {
    if (!draft) return
    let cancelled = false
    setCatalog(null)
    setCatalogFailed(false)
    setFilter("")
    setManualName("")
    api<{ skills?: { name: string }[]; live?: boolean }>(
      "/api/personas/skill-catalog",
    )
      .then((body) => {
        if (cancelled) return
        setCatalog((body.skills ?? []).map((skill) => skill.name))
      })
      .catch(() => {
        if (cancelled) return
        setCatalog([])
        setCatalogFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [draft?.id])

  function openNew() {
    setError("")
    setSaved("")
    setConfirmId("")
    setDraft({
      id: "",
      name: "",
      instruction: "",
      skills: null,
      pluginName: null,
      baseLocked: null,
      extras: [],
      skillsTouched: false,
    })
  }

  function openEdit(persona: PersonaInfo) {
    setError("")
    setSaved("")
    setConfirmId("")
    setDraft(draftFrom(persona))
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

  function clearAll() {
    if (!draft) return
    if (draft.baseLocked !== null) {
      setDraft({ ...draft, extras: [], skillsTouched: true })
      return
    }
    setDraft({ ...draft, skills: null, skillsTouched: true })
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

  async function save() {
    if (!draft) return
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const restricted = restrictedNames(draft)
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        instruction: draft.instruction.trim(),
      }
      if (draft.baseLocked !== null) {
        if (draft.skillsTouched) body.skillsExtra = draft.extras
      } else if (draft.skillsTouched || restricted) {
        body.skills = restricted
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
      const wasRestricted = Boolean(restricted)
      setDraft(null)
      setSaved(
        `Saved. Start a new thread and pick it.${
          wasRestricted ? " Only the allowed skills load in new threads." : ""
        }`,
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
      if (draft?.id === id) setDraft(null)
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

  const pickerNames = (() => {
    if (!draft) return []
    const names = new Set<string>()
    for (const name of catalog ?? []) names.add(name)
    for (const name of draft.baseLocked ?? []) names.add(name)
    for (const name of restrictedNames(draft) ?? []) names.add(name)
    for (const name of draft.extras) names.add(name)
    const query = filter.trim().toLowerCase()
    return [...names]
      .filter((name) => !query || name.includes(query))
      .sort()
  })()

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
                  </>
                }
                description={
                  persona.builtin
                    ? `${persona.instruction || "Default voice. No extra instructions."} Built-in personalities always have all skills.`
                    : persona.instruction ||
                      (restricted
                        ? scopedDescription(restricted)
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
            slotProps={{ paper: { sx: { maxWidth: 900, minWidth: "45%" } } }}
            onClose={() => {
              if (!busy) setDraft(null)
            }}
          >
            <DialogTitle>
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
                <Box>
                  <Typography variant="subtitle2">Allowed skills</Typography>
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    sx={{ display: "block", mb: 1 }}
                  >
                    Empty means all skills. A restricted persona loads only the
                    ones listed.
                  </Typography>
                  {draft.baseLocked !== null ? (
                    <Stack spacing={1.25} sx={{ mb: 1.25 }}>
                      <Box>
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          From {lockedTitle}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          useFlexGap
                          sx={{ flexWrap: "wrap", rowGap: 0.75 }}
                        >
                          {draft.baseLocked.length === 0 ? (
                            <Typography variant="caption" color="textSecondary">
                              All skills (no restriction declared)
                            </Typography>
                          ) : (
                            draft.baseLocked.map((name) => (
                              <SkillChip
                                key={name}
                                name={name}
                                locked
                                selected
                                lockedTitle={lockedTitle}
                                onToggle={toggleSkill}
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
                      label="Filter skills"
                      value={filter}
                      onChange={(event) =>
                        setFilter(event.currentTarget.value)
                      }
                    />
                    {catalogFailed ? (
                      <Alert severity="info" sx={{ py: 0.75 }}>
                        The live skill list is unavailable — add skills by name
                        below.
                      </Alert>
                    ) : null}
                    <Box
                      sx={{
                        maxHeight: 280,
                        overflowY: "auto",
                        borderRadius: "8px",
                        border: "1px solid rgba(var(--text-main), 0.12)",
                        p: 1,
                      }}
                    >
                      {catalog === null ? (
                        <Typography variant="caption" color="textSecondary">
                          Loading skills…
                        </Typography>
                      ) : (
                        <Stack
                          direction="row"
                          spacing={0.75}
                          useFlexGap
                          sx={{ flexWrap: "wrap", rowGap: 0.75 }}
                        >
                          {draft.baseLocked === null ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              onClick={clearAll}
                              sx={{
                                borderRadius: "8px",
                                color:
                                  (draft.skills ?? []).length === 0
                                    ? "rgba(var(--text-main), 0.5)"
                                    : undefined,
                              }}
                            >
                              All skills
                            </Chip>
                          ) : null}
                          {pickerNames.map((name) => (
                            <SkillChip
                              key={name}
                              name={name}
                              locked={(draft.baseLocked ?? []).includes(name)}
                              selected={(
                                draft.baseLocked !== null
                                  ? draft.extras
                                  : (draft.skills ?? [])
                              ).includes(name)}
                              lockedTitle={lockedTitle}
                              onToggle={toggleSkill}
                            />
                          ))}
                          {pickerNames.length === 0 &&
                          draft.baseLocked !== null ? (
                            <Typography
                              variant="caption"
                              color="textSecondary"
                            >
                              No skills match the filter.
                            </Typography>
                          ) : null}
                        </Stack>
                      )}
                    </Box>
                    {catalogFailed || manualName !== "" ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                          label="Add skill by name"
                          value={manualName}
                          placeholder="research"
                          onChange={(event) =>
                            setManualName(event.currentTarget.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              addManual()
                            }
                          }}
                          sx={{ maxWidth: 280 }}
                        />
                        <Button size="small" variant="text" onClick={addManual}>
                          Add
                        </Button>
                      </Stack>
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
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
