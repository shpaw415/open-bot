export async function sh(args: string[], input?: string) {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : "pipe",
  })
  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input)
    await proc.stdin.end()
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

export async function docker(args: string[], input?: string) {
  const result = await sh(["docker", ...args], input)
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `docker ${args[0]} failed`,
    )
  }
  return result.stdout
}
