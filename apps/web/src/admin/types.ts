import type { UsageDay } from "../usage-charts"

export type DesktopPhase = "starting" | "running" | "sleeping"

export type AdminUser = {
  id: string
  email: string
  role: "admin" | "user"
  disabled: boolean
  createdAt: number
  mustChangePassword: boolean
  lastActiveAt: number | null
  desktop: DesktopPhase
}

export type Invite = {
  code: string
  email: string | null
  createdAt: number
  usedAt: number | null
}

export type UsageBody = {
  days: number
  totals: { totalTokens: number; calls: number }
  daily: UsageDay[]
}

export type DayWindow = 7 | 30 | 90
