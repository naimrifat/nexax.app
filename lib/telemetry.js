// Simple in-memory telemetry for gateway/core instrumentation
const store = {}

export function record(action, ok, latency) {
  const key = action || 'unknown'
  if (!store[key]) store[key] = { count: 0, ok: 0, lat: [], latencySum: 0 }
  const s = store[key]
  s.count += 1
  if (ok) s.ok += 1
  s.lat.push(latency || 0)
  s.latencySum += latency || 0
}

export function report() {
  const out = {}
  for (const k of Object.keys(store)) {
    const s = store[k]
    const avg = s.lat.length ? s.latencySum / s.lat.length : 0
    out[k] = { count: s.count, ok: s.ok, avgLatencyMs: avg, samples: s.lat.slice(-5) }
  }
  return out
}

export function reset() {
  for (const k of Object.keys(store)) delete store[k]
}

const Telemetry = { record, report, reset }
export default Telemetry
