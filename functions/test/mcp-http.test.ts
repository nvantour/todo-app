import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authenticate } from '../src/auth'
import { createMcpServer } from '../src/mcp'
import { wwwAuthenticate } from '../src/oauth'
import { personalToken, setup } from './helpers'

// Zelfde afhandeling als de functie `mcp` in src/index.ts, maar op een gewone Node-server.
const ctx = setup()
let server: Server
let url: string
let token: string

beforeAll(async () => {
  token = await personalToken(ctx.repo)
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const auth = await authenticate(req.headers.authorization, ctx.deps.auth)
      if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': wwwAuthenticate('https://x.web.app'), 'Content-Type': 'application/json' }).end('{}')
        return
      }
      const mcp = createMcpServer(ctx.service, auth.uid)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => void transport.close())
      await mcp.connect(transport)
      await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
})
afterAll(() => void server.close())

describe('MCP over Streamable HTTP (stateless, token in header)', () => {
  it('werkt met het persoonlijke token zoals in .mcp.json', async () => {
    const client = new Client({ name: 'claude-code', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    expect((await client.listTools()).tools).toHaveLength(12)
    const r = (await client.callTool({ name: 'add_todo', arguments: { title: 'Via HTTP' } })) as { content: { text: string }[] }
    expect(JSON.parse(r.content[0].text).added.title).toBe('Via HTTP')
    await client.close()
  })

  it('geeft 401 met resource_metadata zonder geldig token', async () => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })
})
