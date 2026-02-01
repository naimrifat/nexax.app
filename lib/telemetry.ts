// Simple in-memory telemetry for gateway/core instrumentation
type TelemetryEntry = { count: number; ok: number; lat: number[]; latencySum: number }

class TelemetryStore {
  private store: Record<string, TelemetryEntry>

  constructor() {
    this.store = {}
  }

  record(action: any, ok: any, latency: any) {
    const key = action || 'unknown'
    if (!this.store[key]) this.store[key] = { count: 0, ok: 0, lat: [], latencySum: 0 }
    const s = this.store[key]
    s.count += 1
    if (ok) s.ok += 1
    s.lat.push(latency || 0)
    s.latencySum += latency || 0
  }

  report() {
    const out: Record<string, any> = {}
    for (const k of Object.keys(this.store)) {
      const s = this.store[k]
      const avg = s.lat.length ? s.latencySum / s.lat.length : 0
      out[k] = { count: s.count, ok: s.ok, avgLatencyMs: avg, samples: s.lat.slice(-5) }
    }
    return out
  }

  reset() {
    this.store = {}
  }
}

const Telemetry = new TelemetryStore()
export default Telemetry

// Allow both `import Telemetry from ...` and `require(...)` consumers.
declare const module: any
if (typeof module !== 'undefined' && module?.exports) {
  module.exports = Telemetry
  module.exports.default = module.exports
}
