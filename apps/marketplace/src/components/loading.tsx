import { Spinner } from "./ui"

export default function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center bg-[#05070A] py-20 text-[#EDF2F7]">
      <Spinner size="size-8" label="Loading marketplace…" />
    </div>
  )
}
