import Avatar from "@shpaw415/mui-lite/Avatar"
import Box from "@shpaw415/mui-lite/Box"
import Chip from "@shpaw415/mui-lite/Chip"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import ToolTip from "@shpaw415/mui-lite/ToolTip"
import Typography from "@shpaw415/mui-lite/Typography"
import type { ReactNode, RefObject } from "react"
import { ExtensionIcon } from "./icons"

export type PluginOriginInfo = { id: string; name: string }

// Filled tonal chip attributing an item to the plugin that installed it.
// The only filled-tonal chip in the product; functional chips stay outlined.
export function PluginBadge({
  plugin,
  maxWidth = 160,
}: {
  plugin: PluginOriginInfo
  maxWidth?: number
}) {
  return (
    <ToolTip title={`Installed by ${plugin.name}`}>
      <Chip
        size="small"
        icon={
          <ExtensionIcon
            width={14}
            height={14}
            style={{ marginLeft: "8px", flexShrink: 0 }}
          />
        }
        sx={{
          height: 24,
          maxWidth,
          borderRadius: "8px",
          bgcolor: "rgba(var(--bg-secondary), 0.18)",
          color: "var(--text-secondary)",
          "& .MUI_Chip_Content": {
            padding: 0,
            paddingRight: "8px",
            fontSize: "0.6875rem",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        }}
      >
        {plugin.name}
      </Chip>
    </ToolTip>
  )
}

// Shared card for the Personas and Skills tabs: avatar + title line (with the
// plugin badge) + two-line description + right-hand actions. Plugin-owned rows
// get a 3px secondary accent bar; every row shares one hover treatment.
export function ConfigItemCard({
  avatar,
  title,
  badge,
  description,
  actions,
  pluginOwned,
}: {
  avatar: ReactNode
  title: string
  badge?: ReactNode
  description: string
  actions?: ReactNode
  pluginOwned?: boolean
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "12px",
        p: { xs: 1.5, sm: 2 },
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "rgba(var(--text-main), 0.04)" },
      }}
    >
      {pluginOwned ? (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 12,
            bottom: 12,
            width: 3,
            borderRadius: "2px",
            bgcolor: "var(--bg-secondary)",
          }}
        />
      ) : null}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="flex-start"
        sx={{ flexWrap: "wrap", rowGap: 1 }}
      >
        {avatar}
        <Stack sx={{ flex: 1, minWidth: "80px" }} spacing={0}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexWrap: "wrap", rowGap: 0.5 }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </Typography>
            {badge}
          </Stack>
          <Typography
            variant="body2"
            color="textSecondary"
            sx={{
              mt: 0.5,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {description}
          </Typography>
        </Stack>
        {actions ? (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ pt: "2px", "@media (max-width:400px)": { flexBasis: "100%", justifyContent: "flex-end", pt: 1 } }}
          >
            {actions}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )
}

const avatarSx = {
  width: 40,
  height: 40,
  fontSize: 16,
  fontWeight: 500,
  flexShrink: 0,
} as const

export function ItemAvatar({
  children,
  tone,
  ...props
}: {
  children: ReactNode
  tone: "primary" | "secondary" | "muted"
} & { ref?: RefObject<HTMLDivElement | null> }) {
  const palette =
    tone === "primary"
      ? { bgcolor: "rgba(var(--bg-primary), 0.18)", color: "var(--text-primary)" }
      : tone === "secondary"
        ? { bgcolor: "rgba(var(--bg-secondary), 0.18)", color: "var(--text-secondary)" }
        : {
            bgcolor: "rgba(var(--text-main), 0.08)",
            color: "rgba(var(--text-main), 0.6)",
          }
  return (
    <Avatar sx={{ ...avatarSx, ...palette }} {...props}>{children}</Avatar>
  )
}

// Loading placeholder matching ConfigItemCard geometry. No spinners in lists.
export function GhostCards({ count = 3 }: { count?: number }) {
  return (
    <>
      <Box sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Loading items
      </Box>
      {Array.from({ length: count }, (_, index) => (
        <Paper key={index} variant="outlined" sx={{ borderRadius: "12px", p: { xs: 1.5, sm: 2 } }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box sx={{ ...avatarSx, borderRadius: "50%", bgcolor: "rgba(var(--text-main), 0.08)", animation: "ob-pulse 1.6s ease-in-out infinite" }} />
            <Box sx={{ flex: 1, pt: 0.5 }}>
              <Box sx={{ height: 14, width: "40%", borderRadius: "4px", bgcolor: "rgba(var(--text-main), 0.08)", animation: "ob-pulse 1.6s ease-in-out infinite" }} />
              <Box sx={{ height: 12, width: "70%", borderRadius: "4px", bgcolor: "rgba(var(--text-main), 0.08)", mt: 1, animation: "ob-pulse 1.6s ease-in-out infinite" }} />
            </Box>
          </Stack>
        </Paper>
      ))}
    </>
  )
}

export function EmptyState({
  icon,
  title,
  subtext,
}: {
  icon: ReactNode
  title: string
  subtext: string
}) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ textAlign: "center", py: 4, px: 2 }}>
      <Avatar sx={{ width: 48, height: 48, bgcolor: "rgba(var(--text-main), 0.08)", color: "rgba(var(--text-main), 0.6)" }}>
        {icon}
      </Avatar>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2" color="textSecondary">
        {subtext}
      </Typography>
    </Stack>
  )
}
