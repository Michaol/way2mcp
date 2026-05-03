import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let cachedVersion: string | null = null

export async function getVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const raw = await readFile(
      join(__dirname, '..', '..', 'package.json'),
      'utf8',
    )
    cachedVersion = String(JSON.parse(raw).version)
  } catch {
    cachedVersion = 'unknown'
  }
  return cachedVersion
}
