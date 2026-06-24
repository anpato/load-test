---
name: k6-load-testing
description: Deep k6 expertise — test lifecycle (init/setup/default/teardown), options and scenario executors (constant-vus, ramping-vus, constant-arrival-rate, ramping-arrival-rate), checks vs thresholds, HTTP/gRPC/WebSocket protocols, custom metrics (Counter/Gauge/Rate/Trend), data parameterization with SharedArray, output backends (JSON/CSV/InfluxDB/Prometheus), and test patterns (smoke/load/stress/soak/spike/breakpoint). Use when writing or reviewing k6 scripts, configuring scenarios, designing thresholds, troubleshooting k6 runtime errors, interpreting k6 output, or choosing between executor types.
---

# k6 Load Testing

## Test Lifecycle

Understanding the lifecycle is critical for correctness — calling APIs in the wrong context produces runtime errors.

### Init Context
Runs once per VU before the test starts.

**Allowed:** `open()`, `SharedArray`, importing modules, defining `options`.
**NOT allowed:** `http.*` calls, `sleep()`, `check()`, any k6 API calls.

Common mistake: calling `http.get()` in init crashes all VUs with a runtime error.

```js
import http from 'k6/http';
import { SharedArray } from 'k6/data';

// INIT CONTEXT — runs once per VU
const users = new SharedArray('users', function() {
  return JSON.parse(open('./data/users.json'));
});

export const options = { /* ... */ };
```

### Setup (optional)
Runs once on a single "setup VU" before any VU starts. Return value is passed to `default` and `teardown`.

Use for: auth token generation, test data seeding, environment validation.

```js
export function setup() {
  const loginRes = http.post(`${__ENV.BASE_URL}/auth/login`, JSON.stringify({
    email: 'loadtest@example.com',
    password: __ENV.TEST_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  const token = loginRes.json('token');
  if (!token) throw new Error('Setup failed: could not authenticate');
  return { token };
}
```

### Default Function
The VU function. Runs in a loop until duration/iterations exhausted. Everything here runs per-VU per-iteration.

```js
export default function(data) {
  // data = return value of setup()
  const res = http.get(`${__ENV.BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'list-users' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has users': (r) => r.json('users').length > 0,
  });

  sleep(1); // think time
}
```

### Teardown (optional)
Runs once after all VUs finish. Receives setup data. Use for cleanup.

```js
export function teardown(data) {
  http.del(`${__ENV.BASE_URL}/api/test-data`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
}
```

## Options and Scenario Executors

### Simple (shorthand)

```js
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.01'],
  },
};
```

### Stages (ramping-vus shorthand)

Always include a ramp-down stage to 0 — missing ramp-down leaves VUs at peak, causing misleading final-second metrics.

```js
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // ramp up
    { duration: '5m', target: 50 },   // hold
    { duration: '1m', target: 0 },    // ramp down — don't skip this
  ],
  thresholds: { /* ... */ },
};
```

### Scenario Executors

| Executor | What it controls | Use when |
|---|---|---|
| `constant-vus` | Fixed concurrent users | Baseline concurrency test |
| `ramping-vus` | Concurrency changes over time | Standard load profile |
| `constant-arrival-rate` | Fixed requests/sec regardless of VU count | Measuring throughput capacity |
| `ramping-arrival-rate` | Request rate changes over time | Finding exact breaking point |
| `per-vu-iterations` | Each VU runs N iterations then stops | Fixed workload distribution |
| `shared-iterations` | Total N iterations shared across VUs | Exact total request count |
| `externally-controlled` | VUs controlled via REST API | Live-tuning during test |

**Key distinction:** `constant-arrival-rate` vs `ramping-vus` answer different questions. Arrival-rate measures request throughput capacity (can the system handle 100 req/s?). Ramping-vus measures concurrent user capacity (can the system handle 500 simultaneous users?).

```js
export const options = {
  scenarios: {
    reads: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    writes: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 10,
      maxVUs: 50,
      exec: 'writeScenario',
    },
  },
  thresholds: { /* ... */ },
};

export default function() { /* read path */ }
export function writeScenario() { /* write path */ }
```

## Checks vs Thresholds

The most misunderstood pair in k6.

**Checks** record pass/fail metrics without stopping the test. They do NOT throw.

```js
check(res, {
  'status is 200': (r) => r.status === 200,
  'body has id': (r) => r.json('id') !== undefined,
});
```

**Thresholds** are the CI gate. They evaluate metrics after the test and determine the exit code.

```js
thresholds: {
  'http_req_duration': ['p(95)<500'],              // p95 latency under 500ms
  'http_req_duration{endpoint:checkout}': ['p(95)<800'], // per-endpoint
  'http_req_failed': ['rate<0.01'],                // <1% error rate
  'checks': ['rate>0.99'],                         // >99% of checks passed
  'http_req_duration{status:200}': ['p(95)<500'],  // exclude error responses from latency
}
```

**Critical:** tag thresholds with `{status:200}` to exclude error responses. Fast 500s artificially lower latency percentiles, hiding real degradation.

**`abortOnFail`** stops the test immediately on breach — use for smoke tests, not load tests where you want the full profile.

```js
thresholds: {
  'http_req_failed': [{ threshold: 'rate<0.1', abortOnFail: true }],
}
```

A typo in a threshold name silently creates a threshold that is never evaluated. `http_req_duraton` (typo) always passes.

## Custom Metrics

```js
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('custom_error_rate');       // percentage of truthy values
const dbQueryTime = new Trend('db_query_time');        // statistical distribution
const totalErrors = new Counter('total_errors');       // monotonically increasing
const activeConns = new Gauge('active_connections');    // last value (sampled)
```

Tag custom metrics for slicing: `dbQueryTime.add(duration, { query: 'users' })`.

Use custom metrics when built-in `http_req_*` metrics don't capture what you're measuring — e.g., time spent in a specific business operation that spans multiple HTTP calls.

## Data Parameterization

### Small datasets (< 100 rows)

```js
const data = JSON.parse(open('./data/users.json')); // init context

export default function() {
  const user = data[Math.floor(Math.random() * data.length)];
  // ...
}
```

### Large datasets — SharedArray

Allocated once in memory, shared across all VUs. Must be created in init context.

```js
import { SharedArray } from 'k6/data';

const users = new SharedArray('users', function() {
  return JSON.parse(open('./data/users.json'));
});

export default function() {
  const user = users[__VU % users.length];       // deterministic per-VU
  // or: users[__ITER % users.length]            // cycles across iterations
}
```

**Never create SharedArray inside the VU function** — it allocates O(VUs) memory instead of O(1). At 500 VUs with 10MB data = 5GB.

## HTTP Protocol

```js
import http from 'k6/http';

// Always check status
const res = http.get(url);
check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });

// Request tagging for per-endpoint thresholds
http.get(url, { tags: { endpoint: 'checkout' } });

// Batch parallel requests within a single VU iteration
const responses = http.batch([
  ['GET', `${BASE}/api/users`],
  ['GET', `${BASE}/api/products`],
]);

// POST with JSON body
http.post(url, JSON.stringify(payload), {
  headers: { 'Content-Type': 'application/json' },
});

// Form data
http.post(url, { field1: 'value1', field2: 'value2' });
```

## gRPC Protocol

```js
import grpc from 'k6/net/grpc';

const client = new grpc.Client();
client.load(['definitions'], 'service.proto'); // init context only

export default function() {
  client.connect('host:port', { plaintext: true });
  const res = client.invoke('pkg.Service/Method', { field: 'value' });
  check(res, { 'status OK': (r) => r && r.status === grpc.StatusOK });
  client.close();
}
```

`client.load()` must be in init context. `client.connect()` must be in VU function or setup.

## WebSocket Protocol

```js
import ws from 'k6/ws';

export default function() {
  const res = ws.connect(url, null, function(socket) {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'ping' })));
    socket.on('message', (data) => {
      check(data, { 'pong received': (d) => JSON.parse(d).type === 'pong' });
    });
    socket.setTimeout(() => socket.close(), 5000);
  });
  check(res, { 'WS connected': (r) => r && r.status === 101 });
}
```

## Output Backends

```bash
# JSON (for jq analysis)
k6 run --out json=results/output.json script.js

# CSV (for spreadsheets)
k6 run --out csv=results/output.csv script.js

# InfluxDB + Grafana (real-time dashboard)
k6 run --out influxdb=http://localhost:8086/k6 script.js

# Prometheus remote write
k6 run --out experimental-prometheus-rw script.js

# Multiple outputs
k6 run --out json=out.json --out csv=out.csv script.js
```

## Test Patterns

| Pattern | Purpose | Typical Config |
|---|---|---|
| Smoke | Verify script runs, no crashes | 1 VU, 1 min, strict thresholds |
| Load | Baseline expected traffic | Ramp to expected VUs, hold 10-30 min |
| Stress | Find breaking point | Ramp past expected VUs until failure |
| Soak | Detect memory leaks, gradual degradation | Expected VUs, 1-8 hours |
| Spike | Sudden traffic surge | Instant ramp to 10x VUs, drop back |
| Breakpoint | Exact capacity limit | Continuous ramp + `abortOnFail` threshold |

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| No thresholds | Test always exits 0 | Add `thresholds` to `options` |
| No `check()` on responses | 500s counted as success | Check every HTTP response |
| `open()` in VU code | "calling open() in VU code not allowed" | Move to init context |
| `SharedArray` in VU code | OOM at high VU count | Move to init context |
| No `sleep()` | 100% CPU, unrealistic throughput | Add think time |
| Missing ramp-down | Misleading final metrics | Add `{ target: 0 }` stage |
| No status tag on latency threshold | Fast errors lower average | Use `{status:200}` tag |
| `export default` missing | k6 runs but does nothing | Add default function |
| Threshold key typo | Threshold never evaluated | Verify metric names exactly |
| `check()` return ignored | Failures silent to operator | Add `checks` threshold |
