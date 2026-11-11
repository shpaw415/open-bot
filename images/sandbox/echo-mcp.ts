#!/usr/bin/env bun
// Minimal stdio MCP server used by the sandbox escape battery
// (scripts/bench-sandbox.sh): proves an allowlisted *local* MCP server
// runs inside the jail with network off. Newline-delimited JSON-RPC.

type Rpc = {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
}

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(rpc: Rpc) {
  const { id, method } = rpc
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof rpc.params?.protocolVersion === "string"
              ? rpc.params.protocolVersion
              : "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "echo", version: "1.0.0" },
        },
      })
      return
    case "notifications/initialized":
    case "notifications/cancelled":
      return
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} })
      return
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo the given text back, prefixed.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        },
      })
      return
    case "tools/call": {
      const args = (rpc.params?.arguments ?? {}) as { text?: unknown }
      const text = typeof args.text === "string" ? args.text : ""
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `echo: ${text}` }] },
      })
      return
    }
    default:
      if (id !== undefined)
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method}` },
        })
  }
}

let buffer = ""
for await (const chunk of process.stdin) {
  buffer += new TextDecoder().decode(chunk as Uint8Array)
  let at = buffer.indexOf("\n")
  while (at >= 0) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line) {
      try {
        handle(JSON.parse(line) as Rpc)
      } catch {
        // ignore malformed frames
      }
    }
    at = buffer.indexOf("\n")
  }
}
