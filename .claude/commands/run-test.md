---
name: run-test
description: Run a single k6 test script. Use when asked to run a test, execute a script, or start a load test.
---

# Run a k6 Test

## Steps

1. **Identify the script** — find the target script in `scripts/`. If the user specified a name, resolve it. If ambiguous, list available scripts with `ls scripts/*.js` and ask.

2. **Check for custom extension imports** — scan the script for `from 'k6/x/'` imports:
   ```bash
   grep -l "k6/x/" scripts/<name>.js
   ```
   If found, the custom binary is required. Check if `./k6` exists:
   ```bash
   ls -la ./k6 2>/dev/null
   ```
   If missing, build it:
   ```bash
   xk6 build --with github.com/yourorg/ext=./extensions/<ext-name>
   ```

3. **Set environment variables** — ensure `BASE_URL` is set. Check `.env` or ask the user:
   ```bash
   export BASE_URL=${BASE_URL:-http://localhost:8080}
   ```

4. **Run the test**:
   - Smoke (quick validation): `k6 run --vus 1 --duration 30s scripts/<name>.js`
   - Full (use script's own options): `k6 run scripts/<name>.js`
   - With JSON output: `k6 run --out json=results/$(date +%Y%m%d-%H%M%S)-<name>.json scripts/<name>.js`
   - Custom binary: `./k6 run scripts/<name>.js`

5. **Interpret the result**:
   - Exit code `0` — all thresholds passed
   - Exit code `99` — threshold breached. Read the summary output to identify which thresholds failed.
   - Exit code `1` — script error. Read the error message — likely a bug in the test code (wrong import, init context violation, missing export).

6. **Report** — summarize the key metrics: p95 latency, error rate, checks pass rate, and any threshold breaches.
