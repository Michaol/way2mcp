import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const MOCK_PORT = 19880

describe('bridge e2e (stdin/stdout)', () => {
  let mockChild: ChildProcess
  let bridge: ChildProcess
  let stdoutLines: ReturnType<typeof createInterface>

  before(async () => {
    // Start mock Streamable HTTP server
    mockChild = spawn(
      process.execPath,
      ['--import', 'tsx/esm', 'tests/helpers/mock-server.ts', 'streamableHttp'],
      {
        stdio: 'pipe',
        env: { ...process.env, PORT: String(MOCK_PORT) },
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

    // Spawn bridge process with log-level info so we can wait for stderr
    bridge = spawn(
      process.execPath,
      [
        'dist/index.js',
        'bridge',
        '--url',
        `http://localhost:${MOCK_PORT}/mcp`,
        '--log-level',
        'info',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    stdoutLines = createInterface({ input: bridge.stdout! })

    // Wait for the bridge to be ready by listening on stderr
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('bridge start timeout')),
        15_000,
      )
      const errLines = createInterface({ input: bridge.stderr! })
      errLines.on('line', (line: string) => {
        if (line.includes('Bridge connected')) {
          clearTimeout(timeout)
          errLines.close()
          resolve()
        }
      })
      bridge.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  after(() => {
    bridge?.kill()
    bridge?.stdin?.destroy()
    bridge?.stdout?.destroy()
    bridge?.stderr?.destroy()
    stdoutLines?.close()
    mockChild?.kill()
    mockChild?.stdout?.destroy()
    mockChild?.stderr?.destroy()
  })

  function writeStdin(msg: Record<string, unknown>): void {
    bridge.stdin!.write(JSON.stringify(msg) + '\n')
  }

  function waitForStdout(timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        stdoutLines.removeListener('line', onLine)
        reject(new Error('Timeout waiting for stdout line'))
      }, timeoutMs)
      function onLine(line: string) {
        clearTimeout(timer)
        resolve(line)
      }
      stdoutLines.once('line', onLine)
    })
  }

  it('handles initialize handshake', async () => {
    writeStdin({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      },
    })

    const line = await waitForStdout(10_000)
    const response = JSON.parse(line)
    assert.equal(response.jsonrpc, '2.0')
    assert.equal(response.id, 1)
    assert.ok(response.result)
    assert.ok(response.result.capabilities)
    assert.ok(response.result.serverInfo)
  })

  it('handles notifications/initialized without response', async () => {
    writeStdin({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })

    // This should produce NO stdout line. We verify with a short race.
    const result = await Promise.race([
      waitForStdout(600)
        .then(() => 'LINE')
        .catch(() => 'NO_LINE'),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('NO_LINE'), 600),
      ),
    ])
    assert.equal(
      result,
      'NO_LINE',
      'notifications/initialized should not produce stdout output',
    )
  })

  it('forwards tools/list request', async () => {
    writeStdin({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })

    const line = await waitForStdout(10_000)
    const response = JSON.parse(line)
    assert.equal(response.id, 2)
    assert.ok(response.result)
    assert.ok(Array.isArray(response.result.tools))
    assert.equal(response.result.tools[0].name, 'add')
  })

  it('forwards tools/call and returns result', async () => {
    writeStdin({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 10, b: 20 } },
    })

    const line = await waitForStdout(10_000)
    const response = JSON.parse(line)
    assert.equal(response.id, 3)
    assert.ok(response.result)
    assert.ok(response.result.content[0].text.includes('30'))
  })
})
