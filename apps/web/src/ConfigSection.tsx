import Box from "@shpaw415/mui-lite/Box"
import Chip from "@shpaw415/mui-lite/Chip"
import Divider from "@shpaw415/mui-lite/Divider"
import Paper from "@shpaw415/mui-lite/Paper"
import Stack from "@shpaw415/mui-lite/Stack"
import Typography from "@shpaw415/mui-lite/Typography"
import type { ReactNode } from "react"

export type ConfigStatus = {
  label: string
  color?: "primary" | "secondary" | "success" | "warning" | "error"
}

export function ConfigSection({
  icon,
  title,
  description,
  status,
  children,
}: {
  icon?: ReactNode
  title: string
  description?: string
  status?: ConfigStatus | null
  children: ReactNode
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        {icon ? (
          <Box
            sx={{
              display: "flex",
              flexShrink: 0,
              mt: 0.25,
              color: "textSecondary",
            }}
          >
            {icon}
          </Box>
        ) : null}
        <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.25}>
          <Typography variant="subtitle1" sx={{ lineHeight: 1.3 }}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" color="textSecondary">
              {description}
            </Typography>
          ) : null}
        </Stack>
        {status ? (
          status.color ? (
            <Chip
              size="small"
              color={status.color}
              sx={{ flexShrink: 0, mt: 0.25 }}
            >
              {status.label}
            </Chip>
          ) : (
            <Chip size="small" sx={{ flexShrink: 0, mt: 0.25 }}>
              {status.label}
            </Chip>
          )
        ) : null}
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      {children}
    </Paper>
  )
}
