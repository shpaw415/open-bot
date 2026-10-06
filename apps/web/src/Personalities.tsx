import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"

export type PersonaInfo = {
  id: string
  name: string
  instruction: string
  builtin: boolean
}

type Draft = {
  id: string
  name: string
  instruction: string
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

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Personalities</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        A name and how the bot should behave. Pick one when starting a thread.
        It stays for that thread. Built-ins cannot be edited. The bot can add
        the same customs.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {loading && personas.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            Loading personalities…
          </Typography>
        ) : (
          personas.map((persona) => (
            <Stack
              key={persona.id}
              direction="row"
              spacing={1}
              alignItems="center"
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">
                  {persona.name}
                  {persona.builtin ? " · built-in" : ""}
                </Typography>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {persona.instruction ||
                    "Default voice. No extra instructions."}
                </Typography>
              </Stack>
              {persona.builtin ? null : (
                <>
                  <Button
                    variant="text"
                    disabled={busy}
                    onClick={() => openEdit(persona)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="text"
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
              )}
            </Stack>
          ))
        )}
        {draft ? (
          <Stack spacing={1.5}>
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
              rows={4}
              placeholder="Speak as a brand designer. Prefer concrete visual choices. Keep replies short."
              onChange={(event) =>
                setDraft({ ...draft, instruction: event.currentTarget.value })
              }
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={
                  busy || !draft.name.trim() || !draft.instruction.trim()
                }
                onClick={() => void save()}
              >
                Save personality
              </Button>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Button
            variant="contained"
            disabled={busy || loading}
            onClick={openNew}
          >
            Add personality
          </Button>
        )}
      </Stack>
    </Paper>
  )
}
