import Alert from "@shpaw415/mui-lite/Alert"
import Button from "@shpaw415/mui-lite/Button"
import IconButton from "@shpaw415/mui-lite/IconButton"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import TextField from "@shpaw415/mui-lite/TextField"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useState } from "react"
import { api, type Me } from "./api"
import { DarkModeIcon, LightModeIcon, LoginIcon, PersonAddIcon } from "./icons"
import { useThemeMode } from "./theme"

function ThemeToggle() {
  const { mode, toggle } = useThemeMode()
  return (
    <Stack direction="row" justifyContent="flex-end" sx={{ mb: -1 }}>
      <ToolTip title={mode === "dark" ? "Light mode" : "Dark mode"}>
        <IconButton
          size="small"
          aria-label={
            mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          onClick={toggle}
        >
          {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </ToolTip>
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
      <Stack spacing={2}>
        <ThemeToggle />
        <Stack spacing={0.5}>
          <Typography variant="h5">Set login</Typography>
          <Typography variant="body2" color="textSecondary">
            The default password is still in use. Choose the email and password
            to store.
          </Typography>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          label="Email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.currentTarget.value)}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Enter") void submit()
          }}
        />
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !email || !password}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </Stack>
    </Centered>
  )
}

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("admin@localhost")
  const [password, setPassword] = useState("changeme")
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
      setError(caught instanceof Error ? caught.message : "login failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
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
          <Typography variant="h5">open-bot</Typography>
          <Typography variant="body2" color="textSecondary">
            Self-hosted OpenCode desktops per user.
          </Typography>
        </Stack>
        <Tabs
          value={mode}
          onChange={(_event, value) => {
            setMode(String(value) as "login" | "register")
            setError("")
          }}
        >
          <Tab label="Log in" value="login" icon={<LoginIcon />} />
          <Tab label="Register" value="register" icon={<PersonAddIcon />} />
        </Tabs>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          label="Email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {mode === "register" ? (
          <TextField
            label="Invite code"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === "Enter") void submit()
            }}
          />
        ) : null}
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !email || !password}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Enter") void submit()
          }}
        >
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Log in"
              : "Create account"}
        </Button>
        {mode === "login" ? (
          <Typography variant="caption" color="textSecondary">
            Default first login is admin@localhost / changeme — you will be
            asked to change it.
          </Typography>
        ) : (
          <Typography variant="caption" color="textSecondary">
            Ask an admin for an invite code (Admin → Create invite).
          </Typography>
        )}
      </Stack>
    </Centered>
  )
}
