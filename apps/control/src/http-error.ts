export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = "HttpError"
  }
}

export function httpErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    )
  }
  const message = error instanceof Error ? error.message : "request failed"
  return Response.json({ error: message, code: "internal" }, { status: 500 })
}
