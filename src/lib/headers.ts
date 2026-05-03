export function parseHeaders(
  raw: string[],
  oauth2Bearer?: string,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const h of raw) {
    const idx = h.indexOf(':')
    if (idx > 0) {
      const key = h.slice(0, idx).trim()
      const value = h.slice(idx + 1).trim()
      if (key && value) {
        headers[key] = value
      }
    }
  }
  if (oauth2Bearer) {
    headers['Authorization'] = `Bearer ${oauth2Bearer}`
  }
  return headers
}
