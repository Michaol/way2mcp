export interface Logger {
  info: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export interface ServeConfig {
  cmd: string
  port: number
  corsOrigins: CorsOrigin
  headers: Record<string, string>
  healthEndpoint: string
  logLevel: 'debug' | 'info' | 'none'
  stateful: boolean
  sessionTimeout: number | null
}

export interface BridgeConfig {
  url: string
  headers: Record<string, string>
  logLevel: 'debug' | 'info' | 'none'
}

export type CorsOrigin =
  | boolean
  | string
  | RegExp
  | (string | RegExp)[]
  | undefined
