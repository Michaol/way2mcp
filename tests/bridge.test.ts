import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ChildProcess, spawn } from 'node:child_process'
import { HttpBridge } from '../src/gateways/http-bridge.js'
import { noopLogger } from './helpers/noop-logger.js'

const PORT = 19877

describe('bridge mode (HttpBridge)', () => {
  let mockChild: ChildProcess
  let bridge: HttpBridge

  before(async () => {
    // Start mock server in streamableHttp mode
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

    // Connect HttpBridge
    bridge = new HttpBridge({
      url: `http://localhost:${PORT}/mcp`,
      headers: {},
      logger: noopLogger,
    })
    await bridge.start()
  })

  after(async () => {
    await bridge?.close()
    mockChild?.kill()
    mockChild?.stdout?.destroy()
    mockChild?.stderr?.destroy()
  })

  it('lists tools', async () => {
    const result = await bridge.request({
      method: 'tools/list',
      params: {},
    } as any)
    assert.ok(Array.isArray(result.tools))
    assert.equal(result.tools[0].name, 'add')
  })

  it('calls add(3, 4) and returns 7', async () => {
    const result = await bridge.request({
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 3, b: 4 } },
    } as any)
    assert.ok(result.content[0].text.includes('7'))
  })
})
