import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ChildProcess, spawn } from 'node:child_process'

const PORT = 19876

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
}

/** Parse an SSE response into an array of JSON-RPC messages */
async function parseSSEResponse(
  res: Response,
): Promise<Record<string, unknown>[]> {
  const text = await res.text()
  const messages: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      messages.push(JSON.parse(line.slice(6)))
    }
  }
  return messages
}

function waitForOutput(
  child: ChildProcess,
  pattern: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for: ${pattern}`)),
      timeoutMs,
    )
    child.stdout!.on('data', (data: Buffer) => {
      if (data.toString().includes(pattern)) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

describe('serve mode', () => {
  let child: ChildProcess

  before(async () => {
    child = spawn(
      process.execPath,
      [
        'dist/index.js',
        'serve',
        '--cmd',
        'node --import tsx/esm tests/helpers/mock-server.ts stdio',
        '--port',
        String(PORT),
        '--stateful',
        '--log-level',
        'info',
      ],
      { stdio: 'pipe' },
    )

    await waitForOutput(child, `serving on port ${PORT}`, 15_000)
  })

  after(() => {
    child?.kill()
    child?.stdout?.destroy()
    child?.stderr?.destroy()
  })

  it('health check returns ok', async () => {
    const res = await fetch(`http://localhost:${PORT}/healthz`)
    assert.equal(await res.text(), 'ok')
  })

  it('POST /mcp without session and not initialize returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })
    assert.equal(res.status, 400)
  })

  it('full MCP flow: initialize → tools/list → tools/call', async () => {
    const initRes = await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    })

    assert.equal(initRes.status, 200)
    const sessionId = initRes.headers.get('mcp-session-id')
    assert.ok(sessionId, 'should have session ID')

    const [initBody] = await parseSSEResponse(initRes)
    assert.equal(initBody.jsonrpc, '2.0')
    assert.ok(initBody.result)

    // notifications/initialized
    await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    })

    // tools/list
    const toolsRes = await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    })
    assert.equal(toolsRes.status, 200)
    const [toolsBody] = await parseSSEResponse(toolsRes)
    assert.ok((toolsBody.result as any).tools.length > 0)
    assert.equal((toolsBody.result as any).tools[0].name, 'add')

    // tools/call add(1, 2)
    const callRes = await fetch(`http://localhost:${PORT}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'add', arguments: { a: 1, b: 2 } },
      }),
    })
    assert.equal(callRes.status, 200)
    const [callBody] = await parseSSEResponse(callRes)
    assert.ok((callBody.result as any).content[0].text.includes('3'))
  })
})
