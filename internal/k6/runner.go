package k6

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Stage struct {
	Duration string `json:"duration"`
	Target   int    `json:"target"`
}

type RunConfig struct {
	RunID      string
	URLs       []string
	Stages     []Stage
	ThinkTime  int
	AuthJSON   string
	ScriptPath string
}

type RunOutput struct {
	Metrics <-chan K6Output
	Logs    <-chan string
	Done    <-chan error
}

type Runner struct {
	k6Path     string
	scriptPath string

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewRunner(scriptPath string) (*Runner, error) {
	k6Path, err := FindK6()
	if err != nil {
		return nil, err
	}
	return &Runner{
		k6Path:     k6Path,
		scriptPath: scriptPath,
		cancels:    make(map[string]context.CancelFunc),
	}, nil
}

func (r *Runner) Start(ctx context.Context, cfg RunConfig) *RunOutput {
	outCh := make(chan K6Output, 256)
	logCh := make(chan string, 64)
	errCh := make(chan error, 1)

	runCtx, cancel := context.WithCancel(ctx)

	r.mu.Lock()
	r.cancels[cfg.RunID] = cancel
	r.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			r.mu.Lock()
			delete(r.cancels, cfg.RunID)
			r.mu.Unlock()
			close(outCh)
			close(logCh)
			close(errCh)
		}()

		urlsJSON, err := json.Marshal(cfg.URLs)
		if err != nil {
			errCh <- fmt.Errorf("marshal URLs: %w", err)
			return
		}

		stagesJSON, err := json.Marshal(cfg.Stages)
		if err != nil {
			errCh <- fmt.Errorf("marshal stages: %w", err)
			return
		}

		outFile, err := os.CreateTemp("", fmt.Sprintf("k6-%s-*.ndjson", cfg.RunID))
		if err != nil {
			errCh <- fmt.Errorf("create output file: %w", err)
			return
		}
		outPath := outFile.Name()
		outFile.Close()
		defer os.Remove(outPath)

		log.Printf("[k6] run %s: writing JSON output to %s", cfg.RunID, outPath)

		cmd := exec.CommandContext(runCtx, r.k6Path, "run",
			"--out", "json="+outPath,
			"--log-output=stderr",
			r.scriptPath,
		)
		env := os.Environ()
		env = append(env,
			"K6_BROWSER_ENABLED=true",
			"URLS_JSON="+string(urlsJSON),
			"STAGES_JSON="+string(stagesJSON),
			"THINK_TIME="+strconv.Itoa(cfg.ThinkTime),
		)
		if cfg.AuthJSON != "" {
			env = append(env, "AUTH_JSON="+cfg.AuthJSON)
		}
		cmd.Env = env
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

		stderrPipe, err := cmd.StderrPipe()
		if err != nil {
			errCh <- fmt.Errorf("stderr pipe: %w", err)
			return
		}

		log.Printf("[k6] run %s: cmd=%s %v", cfg.RunID, r.k6Path, cmd.Args[1:])

		if err := cmd.Start(); err != nil {
			errCh <- fmt.Errorf("start k6: %w", err)
			return
		}

		log.Printf("[k6] run %s: k6 started (pid %d)", cfg.RunID, cmd.Process.Pid)

		go func() {
			<-runCtx.Done()
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
		}()

		go streamStderr(runCtx, stderrPipe, logCh)

		f, err := os.Open(outPath)
		if err != nil {
			errCh <- fmt.Errorf("open output file: %w", err)
			return
		}
		defer f.Close()

		// Use a separate context for the file tailer so it keeps
		// reading after k6 exits but before we close channels.
		tailCtx, tailCancel := context.WithCancel(context.Background())
		tailDone := make(chan struct{})
		go func() {
			StreamOutput(tailCtx, f, outCh)
			close(tailDone)
		}()

		cmdErr := cmd.Wait()

		// k6 has exited — give the tailer time to drain remaining data
		time.Sleep(500 * time.Millisecond)
		tailCancel()
		<-tailDone

		log.Printf("[k6] run %s: file tailer drained", cfg.RunID)

		if cmdErr != nil && runCtx.Err() == nil {
			log.Printf("[k6] run %s: k6 exited with error: %v", cfg.RunID, cmdErr)
			errCh <- fmt.Errorf("k6 exited: %w", cmdErr)
		} else {
			log.Printf("[k6] run %s: k6 finished successfully", cfg.RunID)
		}
	}()

	return &RunOutput{
		Metrics: outCh,
		Logs:    logCh,
		Done:    errCh,
	}
}

func streamStderr(ctx context.Context, r io.Reader, ch chan<- string) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 64*1024)
	for scanner.Scan() {
		line := scanner.Text()
		log.Printf("[k6] %s", line)

		if shouldForwardLog(line) {
			select {
			case ch <- formatLogLine(line):
			case <-ctx.Done():
				return
			default:
			}
		}
	}
}

var reK6Log = regexp.MustCompile(`^time="[^"]*"\s+level=(\w+)\s+msg="(.*?)"`)

func formatLogLine(line string) string {
	m := reK6Log.FindStringSubmatch(line)
	if m == nil {
		return line
	}
	level := strings.ToUpper(m[1])
	msg := m[2]
	switch level {
	case "INFO":
		return msg
	default:
		return "[" + level + "] " + msg
	}
}

func shouldForwardLog(line string) bool {
	if strings.HasPrefix(line, "running (") {
		return false
	}
	if strings.HasPrefix(line, "web_vitals") {
		return false
	}
	if strings.Contains(line, "VUs") && strings.Contains(line, "iterations") {
		return false
	}
	// k6 banner lines
	if strings.Contains(line, "/‾‾/") || strings.Contains(line, `|‾‾|`) ||
		strings.Contains(line, `\_____/`) || strings.Contains(line, `(‾)`) {
		return false
	}
	if strings.TrimSpace(line) == "" {
		return false
	}
	return true
}

func (r *Runner) Stop(runID string) {
	r.mu.Lock()
	cancel, ok := r.cancels[runID]
	r.mu.Unlock()
	if ok {
		cancel()
	}
}

func FindK6() (string, error) {
	path, err := exec.LookPath("k6")
	if err != nil {
		return "", fmt.Errorf("k6 binary not found in PATH: install k6 from https://k6.io/docs/getting-started/installation/")
	}
	return path, nil
}
