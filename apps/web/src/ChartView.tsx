import Box from "@shpaw415/mui-lite/Box"
import { useEffect, useRef } from "react"

export function ChartView({
  option,
  height,
}: {
  option: object
  height: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const signature = JSON.stringify(option)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dead = false
    let chart: {
      dispose: () => void
      resize: () => void
      setOption: (value: unknown, notMerge?: boolean) => void
    } | null = null
    const observer = new ResizeObserver(() => chart?.resize())
    observer.observe(el)
    void import("echarts").then((ec) => {
      if (dead) return
      chart = ec.init(el)
      chart.setOption(JSON.parse(signature), true)
    })
    return () => {
      dead = true
      observer.disconnect()
      chart?.dispose()
    }
  }, [signature])
  return <Box ref={ref} sx={{ width: "100%", height }} />
}
