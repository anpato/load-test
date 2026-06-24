package api

import (
	"log"
	"net/http"
	"strings"
	"time"
)

func SetupRoutes(server *Server) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/crawl", server.HandleCrawl)
	mux.HandleFunc("POST /api/routes/expand", server.HandleExpandRoutes)
	mux.HandleFunc("POST /api/runs", server.HandleCreateRun)
	mux.HandleFunc("GET /api/runs", server.HandleListRuns)
	mux.HandleFunc("GET /api/runs/{id}", server.HandleGetRun)
	mux.HandleFunc("DELETE /api/runs/{id}", server.HandleStopRun)
	mux.HandleFunc("POST /api/runs/{id}/rerun", server.HandleRerun)
	mux.HandleFunc("POST /api/crawl/interactive", server.HandleInteractiveCrawl)
	mux.HandleFunc("POST /api/auth/record", server.HandleRecordLogin)

	// WebSocket handler bypasses CORS/logging middleware since
	// responseCapture doesn't implement http.Hijacker.
	outer := http.NewServeMux()
	outer.Handle("GET /api/runs/{id}/ws", http.HandlerFunc(server.HandleWebSocket))
	outer.Handle("/", loggingMiddleware(corsMiddleware(mux)))

	return outer
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type responseCapture struct {
	http.ResponseWriter
	status int
}

func (rc *responseCapture) WriteHeader(code int) {
	rc.status = code
	rc.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rc := &responseCapture{ResponseWriter: w, status: 200}
		next.ServeHTTP(rc, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rc.status, time.Since(start).Round(time.Millisecond))
	})
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	allowed := []string{
		"http://localhost",
		"https://localhost",
		"http://127.0.0.1",
		"https://127.0.0.1",
	}
	for _, prefix := range allowed {
		if strings.HasPrefix(origin, prefix) {
			return true
		}
	}
	return false
}
