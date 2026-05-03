import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { Logger } from '../types.js'

/** Split a shell command string into [command, ...args], respecting quotes. */
function splitCommand(cmd: string): string[] {
  const tokens = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
  if (!tokens) return []
  return tokens.map((t) => {
    if (
      (t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))
    ) {
      return t.slice(1, -1)
    }
    return t
  })
}

export interface StdioBridgeOpts {
  cmd: string
  logger: Logger
}

export class StdioBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private messageHandler: ((msg: JSONRPCMessage) => void) | null = null
  private errorHandler: ((err: unknown) => void) | null = null
  private readonly opts: StdioBridgeOpts

  constructor(opts: StdioBridgeOpts) {
    this.opts = opts
  }

  async start(): Promise<void> {
    const parts = splitCommand(this.opts.cmd)
    if (parts.length === 0) {
      throw new Error('Empty command')
    }
    const [command, ...args] = parts
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.on('error', (err) => {
      this.opts.logger.error(`Child process error: ${err.message}`)
      this.errorHandler?.(err)
    })

    this.child.on('exit', (code, signal) => {
      this.opts.logger.error(`Child exited: code=${code}, signal=${signal}`)
    })

    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.opts.logger.error(`Child stderr: ${chunk.toString('utf8')}`)
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      const lines = this.buffer.split(/\r?\n/)
      this.buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as JSONRPCMessage
          this.opts.logger.debug('stdio → bridge:', msg)
          this.messageHandler?.(msg)
        } catch {
          this.errorHandler?.(new Error(`Non-JSON from child: ${line}`))
        }
      }
    })
  }

  send(msg: JSONRPCMessage): void {
    if (!this.child) throw new Error('Bridge not started')
    this.opts.logger.debug('bridge → stdio:', msg)
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void {
    this.messageHandler = handler
  }

  onError(handler: (err: unknown) => void): void {
    this.errorHandler = handler
  }

  async close(): Promise<void> {
    if (this.child) {
      const child = this.child
      this.child = null
      child.kill()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000)
        child.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
}
