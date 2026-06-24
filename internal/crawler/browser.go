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

type browserCrawlArgs struct {
	BaseURL  string          `json:"baseUrl"`
	MaxDepth int             `json:"maxDepth"`
	MaxPages int             `json:"maxPages"`
	Auth     json.RawMessage `json:"auth,omitempty"`
}

func BrowserCrawl(ctx context.Context, cfg CrawlConfig) (*CrawlResult, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, fmt.Errorf("node not found — install Node.js")
	}

	scriptPath, err := findCrawlScript()
	if err != nil {
		return nil, err
	}

	args := browserCrawlArgs{
		BaseURL:  cfg.BaseURL,
		MaxDepth: cfg.MaxDepth,
		MaxPages: cfg.MaxPages,
	}
	if cfg.AuthJSON != "" {
		args.Auth = json.RawMessage(cfg.AuthJSON)
	}

	argsJSON, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("marshal crawl args: %w", err)
	}

	log.Printf("[crawler] authenticated browser crawl: %s (maxDepth=%d, maxPages=%d)", cfg.BaseURL, cfg.MaxDepth, cfg.MaxPages)

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
		return nil, fmt.Errorf("browser crawl failed: %s (stderr: %s)", err, stderr.String())
	}

	raw := bytes.TrimSpace(stdout.Bytes())
	if len(raw) == 0 {
		return &CrawlResult{URLs: []string{}}, nil
	}

	var urls []string
	if err := json.Unmarshal(raw, &urls); err != nil {
		return nil, fmt.Errorf("parse crawl results: %w (raw: %s)", err, string(raw))
	}

	isSPA, framework := DetectSPA(ctx, cfg.BaseURL)

	log.Printf("[crawler] discovered %d URLs", len(urls))
	return &CrawlResult{
		URLs:      urls,
		IsSPA:     isSPA,
		Framework: framework,
	}, nil
}

func findCrawlScript() (string, error) {
	candidates := []string{
		"scripts/crawl-authenticated.mjs",
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "scripts", "crawl-authenticated.mjs"))
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
	return "", fmt.Errorf("crawl-authenticated.mjs not found — run the server from the project root")
}
