export async function sh(args: string[], input?: string, timeoutMs?: number) {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : "pipe",
  })
  let timedOut = false
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          try {
            proc.kill(9)
          } catch {
            // already gone
          }
        }, timeoutMs)
      : null
  try {
    if (input !== undefined && proc.stdin) {
      proc.stdin.write(input)
      await proc.stdin.end()
    }
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (timedOut) {
      throw new Error(`${args[0]} timed out after ${timeoutMs}ms`)
    }
    return { code, stdout, stderr }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function docker(
  args: string[],
  input?: string,
  timeoutMs?: number,
) {
  const result = await sh(["docker", ...args], input, timeoutMs)
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `docker ${args[0]} failed`,
    )
  }
  return result.stdout
}
