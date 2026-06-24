---
name: run-all-tests
description: Run all k6 test scripts in the suite. Use when running the full test suite, CI validation, or pre-release smoke sweep.
---

# Run All Tests

## Steps

1. **Discover scripts**:
   ```bash
   find scripts/ -name '*.js' -type f | sort
   ```
   If no scripts found, report and stop.

2. **Check for custom binary need** — scan all scripts for extension imports:
   ```bash
   grep -rl "k6/x/" scripts/
   ```
   If any match, ensure `./k6` exists or build it.

3. **Set environment variables**:
   ```bash
   export BASE_URL=${BASE_URL:-http://localhost:8080}
   ```

4. **Smoke sweep first** — run each script as a 1-VU, 30s smoke test to catch script errors before committing to full runs:
   ```bash
   for script in scripts/*.js; do
     echo "=== Smoke: $script ==="
     k6 run --vus 1 --duration 10s "$script"
     if [ $? -eq 1 ]; then
       echo "SCRIPT ERROR in $script — fix before running full suite"
       exit 1
     fi
   done
   ```

5. **Full run** — run each script with its own defined options:
   ```bash
   TIMESTAMP=$(date +%Y%m%d-%H%M%S)
   FAILURES=0
   for script in scripts/*.js; do
     NAME=$(basename "$script" .js)
     echo "=== Full: $script ==="
     k6 run --out json=results/${TIMESTAMP}-${NAME}.json "$script"
     EXIT=$?
     if [ $EXIT -eq 99 ]; then
       echo "THRESHOLD BREACH: $script"
       FAILURES=$((FAILURES + 1))
     elif [ $EXIT -ne 0 ]; then
       echo "ERROR: $script (exit $EXIT)"
       FAILURES=$((FAILURES + 1))
     fi
   done
   ```

6. **Summary** — report:
   - Total scripts run
   - Pass count / fail count
   - Which scripts had threshold breaches (exit 99) vs script errors (exit 1)
   - Results are saved in `results/` with timestamp prefix
