import { HttpBridge } from './gateways/http-bridge.js'
import { BridgeConfig } from './types.js'
import { getLogger } from './lib/logger.js'
import { onSignals } from './lib/signals.js'

/**
 * Bridge mode: connects to a remote MCP server (Streamable HTTP)
 * and forwards all traffic via stdio.
 */
export default async function bridge(config: BridgeConfig): Promise<void> {
  const logger = getLogger({
    logLevel: config.logLevel,
    outputTransport: 'stdio',
  })

  const httpBridge = new HttpBridge({
    url: config.url,
    headers: config.headers,
    logger,
  })

  await httpBridge.start()

  onSignals({
    logger,
    listenStdinClose: true,
    cleanup: async () => {
      await httpBridge.close()
    },
  })

  // Serial request queue to prevent response reordering (I4)
  let processing = Promise.resolve()

  function handleInitialize(msg: Record<string, unknown>): boolean {
    if (msg.method !== 'initialize' || msg.id === undefined) return false
    const serverInfo = httpBridge.getServerInfo()
    writeJsonRpc({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: serverInfo?.protocolVersion ?? '2025-03-26',
        capabilities: serverInfo?.capabilities ?? {},
        serverInfo: serverInfo?.serverInfo ?? {
          name: 'way2mcp-bridge',
          version: '1.0.0',
        },
      },
    })
    return true
  }

  async function forwardRequest(
    msg: Record<string, unknown>,
  ): Promise<boolean> {
    if (msg.id === undefined || !msg.method) return false
    const method = typeof msg.method === 'string' ? msg.method : 'unknown'
    try {
      const result = await httpBridge.request(msg)
      writeJsonRpc({ jsonrpc: '2.0', id: msg.id, result })
    } catch (err: unknown) {
      const errObj =
        typeof err === 'object' && err !== null
          ? (err as Record<string, unknown>)
          : {}
      writeJsonRpc({
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: typeof errObj.code === 'number' ? errObj.code : -32603,
          message: err instanceof Error ? err.message : 'Remote request failed',
          data: errObj.data,
        },
      })
      logger.error(
        `Remote error for ${method}: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
    return true
  }

  async function handleMessage(line: string): Promise<void> {
    const msg = JSON.parse(line)

    if (handleInitialize(msg)) return
    if (msg.method === 'notifications/initialized') {
      logger.debug('Received notifications/initialized, acknowledged')
      return
    }
    if (await forwardRequest(msg)) return

    if (msg.method) {
      await httpBridge.notify(msg)
      logger.debug('stdin → remote (notification):', msg.method)
    } else {
      logger.debug('stdin → remote (non-request):', msg)
    }
  }

  function writeJsonRpc(obj: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(obj)}\n`)
  }

  // Forward stdin (from local client) to remote server, pipe responses back
  let buffer = ''
  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      processing = processing.then(async () => {
        try {
          await handleMessage(line)
        } catch (err) {
          logger.debug('Skipping non-JSON or invalid line from stdin:', err)
        }
      })
    }
  })

  logger.info('Bridge connected. Stdio <-> Remote ready.')
}
