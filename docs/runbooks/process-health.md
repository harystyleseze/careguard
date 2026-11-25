# Runbook: Node.js Process Health (Event-Loop Lag, Heap, RSS, GC)

**Symptom**
One of the `careguard-process-health` alerts in `docker/prometheus/rules.yml` fires:
- `NodejsEventLoopLagHigh` (`nodejs_eventloop_lag_seconds > 0.1` for 5m)
- `NodejsHeapUsageHigh` (`nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes > 0.85` for 10m)
- `NodejsResidentMemoryHigh` (`process_resident_memory_bytes > 512 MiB` for 10m)
- `NodejsGcDurationHigh` (`rate(nodejs_gc_duration_seconds_sum[5m]) > 0.1` for 5m)

**Impact**
API latency degrades across all endpoints, health checks may time out, or the container risks an OOMKill if memory continues to climb.

**Diagnosis**
1. Inspect `/metrics` or Grafana for correlated spikes in:
   - `agent_queue_depth` / `agent_waiting_jobs` (concurrent agent runs)
   - `bill_audit_oversized_rejections_total` (CPU-heavy bill-audit payloads)
   - `nodejs_active_handles_total` / `nodejs_active_requests_total` (leaked sockets or streams)
2. Check application logs for long-running tool calls, large LLM payloads, or repeated GC warnings.
3. If memory is climbing steadily without dropping after GC, capture a heap snapshot or inspect in-memory caches (e.g., rate-limit or fallback replay stores when Redis is down).

**Mitigation**
- If a single replica is wedged or approaching OOM, perform a rolling restart of the affected service container (`docker compose restart server` or Render restart).
- If CPU/event-loop lag correlates with large bill audits, verify `BILL_AUDIT_MAX_ITEMS` and rate limits (`docs/runbooks/rate-limit-tuning.md`).
- If memory growth correlates with Redis fallback, restore Redis (`docs/runbooks/redis-down.md`) so state is offloaded from process memory.

**Remediation**
- Profile the offending code path (async vs. sync crypto/JSON work, unbounded arrays/maps, unclosed HTTP streams).
- Adjust container memory limits or horizontal replica count if baseline traffic has grown legitimately.

**Post-mortem template**
- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:
