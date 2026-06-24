package recorder

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/anpato/load-test/internal/auth"
)

func Record(ctx context.Context, loginURL string) ([]auth.LoginStep, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, fmt.Errorf("node not found — install Node.js")
	}

	scriptPath, err := findRecordScript()
	if err != nil {
		return nil, err
	}

	log.Printf("[recorder] launching: node %s %s", scriptPath, loginURL)

	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, nodePath, scriptPath, loginURL)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()

	if stderr.Len() > 0 {
		log.Printf("[recorder] stderr: %s", stderr.String())
	}

	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("recorder failed: %s (stderr: %s)", err, stderr.String())
	}

	raw := bytes.TrimSpace(stdout.Bytes())
	log.Printf("[recorder] stdout (%d bytes): %s", len(raw), string(raw))

	if len(raw) == 0 {
		return nil, fmt.Errorf("recorder produced no output")
	}

	var steps []auth.LoginStep
	if err := json.Unmarshal(raw, &steps); err != nil {
		return nil, fmt.Errorf("failed to parse recorded steps: %w (raw: %s)", err, string(raw))
	}

	log.Printf("[recorder] captured %d steps", len(steps))
	return steps, nil
}

func findRecordScript() (string, error) {
	candidates := []string{
		"scripts/record-login.mjs",
	}

	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "scripts", "record-login.mjs"))
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

	return "", fmt.Errorf("record-login.mjs not found — run the server from the project root")
}
