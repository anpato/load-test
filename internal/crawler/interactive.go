package crawler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

type interactiveArgs struct {
	BaseURL string          `json:"baseUrl"`
	Auth    json.RawMessage `json:"auth,omitempty"`
}

func InteractiveCrawl(ctx context.Context, baseURL, authJSON string) ([]string, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, fmt.Errorf("node not found — install Node.js")
	}

	scriptPath, err := findInteractiveScript()
	if err != nil {
		return nil, err
	}

	args := interactiveArgs{BaseURL: baseURL}
	if authJSON != "" {
		args.Auth = json.RawMessage(authJSON)
	}

	argsJSON, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("marshal args: %w", err)
	}

	log.Printf("[crawler] interactive discovery: %s", baseURL)

	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, nodePath, scriptPath, string(argsJSON))
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()

	if stderr.Len() > 0 {
		log.Printf("[crawler] %s", stderr.String())
	}

	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("interactive crawl failed: %s", err)
	}

	raw := bytes.TrimSpace(stdout.Bytes())
	if len(raw) == 0 {
		return []string{}, nil
	}

	var urls []string
	if err := json.Unmarshal(raw, &urls); err != nil {
		return nil, fmt.Errorf("parse results: %w", err)
	}

	log.Printf("[crawler] interactive discovery captured %d routes", len(urls))
	return urls, nil
}

func findInteractiveScript() (string, error) {
	candidates := []string{
		"scripts/discover-interactive.mjs",
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "scripts", "discover-interactive.mjs"))
	}
	for _, p := range candidates {
		abs, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return abs, nil
		}
	}
	return "", fmt.Errorf("discover-interactive.mjs not found — run the server from the project root")
}
