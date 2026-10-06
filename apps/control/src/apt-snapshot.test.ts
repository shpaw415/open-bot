import { expect, test } from "bun:test"
import { manualPackages } from "./apt-snapshot"

test("keeps manually installed packages", () => {
  const text = [
    "Package: vim",
    "Architecture: amd64",
    "Auto-Installed: 0",
    "",
    "Package: libfoo",
    "Architecture: amd64",
    "Auto-Installed: 1",
    "",
    "Package: curl",
    "Auto-Installed: 0",
  ].join("\n")
  expect(manualPackages(text)).toEqual(["curl", "vim"])
})
