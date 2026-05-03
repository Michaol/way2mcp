import express, { Request, Response } from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { StdioBridge } from './gateways/stdio-bridge.js'
import { Logger, ServeConfig } from './types.js'
import { onSignals } from './lib/signals.js'
import { getLogger } from './lib/logger.js'
import { SessionAccessCounter } from './lib/session.js'

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'proxy-authorization',
  'cookie',
])

function sanitizeLogHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? '[REDACTED]'
      : value
  }
  return result
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport
  stdioBridge: StdioBridge
}

export async function serve(config: ServeConfig): Promise<void> {
  const logger = getLogger({
    logLevel: config.logLevel,
    outputTransport: 'http',
  })

  const app = express()

  if (config.corsOrigins) {
    app.use(cors({ origin: config.corsOrigins }))
  }

  app.use(express.json())

  // Health endpoint
  app.get(config.healthEndpoint, (_req: Request, res: Response) => {
    res.send('ok')
  })

  const sessions = new Map<string, SessionEntry>()

  // Session timeout (I2): integrate SessionAccessCounter
  const sessionCounter = config.sessionTimeout
    ? new SessionAccessCounter({
        timeoutMs: config.sessionTimeout,
        onTimeout: (sessionId: string) => {
          const entry = sessions.get(sessionId)
          if (entry) {
            logger.info(`Session ${sessionId} timed out, cleaning up`)
            entry.transport.close?.()
            entry.stdioBridge.close()
            sessions.delete(sessionId)
          }
        },
      })
    : null

  function resolveTransport(
    sessionId: string | undefined,
  ): SessionEntry | undefined {
    if (!sessionId) return undefined
    return sessions.get(sessionId)
  }

  // Track stateless transports for cleanup (I1)
  const statelessEntries: SessionEntry[] = []

  // ──────── Streamable HTTP transport ────────
  app.post('/mcp', async (req: Request, res: Response) => {
    logger.debug(
      `POST /mcp body: ${JSON.stringify(req.body)} headers: ${JSON.stringify(sanitizeLogHeaders(req.headers))}`,
    )
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const existing = resolveTransport(sessionId)

      if (existing) {
        if (sessionId) sessionCounter?.increment(sessionId)
        try {
          await existing.transport.handleRequest(req, res, req.body)
        } finally {
          if (sessionId) sessionCounter?.decrement(sessionId)
        }
        return
      }

      if (!sessionId) {
        const parseResult = InitializeRequestSchema.safeParse(req.body)
        if (parseResult.success) {
          await createSession(
            req,
            res,
            config,
            logger,
            sessions,
            sessionCounter,
            statelessEntries,
          )
          return
        } else {
          logger.error(
            `Invalid initialize request: ${JSON.stringify(parseResult.error)}`,
          )
        }
      }

      res.status(400).json({
        error: 'Invalid request',
        details: 'Session missing or not an initialize request',
      })
    } catch (err) {
      logger.error('POST /mcp error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  // GET for server-to-client notifications (SSE stream)
  app.get('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const entry = resolveTransport(sessionId)
      if (entry) {
        await entry.transport.handleRequest(req, res)
      } else {
        res.status(400).json({ error: 'Missing or invalid session' })
      }
    } catch (err) {
      logger.error('GET /mcp error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  // DELETE for session termination
  app.delete('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const entry = resolveTransport(sessionId)
      if (entry) {
        await entry.transport.handleRequest(req, res)
      } else {
        res.status(404).json({ error: 'Session not found' })
      }
    } catch (err) {
      logger.error('DELETE /mcp error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  })

  const httpServer = app.listen(config.port, () => {
    logger.info(`way2mcp serving on port ${config.port}`)
    logger.info(`  MCP endpoint: http://localhost:${config.port}/mcp`)
    logger.info(`  Stateful: ${config.stateful}`)
    logger.info(
      `  Health: http://localhost:${config.port}${config.healthEndpoint}`,
    )
  })

  // Graceful shutdown (I5)
  onSignals({
    logger,
    cleanup: async () => {
      // Clean up stateful sessions
      for (const [, entry] of sessions) {
        await entry.transport.close?.()
        await entry.stdioBridge.close()
      }
      sessions.clear()

      // Clean up stateless entries (I1)
      for (const entry of statelessEntries) {
        await entry.transport.close?.()
        await entry.stdioBridge.close()
      }
      statelessEntries.length = 0

      sessionCounter?.clear()
      httpServer.close()
    },
  })
}

/** Helper to create a new MCP session and spawn the stdio child. */
async function createSession(
  req: Request,
  res: Response,
  config: ServeConfig,
  logger: Logger,
  sessions: Map<string, SessionEntry>,
  sessionCounter: SessionAccessCounter | null,
  statelessEntries: SessionEntry[],
) {
  logger.info(`Creating new session for initialize request`)
  const stdioBridge = new StdioBridge({ cmd: config.cmd, logger })
  let transport: StreamableHTTPServerTransport | null = null

  try {
    await stdioBridge.start()

    transport = new StreamableHTTPServerTransport({
      // ALWAYS provide a session ID for Streamable HTTP, regardless of config.stateful
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions.set(sid, { transport: transport!, stdioBridge })
      },
    })

    await transport.start()

    // Wire: transport <-> stdioBridge
    transport.onmessage = (msg: JSONRPCMessage) => {
      stdioBridge.send(msg)
    }
    stdioBridge.onMessage((msg) => {
      transport!.send(msg)
    })

    transport.onclose = () => {
      if (transport?.sessionId) {
        sessions.delete(transport.sessionId)
        sessionCounter?.decrement(transport.sessionId)
      }
      stdioBridge.close()
    }

    // Track stateless entries for cleanup (I1)
    if (!config.stateful) {
      const entry = { transport, stdioBridge }
      statelessEntries.push(entry)

      // Clean up when transport closes
      const origOnClose = transport.onclose
      transport.onclose = () => {
        origOnClose?.()
        const idx = statelessEntries.indexOf(entry)
        if (idx >= 0) statelessEntries.splice(idx, 1)
      }
    }

    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    logger.error('Failed to create session:', err)
    await stdioBridge.close()
    if (transport) await transport.close?.()
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initialize MCP server' })
    }
  }
}
