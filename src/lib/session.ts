export class SessionAccessCounter {
  private counts = new Map<string, number>()
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly timeoutMs: number
  private readonly onTimeout: (sessionId: string) => void

  constructor(opts: {
    timeoutMs: number
    onTimeout: (sessionId: string) => void
  }) {
    this.timeoutMs = opts.timeoutMs
    this.onTimeout = opts.onTimeout
  }

  increment(sessionId: string): void {
    const existing = this.timeouts.get(sessionId)
    if (existing) {
      clearTimeout(existing)
      this.timeouts.delete(sessionId)
    }
    this.counts.set(sessionId, (this.counts.get(sessionId) ?? 0) + 1)
  }

  decrement(sessionId: string): void {
    const current = this.counts.get(sessionId)
    if (current === undefined) return
    const count = current - 1
    if (count <= 0) {
      this.counts.delete(sessionId)
      const t = setTimeout(() => {
        this.timeouts.delete(sessionId)
        this.onTimeout(sessionId)
      }, this.timeoutMs)
      this.timeouts.set(sessionId, t)
    }
  }

  /** Cancel all pending timeouts and clear tracked state. */
  clear(): void {
    for (const t of this.timeouts.values()) {
      clearTimeout(t)
    }
    this.timeouts.clear()
    this.counts.clear()
  }
}
