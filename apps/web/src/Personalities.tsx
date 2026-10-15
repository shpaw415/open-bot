import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Dialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@shpaw415/mui-lite/Dialog"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import {
  ConfigItemCard,
  EmptyState,
  GhostCards,
  ItemAvatar,
  PluginBadge,
} from "./ConfigList"
import { ConfigSection } from "./ConfigSection"
import { FaceIcon, LockIcon, PersonIcon } from "./icons"

export type PersonaInfo = {
  id: string
  name: string
  instruction: string
  builtin: boolean
  plugin?: { id: string; name: string }
}

type Draft = {
  id: string
  name: string
  instruction: string
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase()
}

export function Personalities() {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmId, setConfirmId] = useState("")

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

  function openNew() {
    setError("")
    setSaved("")
    setConfirmId("")
    setDraft({ id: "", name: "", instruction: "" })
  }

  function openEdit(persona: PersonaInfo) {
    setError("")
    setSaved("")
    setConfirmId("")
    setDraft({
      id: persona.id,
      name: persona.name,
      instruction: persona.instruction,
    })
  }

  async function save() {
    if (!draft) return
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = JSON.stringify({
        name: draft.name.trim(),
        instruction: draft.instruction.trim(),
      })
      if (draft.id) {
        await api(`/api/personas/${encodeURIComponent(draft.id)}`, {
          method: "PUT",
          body,
        })
      } else {
        await api("/api/personas", { method: "POST", body })
      }
      setDraft(null)
      setSaved("Saved. Start a new thread and pick it.")
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
          personas.map((persona) => (
            <ConfigItemCard
              key={persona.id}
              avatar={
                persona.builtin ? (
                  <ToolTip title="Built-in — cannot edit or delete">
                    <ItemAvatar tone="muted">
                      <LockIcon width={20} height={20} />
                    </ItemAvatar>
                  </ToolTip>
                ) : (
                  <ItemAvatar tone={persona.plugin ? "secondary" : "primary"}>
                    {initial(persona.name)}
                  </ItemAvatar>
                )
              }
              title={persona.name}
              badge={
                persona.plugin ? (
                  <PluginBadge plugin={persona.plugin} />
                ) : persona.builtin ? (
                  <ToolTip title="Built-in — cannot edit or delete">
                    <LockIcon
                      width={16}
                      height={16}
                      style={{ color: "rgba(var(--text-main), 0.6)", flexShrink: 0 }}
                    />
                  </ToolTip>
                ) : undefined
              }
              description={
                persona.instruction || "Default voice. No extra instructions."
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
          ))
        )}
        {draft ? (
          <Dialog
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
          </Dialog>
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
