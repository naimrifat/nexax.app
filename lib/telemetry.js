// Simple in-memory telemetry for gateway/core instrumentation
class TelemetryStore {
  constructor() {
    this.store = {}
  }
  record(action, ok, latency) {
    const key = action || 'unknown'
    if (!this.store[key]) this.store[key] = { count: 0, ok: 0, lat: [], latencySum: 0 }
    const s = this.store[key]
    s.count += 1
    if (ok) s.ok += 1
    s.lat.push(latency || 0)
    s.latencySum += latency || 0
  }
  report() {
    const out = {}
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
module.exports = new TelemetryStore()
module.exports.default = module.exports
