---
name: go-k6-extensions
description: Building custom k6 extensions with xk6 in Go — module registration pattern (RootModule/NewModuleInstance/Exports), Go-to-JS type mapping via Goja runtime, wrapping Go clients as k6 modules, recording custom metrics from extension code, building custom k6 binaries with xk6 build, and extension testing. Use when writing or reviewing Go code in extensions/, building custom k6 binaries, debugging extension runtime errors, or bridging Go libraries into k6 scripts.
---

# Go k6 Extensions (xk6)

## Architecture

k6 uses Goja (a Go-native ECMAScript 5.1+ runtime). Extensions register Go functions/objects that become callable from JavaScript. `xk6 build` compiles a custom k6 binary with extensions baked in.

## Module Registration Pattern

Every xk6 extension follows this structure:

```go
package myext

import (
    "go.k6.io/k6/js/modules"
)

func init() {
    modules.Register("k6/x/myext", new(RootModule))
}

type RootModule struct{}

type MyExtension struct {
    vu modules.VU
}

func (*RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
    return &MyExtension{vu: vu}
}

func (e *MyExtension) Exports() modules.Exports {
    return modules.Exports{
        Named: map[string]interface{}{
            "doThing":   e.DoThing,
            "newClient": e.NewClient,
        },
    }
}
```

JS usage:
```js
import { doThing, newClient } from 'k6/x/myext';

export default function() {
    const client = newClient({ host: __ENV.TARGET_HOST });
    const result = doThing('payload');
}
```

## Go-to-JS Type Mapping (Goja)

| Go type | JS type | Notes |
|---|---|---|
| `string` | `string` | |
| `int`, `float64` | `number` | |
| `bool` | `boolean` | |
| `[]interface{}` | `Array` | |
| `map[string]interface{}` | `Object` | |
| `nil` | `null` | |
| `error` | thrown `Error` | via `common.Throw(rt, err)` |
| `goja.Value` | any | pass-through |

**Do NOT return Go structs with unexported fields** — Goja cannot reflect them and produces empty JS objects.

### Extracting JS Values in Go

```go
func (e *MyExtension) DoThing(call goja.FunctionCall) goja.Value {
    rt := e.vu.Runtime()

    // Extract a string argument
    arg := call.Argument(0).String()

    // Extract an object into a Go struct
    var config MyConfig
    if err := rt.ExportTo(call.Argument(0), &config); err != nil {
        common.Throw(rt, fmt.Errorf("invalid config: %w", err))
    }

    // Return a value
    return rt.ToValue(map[string]interface{}{
        "status": "ok",
        "count":  42,
    })
}
```

**Use `rt.ExportTo(opts, &config)`** to safely extract JS objects into Go structs. Do not type-assert `goja.Value` directly — it's fragile and misses type coercion.

## Wrapping a Go Client

Common pattern: expose an existing Go SDK/client to k6 scripts.

```go
type Client struct {
    inner *sdk.Client
    vu    modules.VU
}

func (e *MyExtension) NewClient(call goja.FunctionCall) goja.Value {
    rt := e.vu.Runtime()

    var config ClientConfig
    if err := rt.ExportTo(call.Argument(0), &config); err != nil {
        common.Throw(rt, err)
    }

    c, err := sdk.NewClient(config.Host, config.Token)
    if err != nil {
        common.Throw(rt, fmt.Errorf("failed to create client: %w", err))
    }

    return rt.ToValue(&Client{inner: c, vu: e.vu})
}

func (c *Client) Send(payload string) (map[string]interface{}, error) {
    ctx := c.vu.Context()
    result, err := c.inner.Send(ctx, payload)
    if err != nil {
        return nil, err
    }
    return map[string]interface{}{
        "id":     result.ID,
        "status": result.Status,
    }, nil
}
```

## Recording Custom Metrics from Extensions

```go
import (
    "go.k6.io/k6/metrics"
    "time"
)

func (c *Client) Send(payload string) {
    state := c.vu.State()
    ctx := c.vu.Context()

    start := time.Now()
    err := c.inner.Send(ctx, payload)
    duration := time.Since(start)

    metrics.PushIfNotDone(ctx, state.Samples, metrics.Sample{
        TimeSeries: metrics.TimeSeries{
            Metric: customDurationMetric, // pre-registered *metrics.Metric
            Tags:   state.Tags.GetCurrentValues().Tags,
        },
        Time:  time.Now(),
        Value: float64(duration.Milliseconds()),
    })

    if err != nil {
        common.Throw(c.vu.Runtime(), err)
    }
}
```

### Pre-registering Custom Metrics

```go
func (*RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
    m := &MyExtension{vu: vu}

    registry := vu.InitEnv().Registry
    m.duration = registry.MustNewMetric("myext_duration", metrics.Trend, metrics.Time)
    m.errors = registry.MustNewMetric("myext_errors", metrics.Counter, metrics.Default)

    return m
}
```

## Building the Custom Binary

```bash
# From local source
xk6 build --with github.com/yourorg/k6-ext-myext=./extensions/myext

# From remote module
xk6 build --with github.com/yourorg/k6-ext-myext@latest

# Specific k6 version
xk6 build v0.49.0 --with github.com/yourorg/k6-ext-myext=./extensions/myext
```

The output is a `k6` binary in the current directory. Use `./k6 run` instead of `k6 run` for scripts that import the extension.

**Rebuild after any Go change** — the extension is compiled into the binary.

## Testing Extensions

### Unit Tests (Go)

```go
func TestDoThing(t *testing.T) {
    // Test the Go logic directly, without k6 runtime
    result, err := doThingImpl("test-payload")
    require.NoError(t, err)
    assert.Equal(t, "expected", result.Status)
}
```

### Integration Tests (k6 script)

```js
// test-myext.js
import { doThing } from 'k6/x/myext';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'checks': ['rate==1'],
    },
};

export default function() {
    const result = doThing('test-payload');
    check(result, {
        'has status': (r) => r.status === 'ok',
        'has count': (r) => r.count === 42,
    });
}
```

Run with: `./k6 run test-myext.js`

## Pitfalls

| Issue | Consequence | Prevention |
|---|---|---|
| Unrecovered panic in exported function | Entire k6 process crashes | Use `common.Throw(rt, err)` or `defer func() { recover() }` |
| Goroutine outlives VU | Data race on cancelled context | Tie goroutine to `vu.Context()`: `select { case <-ctx.Done(): return }` |
| Returning struct with unexported fields | Empty JS object | Only export `map[string]interface{}` or structs with exported fields |
| Direct `goja.Value` type assertion | Fragile, misses coercion | Use `rt.ExportTo()` for structured extraction |
| `xk6 build` with Go < 1.20 | Build fails | Verify `go version` before building |
| Goroutine writing to `state.Samples` after context cancel | Panic in metrics engine | Always use `metrics.PushIfNotDone` (checks context) |
| Registering metrics outside `NewModuleInstance` | Race condition or nil registry | Register in `NewModuleInstance` using `vu.InitEnv().Registry` |
