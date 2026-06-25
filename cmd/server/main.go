package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/anpato/load-test/internal/api"
	"github.com/anpato/load-test/internal/k6"
	"github.com/anpato/load-test/internal/store"
)

func main() {
	port := flag.Int("port", 8080, "server port")
	scriptPath := flag.String("script", "scripts/web-vitals.js", "path to k6 script")
	flag.Parse()

	absScript, err := filepath.Abs(*scriptPath)
	if err != nil {
		log.Fatalf("cannot resolve script path: %v", err)
	}
	if _, err := os.Stat(absScript); os.IsNotExist(err) {
		log.Fatalf("k6 script not found at %s", absScript)
	}

	runner, err := k6.NewRunner(absScript)
	if err != nil {
		log.Fatalf("k6 setup failed: %v", err)
	}

	s, err := store.New("load-test.db")
	if err != nil {
		log.Fatalf("database setup failed: %v", err)
	}
	defer s.Close()

	server := api.NewServer(s, runner)
	handler := api.SetupRoutes(server, frontendFS())

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("starting server on %s", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
