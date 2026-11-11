import Alert from "@shpaw415/mui-lite/Alert"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Switch from "@shpaw415/mui-lite/Switch"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { api } from "./api"
import AccessibleDialog, {
  DialogActions,
  DialogContent,
  DialogTitle,
} from "./AccessibleDialog"
import { Chip } from "./chip"
import { Tip } from "./Tip"
import { ConfigSection } from "./ConfigSection"
import { confirmDiscard, snapshotDirty } from "./discard-guard"
import {
  ScopePicker,
  type ScopeEntry,
  type ScopeGroup,
} from "./Personalities"
import {
  emptySandboxProfile,
  SANDBOX_EDIT_CAPS,
  SANDBOX_TOOL_LABELS,
  sandboxModelLabel,
  sandboxProfileSummary,
  type SandboxProfile,
  type SandboxProfileEntry,
} from "./sandbox"
import Stack from "./stack"

// Sandbox profile editor (docs/sandbox-threads-spec.md phase 2): the
// capability grant a sandbox thread launches with — model, skills, MCP
// servers, builtin tools, network, secrets, lifetime, and resource
// limits. The control plane owns validation; this editor mirrors its
// caps for immediate feedback and degrades to manual entry when the
// catalog cannot load.

type Catalog = {
  skills: ScopeEntry[]
  mcp: ScopeEntry[]
  skillDirs: ScopeGroup[]
  mcpDirs: ScopeGroup[]
  failed: boolean
  live: boolean
}

const EMPTY_CATALOG: Catalog = {
  skills: [],
  mcp: [],
  skillDirs: [],
  mcpDirs: [],
  failed: false,
  live: true,
}

async function loadCatalog(): Promise<Catalog> {
  try {
    const body = await api<{
      skills?: {
        name: string
        description?: string
        plugin?: { name: string } | null
        group?: string | null
        dirId?: string | null
        seed?: boolean
      }[]
      mcp?: { name: string; plugin?: string | null; dirId?: string | null }[]
      dirs?: {
        skill?: { id: string; label: string }[]
        mcp?: { id: string; label: string }[]
      }
      live?: boolean
    }>("/api/personas/skill-catalog")
    return {
      skills: (body.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description ?? "",
        pluginName: skill.plugin?.name ?? null,
        groupLabel: skill.group ?? null,
        dirId: skill.dirId ?? null,
        seed: skill.seed ?? false,
      })),
      mcp: (body.mcp ?? []).map((server) => ({
        name: server.name,
        description: "",
        pluginName: server.plugin ?? null,
        dirId: server.dirId ?? null,
      })),
      skillDirs: body.dirs?.skill ?? [],
      mcpDirs: body.dirs?.mcp ?? [],
      failed: false,
      live: body.live !== false,
    }
  } catch {
    return { ...EMPTY_CATALOG, failed: true }
  }
}

/** Normalize a profile's model ref for the select: instance refs keep
 * their key, anything provider/model shaped becomes "broker". */
export function sandboxModelChoice(model: string | undefined): string {
  const ref = model?.trim() || "chat"
  if (ref === "chat" || ref === "small") return ref
  return "broker"
}

export function isBrokeredModelRef(model: string | undefined): boolean {
  return sandboxModelChoice(model) === "broker"
}

export function SandboxProfiles() {
  const [profiles, setProfiles] = useState<SandboxProfileEntry[] | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState<SandboxProfile | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftBuiltin, setDraftBuiltin] = useState(false)
  const [pristine, setPristine] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState("")
  const confirmTimer = useRef<number | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const titleId = useId()

  const load = useCallback(async () => {
    try {
      const body = await api<{ profiles?: SandboxProfileEntry[] }>(
        "/api/sandbox-profiles",
      )
      setProfiles(body.profiles ?? [])
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "échec du chargement")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    },
    [],
  )

  function openEditor(entry: SandboxProfileEntry | null) {
    setError("")
    setNotice("")
    const profile = entry
      ? structuredClone(entry.profile)
      : emptySandboxProfile()
    setDraft(profile)
    setDraftId(entry && !entry.builtin ? entry.id : null)
    setDraftBuiltin(Boolean(entry?.builtin))
    setPristine(JSON.parse(JSON.stringify(profile)) as Record<string, unknown>)
    if (!catalog) void loadCatalog().then(setCatalog)
  }

  /** Escape, backdrop and Cancel share this: real edits ask first. */
  function requestClose() {
    if (busy) return
    if (
      draft &&
      snapshotDirty(
        pristine,
        JSON.parse(JSON.stringify(draft)) as Record<string, unknown>,
      ) &&
      !confirmDiscard()
    )
      return
    setDraft(null)
    setDraftId(null)
    setDraftBuiltin(false)
  }

  function patchProfile(patch: Partial<SandboxProfile>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function save() {
    if (!draft) return
    setError("")
    setBusy(true)
    try {
      const payload = { ...draft, name: draft.name.trim() }
      if (draftId)
        await api(`/api/sandbox-profiles/${encodeURIComponent(draftId)}`, {
          method: "PUT",
          body: JSON.stringify({ profile: payload }),
        })
      else
        await api("/api/sandbox-profiles", {
          method: "POST",
          body: JSON.stringify({ profile: payload }),
        })
      setDraft(null)
      setDraftId(null)
      setDraftBuiltin(false)
      setNotice(`Profil « ${payload.name} » enregistré.`)
      await load()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "échec de la sauvegarde",
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(entry: SandboxProfileEntry) {
    if (confirmId !== entry.id) {
      setConfirmId(entry.id)
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmId(""), 4000)
      return
    }
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    setConfirmId("")
    setBusy(true)
    setError("")
    try {
      await api(`/api/sandbox-profiles/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      })
      setNotice(`Profil « ${entry.name} » supprimé.`)
      await load()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "échec de la suppression",
      )
    } finally {
      setBusy(false)
    }
  }

  const entries = profiles ?? []
  const builtins = entries.filter((entry) => entry.builtin)
  const customs = entries.filter((entry) => !entry.builtin)

  function renderCard(entry: SandboxProfileEntry) {
    return (
      <Paper key={entry.id} variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{ flexWrap: "wrap", gap: 1 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1">{entry.name}</Typography>
              {entry.builtin ? (
                <Tip title="Intégré — se lit seulement, dupliquez-le pour l'adapter">
                  <Chip label="intégré" size="small" />
                </Tip>
              ) : null}
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                disabled={busy}
                onClick={() => openEditor(entry)}
              >
                {entry.builtin ? "Voir" : "Modifier"}
              </Button>
              {entry.builtin ? null : (
                <Button
                  size="small"
                  color="error"
                  disabled={busy}
                  onClick={() => void remove(entry)}
                >
                  {confirmId === entry.id ? "Confirmer ?" : "Supprimer"}
                </Button>
              )}
            </Stack>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            {sandboxProfileSummary(entry.profile)} ·{" "}
            {sandboxModelLabel(entry.profile.model)}
          </Typography>
          {entry.profile.instruction ? (
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ whiteSpace: "pre-wrap" }}
            >
              {entry.profile.instruction}
            </Typography>
          ) : null}
        </Stack>
      </Paper>
    )
  }

  return (
    <ConfigSection
      title="Bac à sable"
      description="Un profil lance un fil dans un conteneur jetable : aucune clé, aucun fichier du bureau — tout est détruit à la fin. Les invites non fiables tournent ainsi sans risque."
    >
      <Stack spacing={2}>
        {error && !draft ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="success">{notice}</Alert> : null}
        {profiles === null ? (
          <Typography variant="body2" color="textSecondary">
            Chargement…
          </Typography>
        ) : (
          <>
            <Stack spacing={1.5}>
              {[...builtins, ...customs].map(renderCard)}
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                disabled={busy || draft !== null}
                onClick={() => openEditor(null)}
              >
                Nouveau profil
              </Button>
            </Stack>
            <Typography variant="caption" color="textSecondary">
              Lancez un fil bac à sable depuis le composeur (menu « Bac à
              sable ») ou depuis l'agent avec ob-thread start --sandbox PROFIL.
            </Typography>
          </>
        )}
      </Stack>

      <AccessibleDialog
        open={draft !== null}
        fullWidth
        scroll="paper"
        aria-labelledby={titleId}
        slotProps={{ paper: { sx: { maxWidth: 900, minWidth: "45%" } } }}
        onClose={requestClose}
      >
        {draft ? (
          <SandboxProfileForm
            draft={draft}
            draftId={draftId}
            viewOnly={draftBuiltin}
            titleId={titleId}
            error={error}
            busy={busy}
            catalog={catalog}
            onClose={requestClose}
            onPatch={patchProfile}
            onSave={() => void save()}
          />
        ) : null}
      </AccessibleDialog>
    </ConfigSection>
  )
}

function SandboxProfileForm({
  draft,
  draftId,
  viewOnly,
  titleId,
  error,
  busy,
  catalog,
  onClose,
  onPatch,
  onSave,
}: {
  draft: SandboxProfile
  draftId: string | null
  viewOnly: boolean
  titleId: string
  error: string
  busy: boolean
  catalog: Catalog | null
  onClose: () => void
  onPatch: (patch: Partial<SandboxProfile>) => void
  onSave: () => void
}) {
  const [listError, setListError] = useState("")
  const [skillFilter, setSkillFilter] = useState("")
  const [manualSkill, setManualSkill] = useState("")
  const [mcpFilter, setMcpFilter] = useState("")
  const [manualMcp, setManualMcp] = useState("")

  const modelChoice = sandboxModelChoice(draft.model)
  const brokered = modelChoice === "broker"
  const brokeredValue =
    isBrokeredModelRef(draft.model) ? (draft.model ?? "") : ""

  function toggleSkill(name: string) {
    if (draft.skills.includes(name))
      onPatch({ skills: draft.skills.filter((item) => item !== name) })
    else if (draft.skills.length >= SANDBOX_EDIT_CAPS.skillsMax)
      setListError(`Compétences : max ${SANDBOX_EDIT_CAPS.skillsMax}`)
    else {
      setListError("")
      onPatch({ skills: [...draft.skills, name] })
    }
  }

  function toggleSkillsGroup(names: string[], select: boolean) {
    if (!select) {
      onPatch({ skills: draft.skills.filter((name) => !names.includes(name)) })
      return
    }
    const adding = names.filter((name) => !draft.skills.includes(name))
    const room = SANDBOX_EDIT_CAPS.skillsMax - draft.skills.length
    if (adding.length > room) {
      setListError(`Compétences : max ${SANDBOX_EDIT_CAPS.skillsMax}`)
      return
    }
    setListError("")
    onPatch({ skills: [...draft.skills, ...adding] })
  }

  function toggleMcp(name: string) {
    if (draft.mcp.includes(name))
      onPatch({ mcp: draft.mcp.filter((item) => item !== name) })
    else if (draft.mcp.length >= SANDBOX_EDIT_CAPS.mcpMax)
      setListError(`Serveurs MCP : max ${SANDBOX_EDIT_CAPS.mcpMax}`)
    else {
      setListError("")
      onPatch({ mcp: [...draft.mcp, name] })
    }
  }

  function toggleMcpGroup(names: string[], select: boolean) {
    if (!select) {
      onPatch({ mcp: draft.mcp.filter((name) => !names.includes(name)) })
      return
    }
    const adding = names.filter((name) => !draft.mcp.includes(name))
    const room = SANDBOX_EDIT_CAPS.mcpMax - draft.mcp.length
    if (adding.length > room) {
      setListError(`Serveurs MCP : max ${SANDBOX_EDIT_CAPS.mcpMax}`)
      return
    }
    setListError("")
    onPatch({ mcp: [...draft.mcp, ...adding] })
  }

  function addManual(kind: "skills" | "mcp") {
    const raw =
      kind === "skills" ? manualSkill.trim() : manualMcp.trim()
    if (!raw) return
    const name = raw.toLowerCase()
    if (kind === "skills") {
      setManualSkill("")
      toggleSkill(name)
    } else {
      setManualMcp("")
      toggleMcp(name)
    }
  }

  const canSave =
    !busy &&
    !viewOnly &&
    draft.name.trim().length > 0 &&
    draft.name.trim().length <= SANDBOX_EDIT_CAPS.nameMax &&
    (!brokered || /^[a-z0-9._-]+\/\S+$/.test(brokeredValue.trim().toLowerCase()))

  return (
    <>
      <DialogTitle id={titleId}>
        {viewOnly
          ? `Profil intégré « ${draft.name} »`
          : draftId
            ? "Modifier le profil"
            : "Nouveau profil de bac à sable"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {viewOnly ? (
            <Alert severity="info">
              Les profils intégrés se lisent seulement — « Nouveau profil »
              part de zéro pour en adapter un.
            </Alert>
          ) : null}
          <TextField
            label={`Nom (max ${SANDBOX_EDIT_CAPS.nameMax})`}
            value={draft.name}
            placeholder="recherche-non-fiable"
            disabled={busy || viewOnly}
            onChange={(event) => onPatch({ name: event.currentTarget.value })}
          />
          <Select
            name="sandbox-model"
            label="Modèle"
            value={modelChoice}
            disabled={busy || viewOnly}
            onSelect={(value) => {
              if (value === "chat" || value === "small") onPatch({ model: value })
              else onPatch({ model: "" })
            }}
          >
            <option value="chat">Modèle de l'instance (chat)</option>
            <option value="small">Modèle de l'instance (small)</option>
            <option value="broker">Clé du coffre (fournisseur/modèle)</option>
          </Select>
          {brokered ? (
            <TextField
              label="Fournisseur/modèle"
              value={brokeredValue}
              placeholder="xai/grok-4.5"
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({ model: event.currentTarget.value })
              }
            />
          ) : null}
          <Typography variant="caption" color="textSecondary">
            {brokered
              ? "Le plan de contrôle appelle le fournisseur avec votre clé du coffre — la clé n'entre jamais dans le conteneur. Fournisseurs : openai, xai, openrouter, google."
              : "Le fil tourne sur le modèle de conversation de l'instance."}
          </Typography>
          <TextField
            label={`Consigne du profil (max ${SANDBOX_EDIT_CAPS.instructionMax})`}
            value={draft.instruction}
            multiline
            rows={4}
            placeholder="Examine les fichiers copiés et résume sans exécuter de code."
            disabled={busy || viewOnly}
            onChange={(event) =>
              onPatch({ instruction: event.currentTarget.value })
            }
          />
          <ScopePicker
            sectionTitle="Compétences autorisées"
            caption="Seules les compétences listées sont copiées dans le conteneur. Vide = aucune."
            filterLabel="Chercher une compétence"
            allChip="Toutes"
            emptyBase="Aucune compétence (bac à sable minimal)"
            noMatch="Aucune compétence ne correspond."
            loading="Chargement des compétences…"
            manualLabel="Ajouter par nom"
            manualPlaceholder="research"
            manualError={listError}
            entries={catalog?.skills ?? []}
            dirs={catalog?.skillDirs ?? []}
            max={SANDBOX_EDIT_CAPS.skillsMax}
            baseLocked={null}
            selected={draft.skills}
            catalogLoading={catalog === null}
            catalogFailed={catalog?.failed || !catalog?.live}
            filter={skillFilter}
            manual={manualSkill}
            lockedTitle=""
            onFilter={setSkillFilter}
            onManual={setManualSkill}
            onManualAdd={() => addManual("skills")}
            onToggle={toggleSkill}
            onToggleGroup={toggleSkillsGroup}
            onClearAll={() => onPatch({ skills: [] })}
          />
          <ScopePicker
            sectionTitle="Serveurs MCP autorisés"
            caption="Seuls les serveurs listés tournent dans le conteneur. Un serveur distant exige le réseau."
            filterLabel="Chercher un serveur"
            allChip="Tous"
            emptyBase="Aucun serveur MCP"
            noMatch="Aucun serveur ne correspond."
            loading="Chargement des serveurs…"
            manualLabel="Ajouter par nom"
            manualPlaceholder="stock"
            manualError={listError}
            entries={catalog?.mcp ?? []}
            dirs={catalog?.mcpDirs ?? []}
            max={SANDBOX_EDIT_CAPS.mcpMax}
            baseLocked={null}
            selected={draft.mcp}
            catalogLoading={catalog === null}
            catalogFailed={catalog?.failed || !catalog?.live}
            filter={mcpFilter}
            manual={manualMcp}
            lockedTitle=""
            onFilter={setMcpFilter}
            onManual={setManualMcp}
            onManualAdd={() => addManual("mcp")}
            onToggle={toggleMcp}
            onToggleGroup={toggleMcpGroup}
            onClearAll={() => onPatch({ mcp: [] })}
          />
          <Stack spacing={1}>
            <Typography variant="subtitle2">Outils intégrés</Typography>
            {SANDBOX_TOOL_LABELS.map((tool) => (
              <Stack
                key={tool.key}
                direction="row"
                spacing={2}
                alignItems="center"
                justifyContent="space-between"
              >
                <Box>
                  <Typography variant="body2">{tool.label}</Typography>
                  <Typography variant="caption" color="textSecondary">
                    {tool.hint}
                  </Typography>
                </Box>
                <Switch
                  checked={draft.tools[tool.key]}
                  disabled={busy || tool.key === "task" || viewOnly}
                  onChange={(event) =>
                    onPatch({
                      tools: {
                        ...draft.tools,
                        [tool.key]: event.currentTarget.checked,
                      },
                    })
                  }
                />
              </Stack>
            ))}
          </Stack>
          <Select
            name="sandbox-network"
            label="Réseau"
            value={draft.network}
            disabled={busy || viewOnly}
            onSelect={(value) =>
              onPatch({ network: value === "on" ? "on" : "off" })
            }
          >
            <option value="off">Hors ligne (réseau interne uniquement)</option>
            <option value="on">Internet autorisé</option>
          </Select>
          {draft.network === "on" ? (
            <Alert severity="warning">
              Réseau ouvert : l'invite non fiable peut joindre Internet (et en
              extraire des données). Un serveur MCP distant l'exige.
            </Alert>
          ) : null}
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="body2">
                Secrets MCP dans le conteneur
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Copie les en-têtes et clés des serveurs MCP dans le bac à sable.
              </Typography>
            </Box>
            <Switch
              checked={draft.mcpSecrets}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({ mcpSecrets: event.currentTarget.checked })
              }
            />
          </Stack>
          {draft.mcpSecrets ? (
            <Alert severity="warning">
              Tout secret présent dans le conteneur est lisible par l'invite non
              fiable — n'activez que pour des serveurs sans valeur sensible.
            </Alert>
          ) : null}
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            <TextField
              label="Durée de vie (min)"
              type="number"
              value={draft.ttlMinutes}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({ ttlMinutes: Number(event.currentTarget.value) || 0 })
              }
            />
            <TextField
              label="Inactivité avant arrêt (min)"
              type="number"
              value={draft.idleMinutes}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({ idleMinutes: Number(event.currentTarget.value) || 0 })
              }
            />
          </Stack>
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            <TextField
              label="Mémoire (Mo)"
              type="number"
              value={draft.limits.memoryMb}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({
                  limits: {
                    ...draft.limits,
                    memoryMb: Number(event.currentTarget.value) || 0,
                  },
                })
              }
            />
            <TextField
              label="CPU (cœurs)"
              type="number"
              value={draft.limits.cpus}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({
                  limits: {
                    ...draft.limits,
                    cpus: Number(event.currentTarget.value) || 0,
                  },
                })
              }
            />
            <TextField
              label="Processus max"
              type="number"
              value={draft.limits.pids}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({
                  limits: {
                    ...draft.limits,
                    pids: Number(event.currentTarget.value) || 0,
                  },
                })
              }
            />
            <TextField
              label="Étapes max"
              type="number"
              value={draft.limits.steps}
              disabled={busy || viewOnly}
              onChange={(event) =>
                onPatch({
                  limits: {
                    ...draft.limits,
                    steps: Number(event.currentTarget.value) || 0,
                  },
                })
              }
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" disabled={busy} onClick={onClose}>
          {viewOnly ? "Fermer" : "Annuler"}
        </Button>
        {viewOnly ? null : (
          <Button disabled={!canSave} onClick={onSave}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
