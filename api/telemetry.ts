type Stat = {
  count: number
  ok: number
  latencySum: number
  latencies: number[]
}

class TelemetryStore {
  private store: Record<string, Stat> = {}

  record(action: string, ok: boolean, latencyMs: number) {
    const key = action || 'unknown'
    if (!this.store[key]) this.store[key] = { count: 0, ok: 0, latencySum: 0, latencies: [] }
    const s = this.store[key]
    s.count += 1
    if (ok) s.ok += 1
    s.latencySum += latencyMs
    s.latencies.push(latencyMs)
  }

  report() {
    const out: any = {}
    for (const [k, v] of Object.entries(this.store)) {
      const avg = v.latencies.length ? v.latencySum / v.latencies.length : 0
      out[k] = { count: v.count, ok: v.ok, avgLatencyMs: avg, samples: v.latencies.slice(-5) }
    }
    return out
  }

  reset() {
    this.store = {}
  }
}

export const Telemetry = new TelemetryStore()
