export type System1Auth = {
  endpoint: string
  apiKey: string
  gatewayToken: string
  model: string
  provider?: string
}

export type DecisionImage = {
  content_type: "image/jpeg"
  base64: string
}

export const DECISION_TIMEOUT_MS = 8000
export const VISION_TIMEOUT_MS = 20000

const VISION_PROVIDERS = new Set(["cloudflare-clef", "selfhosted-clef"])

export function providerHasVision(provider: string | undefined) {
  return VISION_PROVIDERS.has(provider ?? "")
}

export function decisionHeaders(auth: System1Auth) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (auth.apiKey) headers.authorization = `Bearer ${auth.apiKey}`
  if (auth.gatewayToken) {
    headers["cf-aig-authorization"] = `Bearer ${auth.gatewayToken}`
  }
  return headers
}

export function decisionBody(
  auth: System1Auth,
  state: string,
  questions: Record<string, unknown>,
  images?: DecisionImage[],
) {
  const body: Record<string, unknown> = { state, questions }
  if (auth.model.trim()) body.model = auth.model.trim()
  const shots = (images ?? []).filter((item) => item.base64).slice(0, 4)
  if (shots.length > 0) body.images = shots
  return body
}

export function annotateQuestions<
  T extends Record<string, { instructions: string }>,
>(questions: T): T {
  const operation = questions.operation
  if (!operation) return questions
  return {
    ...questions,
    operation: {
      ...operation,
      instructions: `${operation.instructions} Badge numbers on the attached image are the control indexes.`,
    },
  }
}
