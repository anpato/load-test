# Web Vitals Load Tester

A load testing tool for measuring Core Web Vitals (LCP, FCP, CLS, TTFB) across your web application. Built with a Go backend, React frontend, and k6 browser module for real browser-based measurements.

## How It Works

1. **Discover routes** -- crawl a site automatically (with auth support), browse interactively, or enter routes manually
2. **Configure the test** -- set virtual users, duration, ramp stages, and think time
3. **Run** -- k6 launches headless Chromium instances that navigate each URL and collect Web Vitals via the Performance Observer API
4. **Monitor** -- live dashboard streams metrics over WebSocket as the test runs
5. **Review** -- results are persisted to SQLite with p50/p75/p95 breakdowns per URL

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| [Go](https://go.dev/dl/) 1.22+ | Yes | Backend |
| [Node.js](https://nodejs.org/) 18+ | Yes | Playwright scripts, frontend build |
| [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) | Yes | Test runner |
| [air](https://github.com/air-verse/air) | No | Hot reload for dev |

## Quick Start

```bash
# Install all dependencies (Go modules, Node packages, Playwright Chromium)
make setup

# Start dev servers (backend :8080 + frontend :5173)
make dev
```

Open http://localhost:5173.

## Production Build

`make build` produces a single self-contained binary at `bin/load-test` with the React frontend embedded.

```bash
make build
./bin/load-test                     # serves UI + API on :8080
./bin/load-test -port 3000          # custom port
./bin/load-test -script path/to.js  # custom k6 script
```

## Project Structure

```
cmd/server/          Go entry point, embedded frontend
internal/
  api/               REST handlers, WebSocket hub, routing
  auth/              Auth config types (cookie, bearer, headers)
  crawler/           Route discovery (HTML crawl, sitemap, Playwright browser)
  k6/                k6 runner, NDJSON parser, metric aggregator
  recorder/          Login step recorder (Playwright)
  routes/            Route pattern expansion
  store/             SQLite persistence
scripts/
  web-vitals.js      k6 browser test script (the actual load test)
  crawl-authenticated.mjs   Headless site crawler with auth
  discover-interactive.mjs  Interactive browser-based route discovery
  record-login.mjs          Login flow recorder
frontend/            React + Tailwind + Recharts UI
```

## Route Discovery Methods

| Method | How it works |
|--------|-------------|
| **Auto crawl** | Fetches HTML, parses links, optionally checks sitemap.xml. Supports authenticated crawl via cookies/bearer/headers. |
| **Interactive** | Opens a real browser window -- browse around your site, close the tab when done. Captures SPA navigation (pushState/replaceState). |
| **Manual** | Enter URL patterns directly (e.g. `/users/:id`) with parameter values for expansion. |

## Auth Support

The tool supports three auth modes for both crawling and load testing:

- **Cookie** -- Records login form interactions, replays them to establish a session
- **Bearer** -- Injects an `Authorization: Bearer <token>` header
- **Custom headers** -- Passes arbitrary headers with each request

## Metrics Collected

| Metric | k6 Name | Description |
|--------|---------|-------------|
| Largest Contentful Paint | `custom_lcp` | Time until the largest visible element renders |
| First Contentful Paint | `custom_fcp` | Time until the first text/image renders |
| Cumulative Layout Shift | `custom_cls` | Visual stability score (lower is better) |
| Time to First Byte | `custom_ttfb` | Server response time |
| Page Errors | `page_errors` | JavaScript error count |
| Success Rate | `page_success_rate` | Percentage of pages that loaded without errors |

## Make Targets

| Target | Description |
|--------|-------------|
| `make setup` | Install all dependencies and verify the build |
| `make dev` | Start backend + frontend dev servers |
| `make build` | Production build (single binary with embedded frontend) |
| `make test` | Run E2E tests |
| `make test-screenshots` | Capture UI screenshots across viewports |
| `make clean` | Remove build artifacts and database |
| `make check` | Verify required tools are installed |

## Configuration

The k6 test is configured entirely through the UI. Under the hood, the Go backend passes configuration to k6 via environment variables:

| Variable | Description |
|----------|-------------|
| `URLS_JSON` | JSON array of target URLs |
| `STAGES_JSON` | k6 ramping-vus stage definitions |
| `AUTH_JSON` | Auth configuration object |
| `THINK_TIME` | Seconds between page visits per VU |
| `K6_BROWSER_ENABLED` | Always set to `true` by the runner |

## License

MIT
