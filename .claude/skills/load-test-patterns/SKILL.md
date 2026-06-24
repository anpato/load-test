---
name: load-test-patterns
description: Load testing methodology and strategy — SLO-driven threshold design, realistic traffic modeling (think time, user journeys, read/write ratios), test environment requirements, bottleneck identification from k6 metrics, result interpretation, test data isolation patterns, and CI integration strategy (smoke on PR, load nightly, soak weekly). Use when designing a test strategy, choosing test types, writing SLO-based thresholds, interpreting k6 results, debugging unreliable tests, or planning CI integration for load tests.
---

# Load Test Patterns & Methodology

## SLO-Driven Threshold Design

Never invent thresholds. Derive from SLOs.

| SLO | k6 Threshold | Rationale |
|---|---|---|
| p99 latency < 1s | `'http_req_duration': ['p(99)<800']` | 20% buffer inward catches degradation before prod breach |
| Error rate < 0.1% | `'http_req_failed': ['rate<0.001']` | Match SLA precision |
| Availability 99.9% | `'checks': ['rate>0.999']` | Checks map to functional assertions |

**Always set `http_req_failed` threshold.** Without it, a test reporting 0ms p95 latency might be because all requests are failing instantly (cached errors, circuit breakers returning fast).

**Tag thresholds per endpoint:**
```js
thresholds: {
  'http_req_duration{endpoint:checkout}': ['p(95)<800'],
  'http_req_duration{endpoint:browse}': ['p(95)<300'],
  'http_req_failed{endpoint:checkout}': ['rate<0.005'],
}
```

A global threshold hides that the slow endpoint is checkout while browse is fast.

**Filter by status on latency thresholds:**
```js
'http_req_duration{status:200}': ['p(95)<500']
```
Error responses (400s, 500s) are fast — they pull the average down, masking real latency.

## Realistic Traffic Modeling

### Think Time

| Application type | Typical think time | Rationale |
|---|---|---|
| Web app (browsing) | 1-5s between page loads | User reads, clicks, scrolls |
| API (automated client) | 0-100ms | Machine-driven, near-zero delay |
| Mobile app | 2-10s between taps | User interacts with native UI |
| Checkout flow | 5-30s per step | User enters payment info |

No sleep = artificial throughput. A test without think time measures raw throughput, not concurrent user capacity. Document if intentional.

### User Journey Scripts

More realistic than single-endpoint tests:

```js
export default function(data) {
  // 1. Browse products
  let res = http.get(`${BASE}/api/products`, { tags: { endpoint: 'browse' } });
  check(res, { 'browse 200': (r) => r.status === 200 });
  sleep(randomIntBetween(2, 5));

  // 2. View product detail
  const productId = res.json('products.0.id');
  res = http.get(`${BASE}/api/products/${productId}`, { tags: { endpoint: 'detail' } });
  check(res, { 'detail 200': (r) => r.status === 200 });
  sleep(randomIntBetween(1, 3));

  // 3. Add to cart
  res = http.post(`${BASE}/api/cart`, JSON.stringify({ productId }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'add-to-cart' },
  });
  check(res, { 'cart 201': (r) => r.status === 201 });
  sleep(randomIntBetween(1, 2));
}
```

### Read/Write Ratio Modeling

If real traffic is 80% reads and 20% writes, encode that ratio with scenarios:

```js
scenarios: {
  reads: {
    executor: 'constant-arrival-rate',
    rate: 80,
    timeUnit: '1s',
    preAllocatedVUs: 40,
    maxVUs: 100,
    exec: 'readScenario',
  },
  writes: {
    executor: 'constant-arrival-rate',
    rate: 20,
    timeUnit: '1s',
    preAllocatedVUs: 20,
    maxVUs: 50,
    exec: 'writeScenario',
  },
}
```

## Environment Requirements

### Data Volume
Tests against an empty database don't reflect production behavior. Seed representative data before testing.

| Production state | Test environment minimum |
|---|---|
| 1M users | 100K users (10% representative sample) |
| 50M rows in orders table | 5M rows with similar distribution |
| 10GB media assets | Enough to exceed cache capacity |

### Cache Warmup
Add a warmup scenario that runs at low VUs for 2-5 minutes before measurement. Cold-cache latency contaminates results.

```js
scenarios: {
  warmup: {
    executor: 'constant-vus',
    vus: 5,
    duration: '3m',
    startTime: '0s',
    exec: 'warmupScenario',
  },
  load: {
    executor: 'ramping-vus',
    startTime: '3m',  // starts after warmup
    stages: [
      { duration: '2m', target: 100 },
      { duration: '10m', target: 100 },
      { duration: '1m', target: 0 },
    ],
  },
}
```

### Network Topology
Run k6 from the same network zone as the service, or explicitly model cross-zone latency. The `http_req_connecting` metric reveals DNS + TCP handshake overhead — high values mean network, not application, is the bottleneck.

## Bottleneck Identification

### From k6 Metrics

| Metric pattern | Likely bottleneck | Investigation |
|---|---|---|
| High `http_req_waiting` (TTFB) | Application processing (CPU, DB, downstream) | Profile the service, check DB query plans |
| High `http_req_receiving` | Network bandwidth or large response bodies | Check response sizes, add pagination |
| High `http_req_connecting` | Connection pool exhaustion, DNS resolution | Check connection reuse, increase pool |
| High `http_req_sending` | Large request bodies (upload tests) | Check payload sizes |
| Error rate spikes before latency | Connection/queue saturation | Check connection limits, thread pools |
| Latency spike without error increase | CPU saturation or GC pressure | Check CPU usage, GC logs |
| Both spike together | Resource exhaustion (memory, FDs, threads) | Check system limits, OOM events |

### From k6 Counters

| Counter | Signal |
|---|---|
| `dropped_iterations` > 0 | Test generating more work than VUs can handle. Increase VUs or add think time. |
| `vus` diverges from `stages` | k6 can't start VUs fast enough — init context is too slow (large SharedArray, complex setup). |
| `data_received` very high | Large responses — missing pagination? |
| `iteration_duration` >> individual request durations | Significant time spent in JS processing between requests. |

## Result Interpretation

### Percentiles

- **P50 (median):** typical user experience
- **P90:** experience of the slowest 10% of requests
- **P95:** standard SLO target for interactive UIs
- **P99:** catches pathological outliers — use for SLAs

P95 vs P99: for interactive UIs, optimize P95. For SLAs, negotiate P99. The gap between p95 and p99 reveals tail latency — a large gap suggests intermittent issues (GC pauses, cache misses, retry storms).

### Comparing Runs

When comparing before/after:
- Same VU count, same duration, same data volume
- Same environment (don't compare local vs staging)
- Run at least 3 times to account for variance
- Compare distributions (percentiles), not averages — averages hide outliers

## Test Data Isolation

### Unique Identifiers

```js
const uniqueId = `loadtest-${__VU}-${__ITER}-${Date.now()}`;
const email = `${uniqueId}@loadtest.example.com`;
```

### Cleanup Patterns

**Option A — Teardown cleanup:**
```js
export function setup() {
  // create test org
  const res = http.post(`${BASE}/api/orgs`, JSON.stringify({ name: 'loadtest-org' }));
  return { orgId: res.json('id'), token: '...' };
}

export function teardown(data) {
  http.del(`${BASE}/api/orgs/${data.orgId}`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
}
```

**Option B — Idempotent tests (preferred for CI):**
Design tests that can run repeatedly without side effects. Use GET-only scripts for read tests. For write tests, use unique identifiers and accept that cleanup happens out-of-band (DB job, TTL).

## CI Integration Strategy

| Test type | Trigger | Duration | VUs | Thresholds |
|---|---|---|---|---|
| Smoke | Every PR | 1 min | 1 | Strict (any failure = fail) |
| Load | Nightly / pre-release | 20-30 min | Realistic (from capacity plan) | SLO-derived |
| Stress | Weekly / pre-release | Until break | Ramp past capacity | `abortOnFail` on error rate |
| Soak | Weekly / pre-release | 1-8 hours | Realistic | Memory/leak thresholds |

### Exit Code Handling

```bash
k6 run scripts/smoke.js
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "PASS: all thresholds met"
elif [ $EXIT_CODE -eq 99 ]; then
  echo "FAIL: threshold breached"
  exit 1
else
  echo "ERROR: script bug (exit code $EXIT_CODE)"
  exit 1
fi
```

### Flaky Test Diagnosis

If a test passes/fails inconsistently:
1. Check for shared mutable state (test data collisions between concurrent CI runs)
2. Check for time-dependent logic (timezone, day-of-week, DST)
3. Check for external dependency flakiness (third-party API rate limits)
4. Check for insufficient warmup (cold cache on first run)
5. Run the test 5 times consecutively — if it fails 2-3 times, it's the test; if 0-1, it's the environment
