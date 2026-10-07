import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"

type SkillSummary = {
  name: string
  description: string
}

type SkillDetail = SkillSummary & {
  body: string
}

type Draft = {
  previousName: string
  name: string
  description: string
  body: string
}

const emptyDraft: Draft = {
  previousName: "",
  name: "",
  description: "",
  body: "",
}

export function CustomSkills() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmName, setConfirmName] = useState("")

  const load = useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      const body = await api<{ skills?: SkillSummary[] }>("/api/skills")
      setSkills(body.skills ?? [])
    } catch (caught) {
      setSkills([])
      setError(
        caught instanceof Error ? caught.message : "failed to load skills",
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
    setConfirmName("")
    setDraft(emptyDraft)
  }

  async function openEdit(name: string) {
    setError("")
    setSaved("")
    setConfirmName("")
    setBusy(true)
    try {
      const skill = await api<SkillDetail>(
        `/api/skills?name=${encodeURIComponent(name)}`,
      )
      setDraft({
        previousName: skill.name,
        name: skill.name,
        description: skill.description,
        body: skill.body,
      })
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "failed to load skill",
      )
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft) return
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/skills", {
        method: "PUT",
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim(),
          body: draft.body,
          previousName: draft.previousName,
        }),
      })
      setDraft(null)
      setSaved("Saved. The desktop agent can load this skill from OpenViking.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove(name: string) {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/skills", {
        method: "DELETE",
        body: JSON.stringify({ name }),
      })
      if (draft?.previousName === name || draft?.name === name) setDraft(null)
      setConfirmName("")
      setSaved("Removed.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle1">Custom skills</Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Stored in this desktop's OpenViking. The agent can create the same
        skills. desktop, cron, persona, cf-ai, and shortcut stay built in and
        are not edited here.
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {saved ? <Alert severity="success">{saved}</Alert> : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {loading && skills.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            Loading skills — this starts your desktop if it was asleep…
          </Typography>
        ) : (
          skills.map((skill) => (
            <Stack
              key={skill.name}
              direction="row"
              spacing={1}
              alignItems="center"
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{skill.name}</Typography>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {skill.description}
                </Typography>
              </Stack>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => void openEdit(skill.name)}
              >
                Edit
              </Button>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => {
                  if (confirmName === skill.name) {
                    void remove(skill.name)
                    return
                  }
                  setConfirmName(skill.name)
                }}
              >
                {confirmName === skill.name ? "Confirm delete" : "Delete"}
              </Button>
            </Stack>
          ))
        )}
        {!loading && skills.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No custom skills yet.
          </Typography>
        ) : null}
        {draft ? (
          <Stack spacing={1.5}>
            <TextField
              label="Name"
              value={draft.name}
              placeholder="my-skill"
              onChange={(event) =>
                setDraft({ ...draft, name: event.currentTarget.value })
              }
            />
            <Typography variant="caption" color="textSecondary">
              Kebab-case, up to 64 letters, numbers, hyphens, or underscores.
            </Typography>
            <TextField
              label="Description"
              value={draft.description}
              placeholder="When the agent should load this skill"
              onChange={(event) =>
                setDraft({ ...draft, description: event.currentTarget.value })
              }
            />
            <TextField
              label="Instructions"
              value={draft.body}
              multiline
              rows={8}
              placeholder="# My skill"
              onChange={(event) =>
                setDraft({ ...draft, body: event.currentTarget.value })
              }
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                Save skill
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
            Add skill
          </Button>
        )}
      </Stack>
    </Paper>
  )
}
