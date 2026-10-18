import Alert from "@shpaw415/mui-lite/Alert"
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
import {
  ConfigItemCard,
  EmptyState,
  GhostCards,
  ItemAvatar,
  PluginBadge,
} from "./ConfigList"
import { ConfigSection } from "./ConfigSection"
import { ExtensionIcon, PsychologyIcon } from "./icons"
import Stack from "./stack"

type SkillSummary = {
  name: string
  description: string
  plugin?: { id: string; name: string }
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
    <ConfigSection
      icon={<ExtensionIcon />}
      title="Custom skills"
      description="Stored in this desktop's OpenViking. The agent can create the same skills. desktop, cron, persona, cf-ai, shortcut, and refine stay built in and are not edited here."
      status={
        !loading && skills.length > 0
          ? {
              label: `${skills.length} custom`,
            }
          : null
      }
    >
      <Stack spacing={1.5}>
        {error && !draft ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {loading && skills.length === 0 ? (
          <>
            <Alert severity="info">
              Loading skills — this starts your desktop if it was asleep…
            </Alert>
            <GhostCards />
          </>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={<PsychologyIcon width={24} height={24} />}
            title="No skills yet"
            subtext="Add one below, or ask the agent to create one. Plugins can install their own."
          />
        ) : (
          skills.map((skill) => (
            <ConfigItemCard
              key={skill.name}
              avatar={
                <ItemAvatar tone={skill.plugin ? "secondary" : "primary"}>
                  <PsychologyIcon width={20} height={20} />
                </ItemAvatar>
              }
              title={skill.name}
              badge={
                skill.plugin ? <PluginBadge plugin={skill.plugin} /> : undefined
              }
              description={skill.description}
              pluginOwned={Boolean(skill.plugin)}
              actions={
                <>
                  <Button
                    size="small"
                    variant="text"
                    disabled={busy}
                    onClick={() => void openEdit(skill.name)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="error"
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
                </>
              }
            />
          ))
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
              {draft.previousName ? "Edit skill" : "New skill"}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Name"
                  value={draft.name}
                  placeholder="my-skill"
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                />
                <Typography variant="caption" color="textSecondary">
                  Kebab-case, up to 64 letters, numbers, hyphens, or
                  underscores.
                </Typography>
                <TextField
                  label="Description"
                  value={draft.description}
                  placeholder="When the agent should load this skill"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      description: event.currentTarget.value,
                    })
                  }
                />
                <TextField
                  label="Instructions"
                  value={draft.body}
                  multiline
                  rows={12}
                  placeholder="# My skill"
                  onChange={(event) =>
                    setDraft({ ...draft, body: event.currentTarget.value })
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
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                Save skill
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        <Button
          variant="contained"
          disabled={busy || loading}
          onClick={openNew}
        >
          Add skill
        </Button>
      </Stack>
    </ConfigSection>
  )
}
