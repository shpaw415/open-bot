export type System1Auth = {
  endpoint: string
  apiKey: string
  gatewayToken: string
  model: string
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
) {
  const body: Record<string, unknown> = { state, questions }
  if (auth.model.trim()) body.model = auth.model.trim()
  return body
}
