import Alert from "@shpaw415/mui-lite/Alert"
import AppBar from "@shpaw415/mui-lite/AppBar"
import BottomNavigation, {
  BottomNavigationAction,
} from "@shpaw415/mui-lite/BottomNavigation"
import Box from "@shpaw415/mui-lite/Box"
import Button from "@shpaw415/mui-lite/Button"
import Chip from "@shpaw415/mui-lite/Chip"
import IconButton from "@shpaw415/mui-lite/IconButton"
import { CircularProgress } from "@shpaw415/mui-lite/Progress"
import Stack from "@shpaw415/mui-lite/Stack"
import Tabs, { Tab } from "@shpaw415/mui-lite/Tabs"
import Toolbar from "@shpaw415/mui-lite/Toolbar"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import { useCallback, useEffect, useState } from "react"
import { Admin } from "./Admin"
import { AgentNotices, NoticeBell } from "./AgentNotices"
import { api, type Me } from "./api"
import { Config } from "./Config"
import { useMobile } from "./hooks"
import {
  AdminPanelSettingsIcon,
  DarkModeIcon,
  DashboardIcon,
  ExtensionIcon,
  LightModeIcon,
  LogoutIcon,
  SettingsIcon,
  VpnKeyIcon,
} from "./icons"
import { Login, SetCredentials } from "./Login"
import { openNotifiedThread, setNoticeFocus } from "./notify"
import { Plugins } from "./Plugins"
import { Providers } from "./Providers"
import { PluginTabView, pluginTabs, useInstalledPlugins } from "./plugin-tabs"
import { ResetApprovals } from "./ResetApprovals"
import { useThemeMode } from "./theme"
import { Workspace } from "./Workspace"

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [path, setPath] = useState(
    typeof location !== "undefined" ? location.pathname : "/",
  )
  const mobile = useMobile()
  const { mode, toggle } = useThemeMode()
  const { plugins } = useInstalledPlugins()

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const go = useCallback((next: string) => {
    history.pushState({}, "", next)
    setPath(next)
  }, [])

  const openReply = useCallback(
    (sessionId: string) => {
      openNotifiedThread(sessionId)
      go("/")
    },
    [go],
  )

  useEffect(() => {
    setNoticeFocus({ path })
  }, [path])

  if (!ready) {
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{ height: "100dvh" }}
      >
        <CircularProgress />
      </Stack>
    )
  }
  if (!me) return <Login onLogin={setMe} />
  if (me.mustChangePassword) return <SetCredentials me={me} onSaved={setMe} />

  const tabs = pluginTabs(plugins)
  const pluginTab = tabs.find((tab) => tab.key === path.slice(1))
  const section = path.startsWith("/admin")
    ? "admin"
    : path.startsWith("/providers")
      ? "providers"
      : path.startsWith("/config")
        ? "config"
        : path.startsWith("/plugins")
          ? "plugins"
          : pluginTab
            ? `plugin:${pluginTab.key}`
            : "workspace"
  const goSection = (value: string) =>
    go(
      value === "admin"
        ? "/admin"
        : value === "providers"
          ? "/providers"
          : value === "config"
            ? "/config"
            : value === "plugins"
              ? "/plugins"
              : value.startsWith("plugin:")
                ? `/${value.slice("plugin:".length)}`
                : "/",
    )

  return (
    <Box className="ob-shell">
      <AppBar position="static" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ mr: 2, whiteSpace: "nowrap" }}>
            open-bot
          </Typography>
          {mobile ? null : (
            <Tabs
              value={section}
              variant="scrollable"
              onChange={(_event, value) => goSection(String(value))}
              sx={{ flex: 1, minWidth: 0 }}
            >
              <Tab
                label="Workspace"
                value="workspace"
                icon={<DashboardIcon />}
              />
              <Tab label="Providers" value="providers" icon={<VpnKeyIcon />} />
              <Tab label="Config" value="config" icon={<SettingsIcon />} />
              <Tab label="Plugins" value="plugins" icon={<ExtensionIcon />} />
              {tabs.map((tab) => (
                <Tab
                  key={tab.key}
                  label={tab.title}
                  value={`plugin:${tab.key}`}
                />
              ))}
              {me.role === "admin" ? (
                <Tab
                  label="Admin"
                  value="admin"
                  icon={<AdminPanelSettingsIcon />}
                />
              ) : null}
            </Tabs>
          )}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ ml: mobile ? "auto" : 1 }}
          >
            {me.role === "admin" ? (
              <Chip size="small" color="primary">
                admin
              </Chip>
            ) : null}
            <Typography
              variant="caption"
              className="ob-hide-mobile"
              sx={{
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {me.email}
            </Typography>
            <NoticeBell />
            <ToolTip title={mode === "dark" ? "Light mode" : "Dark mode"}>
              <IconButton
                size="small"
                aria-label={
                  mode === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
                onClick={toggle}
              >
                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </ToolTip>
            <ToolTip title="Log out">
              <Button
                size="small"
                variant="text"
                startIcon={<LogoutIcon />}
                onClick={() => {
                  void api("/api/auth/logout", { method: "POST" }).then(() =>
                    setMe(null),
                  )
                }}
              >
                Log out
              </Button>
            </ToolTip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box className="ob-content">
        {section === "admin" ? (
          me.role === "admin" ? (
            <Admin meId={me.id} />
          ) : (
            <Box className="ob-scroll" sx={{ p: 2 }}>
              <Alert severity="error">Admin only</Alert>
            </Box>
          )
        ) : section === "providers" ? (
          <Providers />
        ) : section === "plugins" ? (
          <Plugins isAdmin={me.role === "admin"} />
        ) : pluginTab ? (
          <PluginTabView tab={pluginTab} />
        ) : section === "config" ? (
          <Config
            me={me}
            onChanged={() => {
              void api<Me>("/api/me")
                .then(setMe)
                .catch(() => {})
            }}
          />
        ) : (
          <Workspace me={me} />
        )}
      </Box>

      <AgentNotices onOpen={openReply} />

      <ResetApprovals />

      {mobile ? (
        <BottomNavigation
          value={section}
          onChange={(_event, value) => goSection(String(value))}
          showLabels
        >
          <BottomNavigationAction
            label="Workspace"
            value="workspace"
            icon={<DashboardIcon />}
          />
          <BottomNavigationAction
            label="Providers"
            value="providers"
            icon={<VpnKeyIcon />}
          />
          <BottomNavigationAction
            label="Config"
            value="config"
            icon={<SettingsIcon />}
          />
          <BottomNavigationAction
            label="Plugins"
            value="plugins"
            icon={<ExtensionIcon />}
          />
          {tabs.length > 0 ? (
            <BottomNavigationAction
              label={tabs[0]?.title ?? ""}
              value={`plugin:${tabs[0]?.key ?? ""}`}
            />
          ) : null}
          {me.role === "admin" ? (
            <BottomNavigationAction
              label="Admin"
              value="admin"
              icon={<AdminPanelSettingsIcon />}
            />
          ) : null}
        </BottomNavigation>
      ) : null}
    </Box>
  )
}
