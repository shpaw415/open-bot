import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto"

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 32).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const next = scryptSync(password, salt, 32)
  const prev = Buffer.from(hash, "hex")
  if (next.length !== prev.length) return false
  return timingSafeEqual(next, prev)
}

export function randomToken() {
  return randomBytes(32).toString("hex")
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
