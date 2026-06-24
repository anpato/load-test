---
description: Guards for Go xk6 extension code
globs: "**/*.go"
---

- All exported functions callable from JS must recover from panics or use `common.Throw(rt, err)`. An unrecovered panic crashes the entire k6 process, killing all VUs.
- Goroutines spawned from extension functions must be tied to `vu.Context()`. A goroutine that outlives the VU causes data races. Use `select { case <-ctx.Done(): return }`.
- Return `map[string]interface{}` or structs with exported fields from JS-facing functions. Go structs with unexported fields produce empty JS objects via Goja.
- Use `rt.ExportTo(jsValue, &goStruct)` to extract JS objects into Go structs. Do not type-assert `goja.Value` directly — it's fragile and misses Goja type coercion.
- Record custom metrics via `metrics.PushIfNotDone(ctx, state.Samples, sample)` — never write to metric objects directly from extension code. `PushIfNotDone` safely checks the context before writing.
- Register custom metrics in `NewModuleInstance` using `vu.InitEnv().Registry.MustNewMetric()`. Registering elsewhere causes race conditions or nil panics.
- `go.mod` must target Go 1.20+ (xk6 minimum requirement).
- After any Go code change, the custom k6 binary must be rebuilt with `xk6 build`.
