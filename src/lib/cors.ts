import { CorsOrigin } from '../types.js'

export function parseCorsOrigins(raw: string[] | undefined): CorsOrigin {
  if (!raw || raw.length === 0) return undefined
  if (raw.includes('*')) return true
  return raw.map((o) => {
    if (o.startsWith('/') && o.endsWith('/')) {
      return new RegExp(o.slice(1, -1))
    }
    return o
  })
}
