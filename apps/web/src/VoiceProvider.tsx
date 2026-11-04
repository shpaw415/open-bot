import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import Divider from "@shpaw415/mui-lite/Divider"
import Select from "@shpaw415/mui-lite/Select"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useState } from "react"
import { api, isTeamLockedError } from "./api"
import { ConfigSection } from "./ConfigSection"
import { MicIcon } from "./icons"
import Stack from "./stack"
import { useTeamMode } from "./team"
import { useVaultOverride, VaultOverrideButton } from "./vault-lock"
import {
  defaultVoiceFor,
  hasField,
  modelFor,
  specFor,
  type VoiceKind,
  type VoiceSpec,
  voicesFor,
} from "./voice-catalog"

type SideState = {
  provider: string
  // The provider as loaded/saved — a blank key only keeps the saved one
  // while the selected provider is still this one.
  savedProvider: string
  accountId: string
  apiKey: string
  model: string
  voice: string
  voiceCustom: boolean
  hasKey: boolean
  keySource: "setup" | "vault" | null
}

const LANGUAGES: [string, string][] = [
  ["auto", "Auto (STT only)"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
]

const emptySide: SideState = {
  provider: "",
  savedProvider: "",
  accountId: "",
  apiKey: "",
  model: "",
  voice: "",
  voiceCustom: false,
  hasKey: false,
  keySource: null,
}

const CUSTOM_VOICE = "__custom__"

type VoiceForm = {
  providers: VoiceSpec[]
  stt: {
    provider: string
    accountId: string
    model: string
    hasKey: boolean
    keySource?: "setup" | "vault" | null
  }
  tts: {
    provider: string
    accountId: string
    model: string
    voice: string
    hasKey: boolean
    keySource?: "setup" | "vault" | null
  }
  language: string
}

// Keep the current voice when the newly selected model still offers it,
// otherwise fall back to that model's default (the server does the same).
function voiceForModel(
  spec: VoiceSpec | undefined,
  modelId: string,
  current: string,
): string {
  const voices = voicesFor(spec, modelId)
  if (!voices) return ""
  if (
    current &&
    (voices.allowCustom || voices.options.some((voice) => voice.id === current))
  ) {
    return current
  }
  return defaultVoiceFor(spec, modelId)
}

// A selected provider cannot be saved until everything it requires is
// present (a saved or vault key counts for the secret).
function missingRequired(
  state: SideState,
  spec: VoiceSpec | undefined,
  locked: boolean,
): boolean {
  if (!spec) return false
  if (
    spec.models.length > 0 &&
    state.model !== "" &&
    !modelFor(spec, state.model)
  ) {
    return true
  }
  for (const field of spec.fields) {
    if (!field.required || locked) continue
    if (field.key === "accountId" && state.accountId.trim() === "") return true
    if (
      field.key === "apiKey" &&
      state.apiKey.trim() === "" &&
      !(state.hasKey && state.provider === state.savedProvider) &&
      state.keySource !== "vault"
    ) {
      return true
    }
  }
  return false
}

function loadedSide(
  providers: VoiceSpec[],
  kind: VoiceKind,
  side: VoiceForm["stt"] | VoiceForm["tts"] | undefined,
): SideState {
  const provider = side?.provider ?? ""
  const spec = specFor(providers, kind, provider)
  const model = side?.model ?? ""
  const voice =
    side && "voice" in side && typeof side.voice === "string" ? side.voice : ""
  const voices = spec ? voicesFor(spec, model) : undefined
  return {
    ...emptySide,
    provider,
    savedProvider: provider,
    accountId: side?.accountId ?? "",
    model,
    voice,
    voiceCustom: Boolean(
      voices?.allowCustom &&
        voice &&
        !voices.options.some((item) => item.id === voice),
    ),
    hasKey: Boolean(side?.hasKey),
    keySource: side?.keySource ?? null,
  }
}

export function VoiceProvider() {
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<VoiceSpec[]>([])
  const [stt, setStt] = useState<SideState>(emptySide)
  const [tts, setTts] = useState<SideState>(emptySide)
  const [language, setLanguage] = useState("auto")
  const sttVault = useVaultOverride(stt.keySource)
  const ttsVault = useVaultOverride(tts.keySource)
  const team = useTeamMode()
  const shared = team.mode === "team"

  const sttSpec = specFor(providers, "stt", stt.provider)
  const ttsSpec = specFor(providers, "tts", tts.provider)
  const sttLocked = sttVault.locked
  const ttsLocked = ttsVault.locked

  useEffect(() => {
    void api<VoiceForm>("/api/voice")
      .then((body) => {
        const catalog = body.providers ?? []
        setProviders(catalog)
        setStt(loadedSide(catalog, "stt", body.stt))
        setTts(loadedSide(catalog, "tts", body.tts))
        setLanguage(body.language || "auto")
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "failed")
      })
  }, [])

  function pickProvider(
    kind: VoiceKind,
    id: string,
    state: SideState,
    set: (next: SideState) => void,
  ) {
    const spec = specFor(providers, kind, id)
    set({
      ...state,
      provider: id,
      model: spec?.defaultModel ?? "",
      voice: spec ? defaultVoiceFor(spec, spec.defaultModel) : "",
      voiceCustom: false,
      accountId: hasField(spec, "accountId") ? state.accountId : "",
    })
    setSaved("")
  }

  function pickModel(
    kind: VoiceKind,
    id: string,
    state: SideState,
    set: (next: SideState) => void,
  ) {
    const spec = specFor(providers, kind, state.provider)
    const voices = voicesFor(spec, id)
    set({
      ...state,
      model: id,
      voice: voiceForModel(spec, id, state.voice),
      voiceCustom: Boolean(voices?.allowCustom && state.voiceCustom),
    })
    setSaved("")
  }

  async function save() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      const body = await api<{
        sttKeySource?: "setup" | "vault" | null
        ttsKeySource?: "setup" | "vault" | null
      }>("/api/voice", {
        method: "PUT",
        body: JSON.stringify(
          shared
            ? { tts: { voice: tts.voice }, language }
            : {
                stt: {
                  provider: stt.provider,
                  accountId: hasField(sttSpec, "accountId")
                    ? stt.accountId
                    : "",
                  apiKey: stt.apiKey,
                  model: sttSpec?.models.length ? stt.model : "",
                },
                tts: {
                  provider: tts.provider,
                  accountId: hasField(ttsSpec, "accountId")
                    ? tts.accountId
                    : "",
                  apiKey: tts.apiKey,
                  model: ttsSpec?.models.length ? tts.model : "",
                  voice: tts.voice,
                },
                language,
              },
        ),
      })
      setStt({
        ...stt,
        apiKey: "",
        savedProvider: stt.provider,
        hasKey: shared ? stt.hasKey : Boolean(stt.provider),
        keySource: body.sttKeySource ?? null,
      })
      setTts({
        ...tts,
        apiKey: "",
        savedProvider: tts.provider,
        hasKey: shared ? tts.hasKey : Boolean(tts.provider),
        keySource: body.ttsKeySource ?? null,
      })
      setSaved("Saved. Voice works right away.")
    } catch (caught) {
      setError(
        isTeamLockedError(caught)
          ? "Managed by your admin — the team's shared voice providers changed since this page loaded."
          : caught instanceof Error
            ? caught.message
            : "save failed",
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError("")
    setSaved("")
    setBusy(true)
    try {
      await api("/api/voice", { method: "DELETE" })
      setStt(emptySide)
      setTts(emptySide)
      setLanguage("auto")
      setSaved("Removed.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "remove failed")
    } finally {
      setBusy(false)
    }
  }

  const anyKey = stt.hasKey || tts.hasKey
  const status = anyKey
    ? {
        label: [
          stt.hasKey || stt.keySource ? "STT" : null,
          tts.hasKey || tts.keySource ? "TTS" : null,
        ]
          .filter(Boolean)
          .join(" + "),
        color: "success" as const,
      }
    : stt.keySource === "vault" || tts.keySource === "vault"
      ? { label: "Vault key", color: "primary" as const }
      : { label: "Not set" }
  const incomplete =
    !shared &&
    (missingRequired(stt, sttSpec, sttLocked) ||
      missingRequired(tts, ttsSpec, ttsLocked))

  const sideProps = (
    kind: VoiceKind,
    state: SideState,
    set: (next: SideState) => void,
    spec: VoiceSpec | undefined,
    locked: boolean,
    onOverride: () => void,
  ) => ({
    kind,
    providers,
    state,
    set,
    spec,
    locked,
    onOverride,
    shared,
    onPickProvider: (id: string) => pickProvider(kind, id, state, set),
    onPickModel: (id: string) => pickModel(kind, id, state, set),
    clearSaved: () => setSaved(""),
  })

  return (
    <ConfigSection
      icon={<MicIcon />}
      title="Voice"
      description="Speech to text for the composer microphone and the voice that reads answers out loud in your browser. Pick a provider per side — only the fields, models and voices that provider takes are shown. Cloudflare and xAI reuse their vault key when no key is typed here."
      status={status}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {saved ? <Alert severity="success">{saved}</Alert> : null}
        {shared ? (
          <Alert severity="info">
            Managed by your admin — the team's shared speech providers apply to
            everyone. Your voice and language stay yours.
          </Alert>
        ) : null}
        <Typography variant="subtitle2">Speech to text (microphone)</Typography>
        <VoiceSide
          {...sideProps(
            "stt",
            stt,
            setStt,
            sttSpec,
            sttLocked,
            sttVault.override,
          )}
        />
        <Divider />
        <Typography variant="subtitle2">Text to speech (read aloud)</Typography>
        <VoiceSide
          {...sideProps(
            "tts",
            tts,
            setTts,
            ttsSpec,
            ttsLocked,
            ttsVault.override,
          )}
        />
        <Select
          name="voice-language"
          label="Language"
          value={language}
          onSelect={(value) => {
            setLanguage(value)
            setSaved("")
          }}
        >
          {LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={busy || incomplete || (!stt.provider && !tts.provider)}
            onClick={() => void save()}
          >
            Save voice
          </Button>
          {shared ? null : anyKey || stt.provider || tts.provider ? (
            <Button
              variant="text"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </ConfigSection>
  )
}

type VoiceSideProps = {
  kind: VoiceKind
  providers: VoiceSpec[]
  state: SideState
  set: (next: SideState) => void
  spec: VoiceSpec | undefined
  locked: boolean
  onOverride: () => void
  shared: boolean
  onPickProvider: (id: string) => void
  onPickModel: (id: string) => void
  clearSaved: () => void
}

// One STT or TTS side: the provider select, then exactly the credential
// fields, model select and voice select the chosen provider defines.
function VoiceSide({
  kind,
  providers,
  state,
  set,
  spec,
  locked,
  onOverride,
  shared,
  onPickProvider,
  onPickModel,
  clearSaved,
}: VoiceSideProps) {
  const voices = kind === "tts" ? voicesFor(spec, state.model) : undefined
  const keyKept = state.hasKey && state.provider === state.savedProvider
  const modelKnown =
    !spec || state.model === "" || Boolean(modelFor(spec, state.model))
  return (
    <>
      <Select
        name={`${kind}-provider`}
        label={`${kind.toUpperCase()} provider`}
        value={state.provider}
        disabled={providers.length === 0 || shared}
        onSelect={onPickProvider}
      >
        {[
          <option key="none" value="">
            Not set
          </option>,
          ...providers
            .filter((item) => item.kind === kind)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            )),
        ]}
      </Select>
      {spec ? (
        <>
          {spec.fields.map((field) =>
            field.key === "accountId" ? (
              <TextField
                key={field.key}
                label={locked ? `${field.label} (from vault)` : field.label}
                value={state.accountId}
                placeholder={field.placeholder}
                helpText={field.hint}
                disabled={locked || shared}
                onChange={(event) => {
                  set({ ...state, accountId: event.currentTarget.value })
                  clearSaved()
                }}
              />
            ) : (
              <Stack
                key={field.key}
                direction="row"
                spacing={1}
                alignItems="center"
              >
                <TextField
                  label={
                    locked
                      ? "Using the vault key"
                      : keyKept
                        ? `${field.label} (blank keeps the saved key)`
                        : field.label
                  }
                  type={locked ? undefined : "password"}
                  value={locked ? "" : state.apiKey}
                  placeholder={locked ? "••••••••" : field.placeholder}
                  disabled={locked || shared}
                  sx={{ flex: 1 }}
                  onChange={(event) => {
                    set({ ...state, apiKey: event.currentTarget.value })
                    clearSaved()
                  }}
                />
                {locked ? <VaultOverrideButton onClick={onOverride} /> : null}
              </Stack>
            ),
          )}
          {spec.models.length > 0 ? (
            <Select
              name={`${kind}-model`}
              label={`${kind.toUpperCase()} model`}
              value={state.model}
              disabled={shared}
              onSelect={onPickModel}
            >
              {[
                ...(modelKnown
                  ? []
                  : [
                      <option key={state.model} value={state.model}>
                        {`${state.model} (unsupported — pick a listed model)`}
                      </option>,
                    ]),
                ...spec.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                )),
              ]}
            </Select>
          ) : null}
          {voices ? (
            <>
              <Select
                name={`${kind}-voice`}
                label="Voice"
                value={state.voiceCustom ? CUSTOM_VOICE : state.voice}
                onSelect={(id) => {
                  if (id === CUSTOM_VOICE) {
                    set({ ...state, voiceCustom: true })
                  } else {
                    set({ ...state, voice: id, voiceCustom: false })
                  }
                  clearSaved()
                }}
              >
                {[
                  ...voices.options.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  )),
                  ...(voices.allowCustom
                    ? [
                        <option key={CUSTOM_VOICE} value={CUSTOM_VOICE}>
                          Custom voice ID…
                        </option>,
                      ]
                    : []),
                ]}
              </Select>
              {voices.allowCustom && state.voiceCustom ? (
                <TextField
                  label="Custom voice ID"
                  value={state.voice}
                  placeholder="Cloned voice id"
                  onChange={(event) => {
                    set({ ...state, voice: event.currentTarget.value })
                    clearSaved()
                  }}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}
