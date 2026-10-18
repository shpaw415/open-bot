import { describe, expect, test } from "bun:test"

/**
 * logo-mark.png distribution contract.
 *
 * The header renders /logo-mark.png; the old build copied only favicon.ico,
 * logo.png, manifest.webmanifest and icons/ — the mark 404'd on every built
 * instance (complete=true, naturalWidth=0). These checks cover the asset
 * itself (a real, decodable PNG with alpha, sharp enough for the 30px
 * header render on retina) and the build's copy list; when a dist/ output
 * exists, the distributed copy must pass the identical integrity walk.
 */

const HEADER_RENDER_PX = 30
const MIN_DIMENSION = HEADER_RENDER_PX * 2 // 2x density floor

type PngInfo = {
  width: number
  height: number
  bitDepth: number
  colorType: number
  hasAlpha: boolean
}

/**
 * Full PNG chunk walk with CRC verification — proves the encoded stream is
 * intact end to end (a truncated or re-labeled file fails), not merely that
 * a magic number matches.
 */
function inspectPng(buffer: ArrayBuffer): PngInfo {
  const bytes = new Uint8Array(buffer)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) expect(bytes[i]).toBe(signature[i])

  const view = new DataView(buffer)
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (slice: Uint8Array) => {
    let c = 0xffffffff
    for (const byte of slice) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  let offset = 8
  let info: PngInfo | null = null
  let sawEnd = false
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    expect(dataEnd + 4).toBeLessThanOrEqual(bytes.length)
    const crc = view.getUint32(dataEnd)
    expect(crc32(bytes.slice(offset + 4, dataEnd))).toBe(crc)
    if (type === "IHDR") {
      info = {
        width: view.getUint32(dataStart),
        height: view.getUint32(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        hasAlpha: bytes[dataStart + 9] === 4 || bytes[dataStart + 9] === 6,
      }
    }
    if (type === "IEND") {
      sawEnd = true
      break
    }
    offset = dataEnd + 4
  }
  expect(sawEnd).toBe(true)
  if (!info) throw new Error("PNG has no IHDR chunk")
  return info
}

function expectAssetIntact(buffer: ArrayBuffer) {
  const info = inspectPng(buffer)
  expect(info.width).toBeGreaterThanOrEqual(MIN_DIMENSION)
  expect(info.height).toBeGreaterThanOrEqual(MIN_DIMENSION)
  expect(info.hasAlpha).toBe(true)
  // Square: the mark is a centered glyph on a transparent canvas.
  expect(info.width).toBe(info.height)
}

describe("logo-mark.png distribution", () => {
  test("the source asset is a real, decodable, alpha PNG at 2x density", async () => {
    const file = Bun.file(new URL("../public/logo-mark.png", import.meta.url))
    expect(await file.exists()).toBe(true)
    expectAssetIntact(await file.arrayBuffer())
  })
})

test("the web build copies the mark into dist", async () => {
  const pkg = JSON.parse(
    await Bun.file(new URL("../package.json", import.meta.url)).text(),
  )
  const build: string = pkg.scripts.build
  expect(build).toContain("public/logo-mark.png")
  // ...and lands it next to the other root assets, not inside icons/.
  expect(build).toMatch(
    /cp public\/favicon\.ico public\/logo\.png public\/logo-mark\.png public\/manifest\.webmanifest dist\//,
  )
})

test("a built dist/ serves the same intact asset", async () => {
  const dist = new URL("../dist/logo-mark.png", import.meta.url)
  const file = Bun.file(dist)
  if (!(await file.exists())) return // no build output on this checkout
  expectAssetIntact(await file.arrayBuffer())
})
