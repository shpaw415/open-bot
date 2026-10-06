import { sha256 } from "./passwords"

export const vikingAccountId = "desktop"
export const vikingUserId = "agent"

function encodeSegment(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

export function vikingUserKey(rootKey: string) {
  const secret = sha256(`${vikingUserId}\0${rootKey}`)
  return [
    encodeSegment(vikingAccountId),
    encodeSegment(vikingUserId),
    encodeSegment(secret),
  ].join(".")
}

async function issuedKey(response: Response) {
  const body = await response.json().catch(() => null)
  if (!body || typeof body !== "object") return ""
  const result =
    "result" in body && body.result && typeof body.result === "object"
      ? body.result
      : body
  if (!("user_key" in result)) return ""
  return typeof result.user_key === "string" ? result.user_key : ""
}

export async function ensureVikingUser(baseUrl: string, rootKey: string) {
  const response = await fetch(`${baseUrl}/api/v1/admin/accounts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": rootKey,
    },
    body: JSON.stringify({
      account_id: vikingAccountId,
      admin_user_id: vikingUserId,
      seed: rootKey,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (response.status === 409) return
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(
      `OpenViking user bootstrap failed (${response.status}${detail ? `: ${detail}` : ""})`,
    )
  }
  const issued = await issuedKey(response)
  const expected = vikingUserKey(rootKey)
  if (issued && issued !== expected) {
    throw new Error(
      "OpenViking issued a user key that does not match the seeded derivation",
    )
  }
}
