import express from 'express'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const mode = process.argv[2]
const port = Number(process.env.PORT || 3000)

const server = new McpServer({ name: 'mock-server', version: '1.0.0' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.registerTool(
  'add',
  {
    description: 'Add two numbers',
    inputSchema: { a: z.number(), b: z.number() } as any,
  },
  async ({ a, b }: { a: number; b: number }) => ({
    content: [
      { type: 'text' as const, text: `The sum of ${a} and ${b} is ${a + b}.` },
    ],
  }),
)

if (mode === 'stdio') {
  const transport = new StdioServerTransport()
  await server.connect(transport)
} else if (mode === 'streamableHttp') {
  const app = express()
  app.use(express.json())

  const transports = new Map<string, StreamableHTTPServerTransport>()

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const existing = sessionId ? transports.get(sessionId) : undefined

    if (existing) {
      await existing.handleRequest(req, res, req.body)
      return
    }

    if (req.method === 'POST' && req.body?.method === 'initialize') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport)
        },
      })
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId)
        }
      }
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Server not initialized' },
        id: null,
      })
    }
  })

  app.listen(port, () => {
    console.log(`Mock MCP Streamable HTTP server listening on port ${port}`)
  })
} else {
  console.error(`Unknown mode: ${mode}`)
  process.exit(1)
}
