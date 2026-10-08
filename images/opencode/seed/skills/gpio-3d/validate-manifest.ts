#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export const MODEL_MANIFEST = "manifest.json"
export const MODEL_UNITS = "mm"
export const MODEL_TOOL = "trimesh"
export const MODEL_FITS = [
  "custom",
  "companion-header",
  "arduino-uno",
  "arduino-nano",
  "arduino-mega",
] as const

const PART_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.glb$/
const PART_COLOR = /^#[0-9a-f]{6}$/
const PART_KEYS = ["name", "file", "units", "fits", "color"] as const
const MANIFEST_KEYS = ["version", "units", "tool", "parts"] as const

export type ModelFit = (typeof MODEL_FITS)[number]

export type ModelPart = {
  name: string
  file: string
  units: typeof MODEL_UNITS
  fits: ModelFit[]
  color?: string
}

export type ModelManifest = {
  version: 1
  units: typeof MODEL_UNITS
  tool: typeof MODEL_TOOL
  parts: ModelPart[]
}

export class ModelManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModelManifestError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function rejectUnknown(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ModelManifestError(`${label} has unknown field ${key}`)
    }
  }
}

function parseFits(value: unknown, index: number): ModelFit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ModelManifestError(`parts[${index}].fits must list a board`)
  }
  const fits: ModelFit[] = []
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !MODEL_FITS.includes(item as ModelFit) ||
      fits.includes(item as ModelFit)
    ) {
      throw new ModelManifestError(
        `parts[${index}].fits must be custom, companion-header, arduino-uno, arduino-nano, or arduino-mega`,
      )
    }
    fits.push(item as ModelFit)
  }
  return fits
}

export function parseModelManifest(input: unknown): ModelManifest {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input) as unknown
    } catch {
      throw new ModelManifestError("manifest is not valid JSON")
    }
  }
  if (!isRecord(input)) {
    throw new ModelManifestError("manifest must be an object")
  }
  rejectUnknown(input, MANIFEST_KEYS, "manifest")
  if (input.version !== 1) {
    throw new ModelManifestError("manifest version must be 1")
  }
  if (input.units !== MODEL_UNITS) {
    throw new ModelManifestError("manifest units must be mm")
  }
  if (input.tool !== MODEL_TOOL) {
    throw new ModelManifestError("manifest tool must be trimesh")
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    throw new ModelManifestError("manifest needs parts")
  }
  const names = new Set<string>()
  const files = new Set<string>()
  const parts = input.parts.map((part, index) => {
    if (!isRecord(part)) {
      throw new ModelManifestError(`parts[${index}] must be an object`)
    }
    rejectUnknown(part, PART_KEYS, `parts[${index}]`)
    if (typeof part.name !== "string" || part.name.trim() !== part.name) {
      throw new ModelManifestError(`parts[${index}].name must be a string`)
    }
    if (
      part.name.length === 0 ||
      part.name.length > 80 ||
      /[\n\r\\/]/.test(part.name)
    ) {
      throw new ModelManifestError(`parts[${index}].name must be a single line`)
    }
    if (names.has(part.name)) {
      throw new ModelManifestError(`duplicate part name ${part.name}`)
    }
    names.add(part.name)
    if (typeof part.file !== "string" || !PART_FILE.test(part.file)) {
      throw new ModelManifestError(
        `parts[${index}].file must be one kebab-case .glb`,
      )
    }
    if (files.has(part.file)) {
      throw new ModelManifestError(`duplicate part file ${part.file}`)
    }
    files.add(part.file)
    if (part.units !== MODEL_UNITS) {
      throw new ModelManifestError(`parts[${index}].units must be mm`)
    }
    const parsed: ModelPart = {
      name: part.name,
      file: part.file,
      units: MODEL_UNITS,
      fits: parseFits(part.fits, index),
    }
    if (part.color != null) {
      if (typeof part.color !== "string" || !PART_COLOR.test(part.color)) {
        throw new ModelManifestError(
          `parts[${index}].color must be a #rrggbb hex color`,
        )
      }
      parsed.color = part.color
    }
    return parsed
  })
  return {
    version: 1,
    units: MODEL_UNITS,
    tool: MODEL_TOOL,
    parts,
  }
}

function assertGlb(bytes: Uint8Array, file: string): void {
  if (bytes.byteLength < 20) {
    throw new ModelManifestError(`${file} is not a glb`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0,
  )
  if (magic !== "glTF") {
    throw new ModelManifestError(`${file} is not a glb`)
  }
  if (
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw new ModelManifestError(`${file} is not a glTF 2 glb`)
  }
  const chunkLength = view.getUint32(12, true)
  const chunkType = String.fromCharCode(
    bytes[16] ?? 0,
    bytes[17] ?? 0,
    bytes[18] ?? 0,
    bytes[19] ?? 0,
  )
  if (chunkType !== "JSON" || 20 + chunkLength > bytes.byteLength) {
    throw new ModelManifestError(`${file} is missing a glTF JSON chunk`)
  }
  let doc: unknown
  try {
    doc = JSON.parse(
      new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)),
    ) as unknown
  } catch {
    throw new ModelManifestError(`${file} JSON chunk is not JSON`)
  }
  if (!isRecord(doc) || !Array.isArray(doc.meshes) || doc.meshes.length !== 1) {
    throw new ModelManifestError(`${file} must contain one mesh`)
  }
}

function assertStl(bytes: Uint8Array, file: string): void {
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(80, true)
    if (count > 0 && bytes.byteLength === 84 + count * 50) {
      return
    }
  }
  const text = new TextDecoder().decode(bytes)
  if (
    /^solid\s/i.test(text) &&
    /facet\s+normal/i.test(text) &&
    /endsolid/i.test(text)
  ) {
    return
  }
  throw new ModelManifestError(`${file} is not an STL`)
}

function readBytes(dir: string, file: string): Uint8Array {
  const path = join(dir, file)
  let info: ReturnType<typeof statSync>
  try {
    info = statSync(path)
  } catch {
    throw new ModelManifestError(`missing ${file}`)
  }
  if (!info.isFile()) {
    throw new ModelManifestError(`${file} is not a file`)
  }
  return new Uint8Array(readFileSync(path))
}

export function validateModelDir(dir: string): ModelManifest {
  const manifest = parseModelManifest(
    readFileSync(join(dir, MODEL_MANIFEST), "utf8"),
  )
  const expected = new Set<string>([MODEL_MANIFEST])
  for (const part of manifest.parts) {
    const stl = part.file.replace(/\.glb$/, ".stl")
    expected.add(part.file)
    expected.add(stl)
    assertGlb(readBytes(dir, part.file), part.file)
    assertStl(readBytes(dir, stl), stl)
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    throw new ModelManifestError("model directory is missing")
  }
  for (const entry of entries) {
    if (!expected.has(entry)) {
      throw new ModelManifestError(`unexpected file ${entry}`)
    }
  }
  for (const file of expected) {
    if (!entries.includes(file)) {
      throw new ModelManifestError(`missing ${file}`)
    }
  }
  return manifest
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (!dir) {
    console.error("usage: validate-manifest.ts <model-dir>")
    process.exit(1)
  }
  try {
    const manifest = validateModelDir(dir)
    console.log(`ok ${manifest.parts.length}`)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    console.error(message)
    process.exit(1)
  }
}
