import { Logger } from '../types.js'

export function onSignals(opts: {
  logger: Logger
  cleanup?: () => void | Promise<void>
  listenStdinClose?: boolean
}): void {
  const shutdown = async (signal: string) => {
    opts.logger.info(`Received ${signal}, shutting down...`)
    try {
      if (opts.cleanup) await opts.cleanup()
    } catch (err) {
      opts.logger.error('Cleanup error during shutdown:', err)
    }
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGHUP', () => shutdown('SIGHUP'))
  if (opts.listenStdinClose) {
    process.stdin.on('close', () => shutdown('stdin close'))
  }
}
