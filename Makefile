.PHONY: setup dev dev-backend dev-frontend build clean test check

# ──────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────

setup: check
	@echo ""
	@echo "  Installing dependencies..."
	@echo ""
	@echo "  → Go modules"
	@go mod download
	@echo "  ✓ Go modules downloaded"
	@echo ""
	@echo "  → Playwright (recorder & browser crawler)"
	@npm install --no-save 2>/dev/null
	@echo "  ✓ Root node modules installed"
	@echo ""
	@echo "  → Playwright Chromium"
	@npx playwright install chromium 2>/dev/null
	@echo "  ✓ Chromium installed"
	@echo ""
	@echo "  → Frontend (React + Tailwind)"
	@cd frontend && npm install 2>/dev/null
	@echo "  ✓ Frontend dependencies installed"
	@echo ""
	@echo "  → Frontend Playwright test runner"
	@cd frontend && npx playwright install chromium 2>/dev/null
	@echo "  ✓ Test browser installed"
	@echo ""
	@echo "  → air (hot reload, optional)"
	@command -v air >/dev/null 2>&1 || (go install github.com/air-verse/air@latest 2>/dev/null && echo "  ✓ air installed" || echo "  ! air install failed — dev will use go run instead")
	@echo ""
	@echo "  Verifying build..."
	@go build ./...
	@echo "  ✓ Go build OK"
	@cd frontend && npm run build 2>/dev/null
	@echo "  ✓ Frontend build OK"
	@echo ""
	@echo "  ✅ Setup complete!"
	@echo ""
	@echo "  make dev     Start dev servers (backend + frontend)"
	@echo "  make build   Production build"
	@echo "  make test    Run e2e tests"
	@echo ""
	@echo "  Dev UI:      http://localhost:5173"
	@echo "  API:         http://localhost:8080"
	@echo ""

check:
	@echo ""
	@echo "  Web Vitals Load Tester"
	@echo "  ────────────────────────"
	@echo ""
	@command -v go   >/dev/null 2>&1 && echo "  ✓ Go: $$(go version | grep -oE 'go[0-9]+\.[0-9]+' | head -1)" || (echo "  ✗ Go not found — https://go.dev/dl/" && exit 1)
	@command -v node >/dev/null 2>&1 && echo "  ✓ Node: $$(node --version)"                                    || (echo "  ✗ Node not found — https://nodejs.org/" && exit 1)
	@command -v npm  >/dev/null 2>&1 && echo "  ✓ npm: $$(npm --version)"                                      || (echo "  ✗ npm not found" && exit 1)
	@command -v k6   >/dev/null 2>&1 && echo "  ✓ k6: $$(k6 version 2>&1 | head -1)"                           || echo "  ! k6 not installed — https://grafana.com/docs/k6/latest/set-up/install-k6/"
	@command -v air  >/dev/null 2>&1 && echo "  ✓ air: installed"                                               || echo "  ! air not installed — go install github.com/air-verse/air@latest"

# ──────────────────────────────────────────────
# Development
# ──────────────────────────────────────────────

dev:
	@echo "Starting backend + frontend..."
	@make dev-backend &
	@make dev-frontend

dev-backend:
	@mkdir -p tmp
	@if command -v air >/dev/null 2>&1; then \
		air; \
	else \
		echo "air not found, using go run (no hot reload)"; \
		go run ./cmd/server; \
	fi

dev-frontend:
	cd frontend && npm run dev

# ──────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────

build: build-frontend build-backend

build-frontend:
	cd frontend && npm run build

build-backend: embed-frontend
	go build -o bin/load-test ./cmd/server
	rm -rf cmd/server/dist

embed-frontend:
	rm -rf cmd/server/dist
	cp -r frontend/dist cmd/server/dist

# ──────────────────────────────────────────────
# Test
# ──────────────────────────────────────────────

test:
	cd frontend && npx playwright test e2e/full-flow.spec.ts --reporter=list

test-screenshots:
	cd frontend && npx playwright test e2e/screenshots.spec.ts --reporter=list

# ──────────────────────────────────────────────
# Clean
# ──────────────────────────────────────────────

clean:
	rm -rf bin/ frontend/dist/ tmp/ load-test.db
