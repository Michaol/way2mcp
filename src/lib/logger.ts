import { Logger } from '../types.js'

export function getLogger(opts: {
  logLevel: 'debug' | 'info' | 'none'
  outputTransport: 'stdio' | 'http'
}): Logger {
  const toStderr = opts.outputTransport === 'stdio'
  const sink = toStderr
    ? (...args: unknown[]) => console.error(...args)
    : (...args: unknown[]) => console.log(...args)

  if (opts.logLevel === 'none') {
    return { info: () => {}, error: () => {}, debug: () => {} }
  }

  return {
    info: (...args: unknown[]) => sink('[info]', ...args),
    error: (...args: unknown[]) => sink('[error]', ...args),
    debug:
      opts.logLevel === 'debug'
        ? (...args: unknown[]) => sink('[debug]', ...args)
        : () => {},
  }
}
