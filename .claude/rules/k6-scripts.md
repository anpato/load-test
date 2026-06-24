---
description: Guards for k6 test scripts — enforced on every JS edit
globs: scripts/**/*.js, lib/**/*.js
---

- Every script MUST `export const options` with `thresholds` defined. No thresholds = test always passes = CI is blind.
- All HTTP responses must be checked: `check(res, {'status 2xx': (r) => r.status >= 200 && r.status < 300})`. Unchecked requests silently count 500s as success.
- `open()` is only allowed in the init context (top level). Calling it inside `export default function` or setup/teardown produces a runtime crash.
- `SharedArray` must be created in the init context. Creating it in the VU function allocates O(VUs) memory instead of O(1).
- Base URL must come from `__ENV.BASE_URL` — never hardcode `localhost` or any host. Hardcoded URLs break in CI.
- `setup()` that creates persistent data (DB records, files, users) MUST have a corresponding `teardown()` that cleans up.
- Include `sleep()` in the VU function for realistic think time. Omitting sleep = artificial 100% CPU throughput, not user simulation. If intentionally omitted for raw throughput testing, add a comment explaining why.
- Ramping stages must include a final `{ target: 0 }` ramp-down stage. Missing ramp-down leaves VUs at peak, producing misleading final metrics.
- Tag latency thresholds with `{status:200}` to exclude fast error responses from percentile calculations.
- Import shared utilities from `lib/` instead of inlining — check for existing helpers before writing new ones.
