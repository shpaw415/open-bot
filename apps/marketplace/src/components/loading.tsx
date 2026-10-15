import { Spinner } from "./ui"

export default function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center bg-[#FAFAF7] py-20 text-[#1A2333]">
      <Spinner size="size-8" label="Loading plugins…" />
    </div>
  )
}
