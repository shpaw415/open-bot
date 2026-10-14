#!/usr/bin/env bun
// Copies Bun + Node + React type declarations next to the Monaco bundle so the
// IDE's TypeScript worker can resolve node:/bun/react imports and globals.
// Mirrors monaco.sh: `bun scripts/ide-types.ts <target-dir>` (public for dev, dist for build).
import { readdir, readFile, rm } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"

const D_TS = /\.(d\.mts|d\.cts|d\.ts)$/
const SKIP_DIRS = new Set(["node_modules", "docs"])

const scriptDir = dirname(Bun.main)
const repoRoot = resolve(scriptDir, "../../..")
const target = resolve(scriptDir, "..", process.argv[2] ?? "public")
const outDir = join(target, "monaco", "types")

const storeDir = join(repoRoot, "node_modules", ".bun")

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number)
  const pb = b.split(/[.+-]/).map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function packageDir(name: string, from: string): string {
  try {
    return dirname(Bun.resolveSync(name, from))
  } catch {
    const key = name.startsWith("@")
      ? `${name.split("/")[0]}+${name.split("/")[1]}`
      : name
    const matches = [
      ...new Bun.Glob(`${key}@*/node_modules/${name}`).scanSync({
        cwd: storeDir,
        onlyFiles: false,
      }),
    ]
    const best = matches
      .map((match) => {
        const version = basename(match).slice(
          key.length + 1,
          match.indexOf("/node_modules/"),
        )
        return { path: join(storeDir, match), version }
      })
      .sort((a, b) => compareVersions(b.version, a.version))[0]
    if (!best) {
      throw new Error(`cannot resolve ${name} from ${from} or the bun store`)
    }
    return best.path
  }
}

async function walkDts(root: string, dir = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await walkDts(root, join(dir, entry.name))))
    } else if (D_TS.test(entry.name)) {
      files.push(relative(root, join(dir, entry.name)).replaceAll("\\", "/"))
    }
  }
  return files
}

let bunTypesDir: string
try {
  bunTypesDir = packageDir(
    "bun-types",
    join(repoRoot, "node_modules", "@types", "bun"),
  )
} catch {
  console.error(
    "ide-types: cannot resolve bun-types — run `bun install` at the repo root first",
  )
  process.exit(1)
}
const bunStoreNodeModules = dirname(bunTypesDir)
const nodeTypesDir = packageDir("@types/node", bunStoreNodeModules)
const reactTypesDir = packageDir("@types/react", bunStoreNodeModules)

const packages = [
  { dir: "bun-types", root: bunTypesDir },
  { dir: "@types/node", root: nodeTypesDir },
  { dir: "@types/react", root: reactTypesDir },
].map((pkg) => ({ ...pkg, files: [] as string[] }))

const hasher = new Bun.CryptoHasher("sha256")
for (const pkg of packages) {
  pkg.files = (await walkDts(pkg.root)).sort()
  for (const file of pkg.files) {
    hasher.update(`${pkg.dir}/${file}`)
    hasher.update(await readFile(join(pkg.root, file)))
  }
}
const hash = hasher.digest("hex")

const manifestPath = join(outDir, "manifest.json")
const manifestFile = Bun.file(manifestPath)
if (await manifestFile.exists()) {
  const existing = await manifestFile.json()
  if (existing?.hash === hash) {
    console.log("ide-types: unchanged")
    process.exit(0)
  }
}

await rm(outDir, { recursive: true, force: true })
let count = 0
for (const pkg of packages) {
  for (const file of pkg.files) {
    await Bun.write(join(outDir, pkg.dir, file), Bun.file(join(pkg.root, file)))
    count++
  }
}
await Bun.write(manifestPath, JSON.stringify({ hash, packages }))
console.log(`ide-types: ${count} files → ${relative(repoRoot, outDir)}`)
