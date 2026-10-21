import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
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
import {
  type DirectoryGroup,
  DirectorySection,
  useCollapsedDirs,
} from "./directory-sections"
import { confirmDiscard, snapshotDirty } from "./discard-guard"
import { useEventStream } from "./hooks"
import { ExtensionIcon, PsychologyIcon } from "./icons"
import Stack from "./stack"
import { Tip } from "./Tip"

type SkillSummary = {
  name: string
  description: string
  /** Manifest group label (display only). */
  group?: string | null
  plugin?: { id: string; name: string }
  /** Desktop seed skill: listed read-only (Move only, no edit/delete). */
  seed?: boolean
}

type SkillDetail = SkillSummary & {
  body: string
}

type CatalogDir = { id: string; kind: string; label: string; position: number }

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

const UNGROUPED_LABEL = "Ungrouped"
const BUILTIN_LABEL = "Built-in"

export function CustomSkills() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [dirs, setDirs] = useState<CatalogDir[]>([])
  const [dirOf, setDirOf] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  // The draft as it opened: closing asks before dropping real edits.
  const [pristine, setPristine] = useState<Draft | null>(null)
  const titleId = useId()
  const groupTitleId = useId()
  const moveTitleId = useId()
  const [confirmName, setConfirmName] = useState("")
  const [groupConfirm, setGroupConfirm] = useState("")
  // Group create (id null) / rename (id set) dialog.
  const [groupDraft, setGroupDraft] = useState<{
    id: string | null
    label: string
  } | null>(null)
  const [moveSkill, setMoveSkill] = useState<string | null>(null)
  const [collapsed, toggleCollapsed] = useCollapsedDirs(
    "ob.dirs.collapsed.skills",
  )

  const loadDirs = useCallback(async () => {
    try {
      const body = await api<{
        dirs?: CatalogDir[]
        items?: { name: string; dirId: string }[]
      }>("/api/catalog/dirs?kind=skill")
      setDirs(body.dirs ?? [])
      setDirOf(
        new Map((body.items ?? []).map((item) => [item.name, item.dirId])),
      )
    } catch {
      // Directory organization is optional: the tab still lists skills.
      setDirs([])
      setDirOf(new Map())
    }
  }, [])

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
    await loadDirs()
  }, [loadDirs])

  useEffect(() => {
    void load()
  }, [load])

  const { subscribe } = useEventStream(true)
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "catalog.changed") void loadDirs()
    })
  }, [subscribe, loadDirs])

  function openNew() {
    setError("")
    setSaved("")
    setConfirmName("")
    setDraft(emptyDraft)
    setPristine(emptyDraft)
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
      const next: Draft = {
        previousName: skill.name,
        name: skill.name,
        description: skill.description,
        body: skill.body,
      }
      setDraft(next)
      setPristine(next)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "failed to load skill",
      )
    } finally {
      setBusy(false)
    }
  }

  /** Escape, backdrop and Cancel share this: real edits ask first. */
  function requestClose() {
    if (busy) return
    if (
      snapshotDirty(
        pristine as Record<string, unknown> | null,
        (draft ?? null) as Record<string, unknown> | null,
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
      setPristine(null)
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
      if (draft?.previousName === name || draft?.name === name) {
        setDraft(null)
        setPristine(null)
      }
      setConfirmName("")
      setSaved("Removed.")
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  async function saveGroup() {
    if (!groupDraft) return
    const label = groupDraft.label.trim()
    if (!label) return
    setBusy(true)
    setError("")
    try {
      if (groupDraft.id) {
        await api(`/api/catalog/dirs/${encodeURIComponent(groupDraft.id)}`, {
          method: "PUT",
          body: JSON.stringify({ label }),
        })
        setSaved("Group renamed.")
      } else {
        await api("/api/catalog/dirs", {
          method: "POST",
          body: JSON.stringify({ kind: "skill", label }),
        })
        setSaved("Group created. Move skills into it from their card.")
      }
      setGroupDraft(null)
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function removeGroup(id: string) {
    setBusy(true)
    setError("")
    try {
      await api(`/api/catalog/dirs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      setGroupConfirm("")
      setSaved("Group removed. Its skills moved to the ungrouped list.")
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  // The client sends the full ordered id list; unknown ids are ignored.
  async function reorderGroups(ids: string[]) {
    setBusy(true)
    setError("")
    try {
      await api("/api/catalog/dirs/reorder", {
        method: "PUT",
        body: JSON.stringify({ kind: "skill", ids }),
      })
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reorder failed")
    } finally {
      setBusy(false)
    }
  }

  async function assign(name: string, dirId: string | null) {
    setBusy(true)
    setError("")
    try {
      await api("/api/catalog/dirs/assign", {
        method: "PUT",
        body: JSON.stringify({ kind: "skill", names: [name], dirId }),
      })
      setMoveSkill(null)
      await loadDirs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "move failed")
    } finally {
      setBusy(false)
    }
  }

  // Sections: plugin groups (locked, "From <plugin>") → user groups
  // (position order) → Ungrouped (always last). A manifest `group` label
  // refines a plugin section title.
  const sections = useMemo(() => {
    type Bucket = { key: string; group: DirectoryGroup; skills: SkillSummary[] }
    const userBuckets = new Map<string, Bucket>()
    for (const dir of dirs)
      userBuckets.set(`dir:${dir.id}`, {
        key: `dir:${dir.id}`,
        group: { id: dir.id, label: dir.label, count: 0 },
        skills: [],
      })
    const pluginBuckets = new Map<string, Bucket>()
    let builtin: Bucket | null = null
    let ungrouped: Bucket | null = null
    const bucketFor = (skill: SkillSummary): Bucket => {
      if (skill.plugin) {
        const key = `plugin:${skill.plugin.id}:${skill.group ?? ""}`
        let bucket = pluginBuckets.get(key)
        if (!bucket) {
          bucket = {
            key,
            group: {
              id: null,
              label: skill.group
                ? `From ${skill.plugin.name} · ${skill.group}`
                : `From ${skill.plugin.name}`,
              count: 0,
              locked: true,
              badge: <PluginBadge plugin={skill.plugin} />,
            },
            skills: [],
          }
          pluginBuckets.set(key, bucket)
        }
        return bucket
      }
      const dirId = dirOf.get(skill.name)
      const bucket = dirId ? userBuckets.get(`dir:${dirId}`) : undefined
      if (bucket) return bucket
      // Unfiled seed skills get their own read-only Built-in section so
      // Ungrouped stays for what the user actually filed nowhere.
      if (skill.seed) {
        if (!builtin)
          builtin = {
            key: "builtin",
            group: { id: null, label: BUILTIN_LABEL, count: 0, locked: true },
            skills: [],
          }
        return builtin
      }
      if (!ungrouped)
        ungrouped = {
          key: "ungrouped",
          group: { id: null, label: UNGROUPED_LABEL, count: 0 },
          skills: [],
        }
      return ungrouped
    }
    for (const skill of skills) {
      const bucket = bucketFor(skill)
      bucket.skills.push(skill)
      bucket.group.count++
    }
    return [
      ...[...pluginBuckets.values()].sort((a, b) =>
        a.group.label.localeCompare(b.group.label),
      ),
      ...userBuckets.values(),
      ...(builtin ? [builtin] : []),
      ...(ungrouped ? [ungrouped] : []),
    ]
  }, [skills, dirs, dirOf])

  const groupActions = (dir: CatalogDir, index: number) => (
    <Stack direction="row" spacing={0.25} alignItems="center">
      <Button
        size="small"
        variant="text"
        disabled={busy || index === 0}
        aria-label={`Move ${dir.label} up`}
        onClick={() => {
          const ids = dirs.map((d) => d.id)
          ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
          void reorderGroups(ids)
        }}
      >
        ↑
      </Button>
      <Button
        size="small"
        variant="text"
        disabled={busy || index === dirs.length - 1}
        aria-label={`Move ${dir.label} down`}
        onClick={() => {
          const ids = dirs.map((d) => d.id)
          ;[ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]
          void reorderGroups(ids)
        }}
      >
        ↓
      </Button>
      <Button
        size="small"
        variant="text"
        disabled={busy}
        onClick={() => setGroupDraft({ id: dir.id, label: dir.label })}
      >
        Rename
      </Button>
      <Button
        size="small"
        variant="text"
        color="error"
        disabled={busy}
        onClick={() => {
          if (groupConfirm === dir.id) {
            void removeGroup(dir.id)
            return
          }
          setGroupConfirm(dir.id)
        }}
      >
        {groupConfirm === dir.id ? "Confirm delete" : "Delete"}
      </Button>
    </Stack>
  )

  const skillCard = (skill: SkillSummary) => (
    <ConfigItemCard
      key={skill.name}
      avatar={
        <ItemAvatar
          tone={skill.plugin ? "secondary" : skill.seed ? "muted" : "primary"}
        >
          <PsychologyIcon width={20} height={20} />
        </ItemAvatar>
      }
      title={skill.name}
      badge={
        skill.plugin ? (
          <PluginBadge plugin={skill.plugin} />
        ) : skill.seed ? (
          <Tip title="Desktop seed skill — updated with open-bot; can be filed into a group but not edited here">
            <Chip size="small" variant="outlined" sx={{ borderRadius: "8px" }}>
              Built-in
            </Chip>
          </Tip>
        ) : undefined
      }
      description={skill.description}
      pluginOwned={Boolean(skill.plugin)}
      actions={
        <>
          {skill.seed || skill.plugin ? null : (
            <Button
              size="small"
              variant="text"
              disabled={busy}
              onClick={() => void openEdit(skill.name)}
            >
              Edit
            </Button>
          )}
          {skill.plugin ? null : (
            <Button
              size="small"
              variant="text"
              disabled={busy}
              onClick={() => setMoveSkill(skill.name)}
            >
              Move
            </Button>
          )}
          {skill.seed || skill.plugin ? null : (
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
          )}
        </>
      }
    />
  )

  return (
    <ConfigSection
      icon={<ExtensionIcon />}
      title="Custom skills"
      description="Your OpenViking skills plus this desktop's built-in ones (read-only). The agent can create the same skills. desktop, cron, persona, cf-ai, shortcut, and refine stay built in and are not edited here."
      status={
        !loading && skills.length > 0
          ? {
              label: `${skills.length}`,
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
          <Stack spacing={2}>
            {sections.map((section) => {
              const dirIndex =
                section.group.id !== null
                  ? dirs.findIndex((d) => d.id === section.group.id)
                  : -1
              return (
                <DirectorySection
                  key={section.key}
                  group={
                    section.group.id !== null && dirIndex >= 0
                      ? {
                          ...section.group,
                          actions: groupActions(
                            dirs[dirIndex] as CatalogDir,
                            dirIndex,
                          ),
                        }
                      : section.group
                  }
                  collapsed={collapsed}
                  onToggle={toggleCollapsed}
                  emptyText={
                    section.group.locked
                      ? "No skills in this group yet."
                      : section.group.id !== null
                        ? "No skills here — use Move on a skill card."
                        : "Everything not in a group lands here."
                  }
                >
                  {section.skills.map(skillCard)}
                </DirectorySection>
              )
            })}
          </Stack>
        )}
        {draft ? (
          <AccessibleDialog
            open
            fullWidth
            scroll="paper"
            aria-labelledby={titleId}
            slotProps={{ paper: { sx: { maxWidth: 900, minWidth: "45%" } } }}
            onClose={requestClose}
          >
            <DialogTitle id={titleId}>
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
              <Button variant="text" disabled={busy} onClick={requestClose}>
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
        {groupDraft ? (
          <AccessibleDialog
            open
            aria-labelledby={groupTitleId}
            onClose={() => setGroupDraft(null)}
          >
            <DialogTitle id={groupTitleId}>
              {groupDraft.id ? "Rename group" : "New group"}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                  label="Label"
                  value={groupDraft.label}
                  placeholder="Research, Writing…"
                  autoFocus
                  onChange={(event) =>
                    setGroupDraft({
                      ...groupDraft,
                      label: event.currentTarget.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void saveGroup()
                    }
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  Organization only — groups never change which skills a persona
                  can allow.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => setGroupDraft(null)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={busy || !groupDraft.label.trim()}
                onClick={() => void saveGroup()}
              >
                {groupDraft.id ? "Save" : "Create group"}
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        {moveSkill ? (
          <AccessibleDialog
            open
            aria-labelledby={moveTitleId}
            onClose={() => setMoveSkill(null)}
          >
            <DialogTitle id={moveTitleId}>Move « {moveSkill} »</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Select
                  name="move-skill-dir"
                  label="Group"
                  value={dirOf.get(moveSkill) ?? ""}
                  onSelect={(value: string) => {
                    void assign(moveSkill, value || null)
                  }}
                >
                  {[
                    <option key="none" value="">
                      {UNGROUPED_LABEL}
                    </option>,
                    ...dirs.map((dir) => (
                      <option key={dir.id} value={dir.id}>
                        {dir.label}
                      </option>
                    )),
                  ]}
                </Select>
                <Typography variant="caption" color="textSecondary">
                  Picking a group moves the skill immediately.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button variant="text" onClick={() => setMoveSkill(null)}>
                Close
              </Button>
            </DialogActions>
          </AccessibleDialog>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || loading}
            onClick={openNew}
          >
            Add skill
          </Button>
          <Button
            variant="text"
            disabled={busy || loading}
            onClick={() => setGroupDraft({ id: null, label: "" })}
          >
            New group
          </Button>
        </Stack>
      </Stack>
    </ConfigSection>
  )
}
