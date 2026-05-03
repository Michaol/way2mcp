import type { Logger } from '../../src/types.js'

export const noopLogger: Logger = {
  info: () => {},
  error: () => {},
  debug: () => {},
}
