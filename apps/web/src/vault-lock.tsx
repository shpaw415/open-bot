import Button from "@shpaw415/mui-lite/Button"
import { useEffect, useState } from "react"

export type VaultKeySource = "setup" | "vault" | null | undefined

// When the vault supplies the credentials the account/key inputs stay locked
// (they would otherwise shadow the vault with garbage); an explicit Override
// click unlocks them until the next load. Reset whenever the source changes,
// which also covers the initial fetch.
export function useVaultOverride(keySource: VaultKeySource) {
  const [override, setOverride] = useState(false)
  useEffect(() => {
    if (keySource === "vault") return
    setOverride(false)
  }, [keySource])
  return {
    locked: keySource === "vault" && !override,
    override: () => setOverride(true),
  }
}

export function VaultOverrideButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="text" onClick={onClick}>
      Override
    </Button>
  )
}
