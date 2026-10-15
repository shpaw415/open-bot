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
  console.error(error)
  return Response.json(
    { error: "request failed", code: "internal" },
    { status: 500 },
  )
}
