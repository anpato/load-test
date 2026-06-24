# Load Test

k6-based load test suite with optional Go xk6 extensions.

## Directory Layout

```
scripts/         k6 test scripts (JS)
lib/             shared k6 JS utilities (auth helpers, HTTP wrappers, data loaders)
config/          environment-specific options, shared thresholds, stage definitions
extensions/      Go xk6 extension source (each extension is a Go module)
results/         test output (JSON, CSV) — gitignored
data/            test data files (JSON, CSV) for parameterization
```

## Conventions

- k6 runs scripts in Goja (Go-native ES5.1+ runtime). No Node.js APIs — no `require('fs')`, no `process.env`. Use `__ENV` for env vars, `open()` for files.
- Every test script MUST define `export const options` with `thresholds`. A script without thresholds never fails CI.
- Base URLs come from `__ENV.BASE_URL` — never hardcoded.
- `setup()` that creates persistent data MUST have a matching `teardown()`.
- Test naming: `<target>-<scenario>.js` (e.g., `api-soak.js`, `checkout-spike.js`).

## Running Tests

- System k6: `k6 run scripts/<name>.js`
- Custom binary (scripts importing `k6/x/*`): build first with `xk6 build`, then `./k6 run scripts/<name>.js`
- JSON output: `k6 run --out json=results/$(date +%Y%m%d-%H%M%S).json scripts/<name>.js`

## Exit Codes

- `0` — clean run, all thresholds passed
- `99` — threshold breached
- `1` — script error (bug in test code)

## Go Extensions

If `extensions/` exists, it contains Go modules using xk6. The custom binary must be rebuilt after any Go change: `xk6 build --with github.com/yourorg/ext=./extensions/ext`
