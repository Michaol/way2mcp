import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ChildProcess, spawn } from 'node:child_process'
import { HttpBridge } from '../src/gateways/http-bridge.js'
import { noopLogger } from './helpers/noop-logger.js'

const PORT = 19882

describe('HttpBridge connection', () => {
  let mockChild: ChildProcess

  before(async () => {
    mockChild = spawn(
      process.execPath,
      ['--import', 'tsx/esm', 'tests/helpers/mock-server.ts', 'streamableHttp'],
      {
        stdio: 'pipe',
        env: { ...process.env, PORT: String(PORT) },
      },
    )

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('mock server start timeout')),
        15_000,
      )
      mockChild.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes('listening on port')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      mockChild.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  after(() => {
    mockChild?.kill()
    mockChild?.stdout?.destroy()
    mockChild?.stderr?.destroy()
  })

  it('connects via Streamable HTTP to a compatible server', async () => {
    const bridge = new HttpBridge({
      url: `http://localhost:${PORT}/mcp`,
      headers: {},
      logger: noopLogger,
    })

    await bridge.start()

    const result = await bridge.request({
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 10, b: 20 } },
    } as any)
    assert.ok(result.content[0].text.includes('30'))

    await bridge.close()
  })

  it('throws when server is unreachable', async () => {
    const bridge = new HttpBridge({
      url: 'http://localhost:19999/mcp',
      headers: {},
      logger: noopLogger,
    })

    await assert.rejects(() => bridge.start(), {
      message: /ECONNREFUSED|fetch failed|ENOTFOUND/,
    })

    // Clean up: close the bridge even though start() failed
    try {
      await bridge.close()
    } catch {}
  })
})
