export function manualPackages(extendedStates: string) {
  const names: string[] = []
  let pkg = ""
  let auto = ""
  const flush = () => {
    if (pkg && auto === "0") names.push(pkg)
    pkg = ""
    auto = ""
  }
  for (const line of `${extendedStates}\n`.split("\n")) {
    if (line.startsWith("Package: ")) {
      pkg = line.slice("Package: ".length).trim()
    } else if (line.startsWith("Auto-Installed: ")) {
      auto = line.slice("Auto-Installed: ".length).trim()
    } else if (line.trim() === "") {
      flush()
    }
  }
  return [...new Set(names)].sort()
}
