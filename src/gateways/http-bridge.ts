import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js'
import { Logger } from '../types.js'
import { getVersion } from '../lib/version.js'

export interface HttpBridgeOpts {
  url: string
  headers: Record<string, string>
  logger: Logger
}

/**
 * Connects to a remote MCP server using the modern Streamable HTTP transport.
 * Provides a thin wrapper for sending/receiving raw JSON-RPC through the SDK Client.
 */
export class HttpBridge {
  private client: Client | null = null
  private transport: StreamableHTTPClientTransport | null = null
  private readonly opts: HttpBridgeOpts
  private serverInfo: {
    protocolVersion: string
    capabilities: Record<string, unknown>
    serverInfo: { name: string; version: string }
  } | null = null

  constructor(opts: HttpBridgeOpts) {
    this.opts = opts
  }

  private createClient(version: string): Client {
    return new Client({ name: 'way2mcp', version }, { capabilities: {} })
  }

  async start(): Promise<void> {
    const url = new URL(this.opts.url)
    const version = await getVersion()

    this.opts.logger.info(`Connecting via Streamable HTTP: ${url}`)
    this.client = this.createClient(version)
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: this.opts.headers },
    })

    await this.client.connect(this.transport)
    this.opts.logger.info('Connected via Streamable HTTP')

    // Capture server info from the completed handshake.
    // The SDK Client does not publicly expose the negotiated protocolVersion.
    // We fall back to '2025-03-26' as the default per MCP spec.
    const serverVersion = this.client.getServerVersion()
    const clientInternal = this.client as unknown as Record<string, unknown>
    const protoVersion = clientInternal['_protocolVersion']
    const negotiated =
      typeof protoVersion === 'string' ? protoVersion : '2025-03-26'
    this.serverInfo = {
      protocolVersion: negotiated,
      capabilities: this.client.getServerCapabilities() || {},
      serverInfo: serverVersion || {
        name: 'unknown',
        version: '0.0.0',
      },
    }

    this.opts.logger.debug(
      'Handshake completed. Captured capabilities:',
      Object.keys(this.serverInfo.capabilities),
    )
  }

  /** Get the remote server's info from the completed handshake. */
  getServerInfo() {
    return this.serverInfo
  }

  /** Send a JSON-RPC request to the remote server and return the result content. */
  async request(msg: any): Promise<any> {
    if (!this.client) throw new Error('Bridge not started')
    this.opts.logger.debug('bridge → remote (request):', {
      method: msg.method,
      id: msg.id,
    })

    // The SDK client.request() returns only the 'result' property of the response.
    // We pass z.any() to allow any response structure through the bridge.
    return await this.client.request(
      {
        method: msg.method,
        params: msg.params,
      },
      z.any() as any,
    )
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(msg: JSONRPCNotification): Promise<void> {
    if (!this.client) throw new Error('Bridge not started')
    this.opts.logger.debug('bridge → remote (notification):', {
      method: msg.method,
    })
    await this.client.notification(msg)
  }

  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close()
    }
  }
}
