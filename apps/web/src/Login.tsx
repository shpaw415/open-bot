import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import TextField from "@shpaw415/mui-lite/TextField"
import Typography from "@shpaw415/mui-lite/Typography"
import { useState } from "react"
import { api, type Me } from "./api"
import { DarkModeIcon, LightModeIcon, LoginIcon, PersonAddIcon } from "./icons"
import Stack from "./stack"
import { Tip } from "./Tip"
import { useThemeMode } from "./theme"

function ThemeToggle() {
  const { mode, toggle } = useThemeMode()
  return (
    <Stack direction="row" justifyContent="flex-end" sx={{ mb: -1 }}>
      <Tip title={mode === "dark" ? "Light mode" : "Dark mode"}>
        <IconButton
          size="small"
          aria-label={
            mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          onClick={toggle}
        >
          {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tip>
    </Stack>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{ minHeight: "100dvh", overflow: "auto", p: 2 }}
    >
      <Paper
        elevation={2}
        sx={{ p: 3, width: "100%", maxWidth: 400, my: "auto" }}
      >
        {children}
      </Paper>
    </Stack>
  )
}

export function SetCredentials({
  me,
  onSaved,
}: {
  me: Me
  onSaved: (me: Me) => void
}) {
  const [email, setEmail] = useState(me.email)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError("")
    if (password !== confirm) {
      setError("passwords do not match")
      return
    }
    setBusy(true)
    try {
      onSaved(
        await api<Me>("/api/auth/credentials", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "could not save credentials",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Stack spacing={2}>
          <ThemeToggle />
          <Stack spacing={0.5}>
            <Typography variant="h5" component="h1">
              Définir la connexion
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Le mot de passe par défaut est encore actif. Choisissez le
              courriel et le mot de passe à conserver.
            </Typography>
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Courriel"
            value={email}
            type="email"
            name="email"
            autoComplete="email"
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <TextField
            label="Mot de passe"
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <TextField
            label="Confirmer le mot de passe"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
          />
          <Button
            variant="contained"
            type="submit"
            disabled={busy || !email || !password}
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </Stack>
      </form>
    </Centered>
  )
}

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login")
  // Empty by default: the pre-filled admin/bootstrap credentials read like
  // server setup instructions and blocked password managers.
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError("")
    setBusy(true)
    try {
      const me =
        mode === "login"
          ? await api<Me>("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            })
          : await api<Me>("/api/auth/register", {
              method: "POST",
              body: JSON.stringify({ email, password, code }),
            })
      onLogin(me)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "connexion impossible",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      {/* A real form: Enter submits, password managers fill correctly. */}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Stack spacing={2}>
          <ThemeToggle />
          <Stack spacing={0.5}>
            <img
              src="/logo.png"
              alt=""
              width={58}
              height={58}
              style={{
                marginLeft: "auto",
                marginRight: "auto",
                scale: 2.3,
              }}
            />
            <Typography variant="h5" component="h1">
              open-bot
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Votre assistant pour déléguer des tâches : conversations,
              fichiers, applications et automatisations.
            </Typography>
          </Stack>
          <Tabs
            value={mode}
            onChange={(_event, value) => {
              setMode(String(value) as "login" | "register")
              setError("")
            }}
          >
            <Tab label="Connexion" value="login" icon={<LoginIcon />} />
            <Tab
              label="Créer un compte"
              value="register"
              icon={<PersonAddIcon />}
            />
          </Tabs>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <TextField
            label="Courriel"
            value={email}
            type="email"
            name="email"
            autoComplete="email"
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <TextField
            label="Mot de passe"
            value={password}
            type="password"
            name="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {mode === "register" ? (
            <TextField
              label="Code d’invitation"
              value={code}
              name="invitation"
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          ) : null}
          <Button
            variant="contained"
            type="submit"
            disabled={busy || !email || !password}
          >
            {busy
              ? "Un instant…"
              : mode === "login"
                ? "Se connecter"
                : "Créer le compte"}
          </Button>
          {mode === "login" ? (
            <Typography variant="caption" color="textSecondary">
              Mot de passe oublié? Contactez l’administrateur de votre instance
              Open-bot.
            </Typography>
          ) : (
            <Typography variant="caption" color="textSecondary">
              Demandez un code d’invitation à l’administrateur de votre
              instance.
            </Typography>
          )}
          <details>
            <summary
              style={{
                cursor: "pointer",
                fontSize: 12,
                color: "var(--ob-muted, #888)",
              }}
            >
              Première installation (administrateur)
            </summary>
            <Typography variant="caption" color="textSecondary" component="div">
              Le compte administrateur initial est admin@localhost; son mot de
              passe figure dans le journal du plan de contrôle et doit être
              changé à la première connexion.
            </Typography>
          </details>
        </Stack>
      </form>
    </Centered>
  )
}
