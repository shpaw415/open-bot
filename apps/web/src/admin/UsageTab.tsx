import Box from "@shpaw415/mui-lite/Box"
import Paper from "@shpaw415/mui-lite/Paper"
import Select from "@shpaw415/mui-lite/Select"
import Skeleton from "@shpaw415/mui-lite/Skeleton"
import Typography from "@shpaw415/mui-lite/Typography"
import { useEffect, useRef, useState } from "react"
import { ChartView } from "../ChartView"
import { useMobile } from "../hooks"
import Stack from "../stack"
import {
  type ChartTheme,
  fleetOption,
  kindAreaOption,
  kindBarOption,
  type UsageDay,
} from "../usage-charts"
import type { AdminUser, UsageBody } from "./types"

export function UsageTab({
  users,
  daily,
  loading,
  usage,
  selectedId,
  onSelect,
}: {
  users: AdminUser[]
  daily: UsageDay[]
  loading: boolean
  usage: UsageBody | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const mobile = useMobile()
  const themeRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<ChartTheme>({
    text: "#1c1b1f",
    split: "rgba(127,127,127,0.28)",
  })

  useEffect(() => {
    const el = themeRef.current
    if (!el) return
    const color = getComputedStyle(el).color
    if (color) setTheme({ text: color, split: "rgba(127,127,127,0.28)" })
  }, [])

  const selectedUser = users.find((row) => row.id === selectedId) ?? null

  return (
    <Box ref={themeRef}>
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle1">Proxy tokens by user</Typography>
          <Typography variant="caption" color="textSecondary">
            OpenBot LLM proxy only. Provider logins inside a desktop are not
            included. History starts when this page ships.
          </Typography>
          {loading && !usage ? (
            <Skeleton height={260} />
          ) : (
            <ChartView option={fleetOption(daily, theme)} height={260} />
          )}
          <Select
            name="admin-usage-user"
            label="User"
            value={selectedId ?? ""}
            sx={{ mt: 1, width: "100%", maxWidth: 360 }}
            onSelect={(value: string) => onSelect(value)}
          >
            {users.length === 0 ? (
              <option value="">No users</option>
            ) : (
              users.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.email}
                </option>
              ))
            )}
          </Select>
        </Paper>
        <Stack direction={mobile ? "column" : "row"} spacing={1.5}>
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1.4, minWidth: 0 }}>
            <Typography variant="subtitle1">
              {selectedUser ? selectedUser.email : "User"} by kind
            </Typography>
            {selectedId ? (
              <ChartView
                option={kindAreaOption(daily, selectedId, theme)}
                height={240}
              />
            ) : (
              <Typography variant="body2" color="textSecondary">
                Select a user.
              </Typography>
            )}
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1">Prompt vs completion</Typography>
            {selectedId ? (
              <ChartView
                option={kindBarOption(daily, selectedId, theme)}
                height={240}
              />
            ) : null}
          </Paper>
        </Stack>
      </Stack>
    </Box>
  )
}
