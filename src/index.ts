#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { serve } from './server.js'
import { parseHeaders } from './lib/headers.js'
import { parseCorsOrigins } from './lib/cors.js'

try {
  const argv = yargs(hideBin(process.argv))
    .command(
      'serve',
      'Expose a local stdio MCP server as a network service',
      (y) =>
        y
          .option('cmd', {
            type: 'string',
            demandOption: true,
            describe: 'Command to run MCP server',
          })
          .option('port', {
            type: 'number',
            default: 8000,
            describe: 'Listen port',
          })
          .option('stateful', { type: 'boolean', default: false })
          .option('session-timeout', { type: 'number' })
          .option('cors', { type: 'array' })
          .option('header', { type: 'array', default: [] })
          .option('oauth2-bearer', { type: 'string' })
          .option('health', {
            type: 'string',
            default: '/healthz',
          })
          .option('log-level', {
            type: 'string',
            choices: ['debug', 'info', 'none'] as const,
            default: 'info' as const,
          }),
    )
    .command(
      'bridge',
      'Connect to a remote MCP server and expose as local stdio',
      (y) =>
        y
          .option('url', {
            type: 'string',
            demandOption: true,
            describe: 'Remote MCP server URL',
          })
          .option('header', { type: 'array', default: [] })
          .option('oauth2-bearer', { type: 'string' })
          .option('log-level', {
            type: 'string',
            choices: ['debug', 'info', 'none'] as const,
            default: 'info' as const,
          }),
    )
    .demandCommand(1, 'Please specify a command: serve or bridge')
    .help()
    .parseSync()

  const command = argv._[0] as string

  if (command === 'serve') {
    await serve({
      cmd: argv.cmd as string,
      port: argv.port as number,
      corsOrigins: parseCorsOrigins(argv.cors as string[] | undefined),
      headers: parseHeaders(
        argv.header as string[],
        argv['oauth2-bearer'] as string | undefined,
      ),
      healthEndpoint: argv.health as string,
      logLevel: argv['log-level'] as 'debug' | 'info' | 'none',
      stateful: argv.stateful as boolean,
      sessionTimeout:
        typeof argv['session-timeout'] === 'number'
          ? argv['session-timeout']
          : null,
    })
  } else if (command === 'bridge') {
    const { default: bridgeFn } = await import('./bridge.js')
    await bridgeFn({
      url: argv.url as string,
      headers: parseHeaders(
        argv.header as string[],
        argv['oauth2-bearer'] as string | undefined,
      ),
      logLevel: argv['log-level'] as 'debug' | 'info' | 'none',
    })
  }
} catch (err) {
  console.error('Fatal:', err)
  process.exit(1)
}
