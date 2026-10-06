export type ChartTheme = {
  text: string
  split: string
}

export const seriesPalette = [
  "#6750a4",
  "#006a6a",
  "#7d5260",
  "#0061a4",
  "#6b5e00",
  "#984061",
  "#386a20",
  "#8b5000",
]

export type KindTotals = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
}

export type UsageDay = {
  day: string
  users: {
    userId: string
    email: string
    byKind: Record<string, KindTotals>
  }[]
}

const kinds = ["chat", "small", "embed", "vlm"] as const

function axis(theme: ChartTheme) {
  return {
    axisLabel: { color: theme.text },
    axisLine: { lineStyle: { color: theme.split } },
    splitLine: { lineStyle: { color: theme.split } },
  }
}

function userTotals(daily: UsageDay[]) {
  const totals = new Map<string, number>()
  for (const point of daily) {
    for (const user of point.users) {
      const tokens = Object.values(user.byKind).reduce(
        (sum, kind) => sum + kind.totalTokens,
        0,
      )
      totals.set(user.email, (totals.get(user.email) ?? 0) + tokens)
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])
}

export function fleetOption(daily: UsageDay[], theme: ChartTheme) {
  const ranked = userTotals(daily)
  const top = ranked.slice(0, 7).map(([email]) => email)
  const names = ranked.length > 7 ? [...top, "Other"] : top
  const labels = daily.map((point) => point.day.slice(5))
  const series =
    names.length === 0
      ? [
          {
            name: "tokens",
            type: "line",
            data: labels.map(() => 0),
            showSymbol: false,
          },
        ]
      : names.map((name) => ({
          name,
          type: "line",
          stack: "tokens",
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.35 },
          data: daily.map((point) => {
            if (name === "Other") {
              return point.users
                .filter((user) => !top.includes(user.email))
                .reduce(
                  (sum, user) =>
                    sum +
                    Object.values(user.byKind).reduce(
                      (inner, kind) => inner + kind.totalTokens,
                      0,
                    ),
                  0,
                )
            }
            const user = point.users.find((row) => row.email === name)
            if (!user) return 0
            return Object.values(user.byKind).reduce(
              (sum, kind) => sum + kind.totalTokens,
              0,
            )
          }),
        }))
  return {
    color: seriesPalette,
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis" },
    legend: { type: "scroll", textStyle: { color: theme.text }, top: 0 },
    grid: { left: 52, right: 12, top: 36, bottom: 28 },
    xAxis: { type: "category", data: labels, ...axis(theme) },
    yAxis: { type: "value", ...axis(theme) },
    series,
  }
}

export function kindAreaOption(
  daily: UsageDay[],
  userId: string,
  theme: ChartTheme,
) {
  const labels = daily.map((point) => point.day.slice(5))
  return {
    color: seriesPalette,
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: theme.text }, top: 0 },
    grid: { left: 52, right: 12, top: 36, bottom: 28 },
    xAxis: { type: "category", data: labels, ...axis(theme) },
    yAxis: { type: "value", ...axis(theme) },
    series: kinds.map((kind) => ({
      name: kind,
      type: "line",
      stack: "kind",
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.35 },
      data: daily.map((point) => {
        const user = point.users.find((row) => row.userId === userId)
        return user?.byKind[kind]?.totalTokens ?? 0
      }),
    })),
  }
}

export function kindBarOption(
  daily: UsageDay[],
  userId: string,
  theme: ChartTheme,
) {
  const sums = Object.fromEntries(
    kinds.map((kind) => [kind, { promptTokens: 0, completionTokens: 0 }]),
  ) as Record<string, { promptTokens: number; completionTokens: number }>
  for (const point of daily) {
    const user = point.users.find((row) => row.userId === userId)
    if (!user) continue
    for (const kind of kinds) {
      const slot = sums[kind]
      if (!slot) continue
      slot.promptTokens += user.byKind[kind]?.promptTokens ?? 0
      slot.completionTokens += user.byKind[kind]?.completionTokens ?? 0
    }
  }
  return {
    color: ["#6750a4", "#006a6a"],
    textStyle: { color: theme.text, fontSize: 12 },
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: theme.text }, top: 0 },
    grid: { left: 64, right: 12, top: 36, bottom: 28 },
    xAxis: { type: "value", ...axis(theme) },
    yAxis: { type: "category", data: [...kinds], ...axis(theme) },
    series: [
      {
        name: "prompt",
        type: "bar",
        data: kinds.map((kind) => sums[kind]?.promptTokens ?? 0),
      },
      {
        name: "completion",
        type: "bar",
        data: kinds.map((kind) => sums[kind]?.completionTokens ?? 0),
      },
    ],
  }
}

export function tokensFor(daily: UsageDay[], userId: string) {
  let total = 0
  let calls = 0
  for (const point of daily) {
    const user = point.users.find((row) => row.userId === userId)
    if (!user) continue
    for (const kind of Object.values(user.byKind)) {
      total += kind.totalTokens
      calls += kind.calls
    }
  }
  return { total, calls }
}
