package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/anpato/load-test/internal/k6"
	"github.com/anpato/load-test/internal/store"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	log.SetOutput(os.Stderr)

	scriptPath, _ := filepath.Abs("scripts/web-vitals.js")
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "k6 script not found at %s — run from the project root\n", scriptPath)
		os.Exit(1)
	}

	runner, err := k6.NewRunner(scriptPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "k6 setup failed: %v\n", err)
		os.Exit(1)
	}

	s, err := store.New("load-test.db")
	if err != nil {
		fmt.Fprintf(os.Stderr, "database setup failed: %v\n", err)
		os.Exit(1)
	}
	defer s.Close()

	srv := server.NewMCPServer(
		"load-test",
		"1.0.0",
		server.WithToolCapabilities(false),
	)

	srv.AddTool(startRunTool(), mcp.NewTypedToolHandler(startRunHandler(s, runner)))
	srv.AddTool(getRunTool(), mcp.NewTypedToolHandler(getRunHandler(s)))
	srv.AddTool(listRunsTool(), mcp.NewTypedToolHandler(listRunsHandler(s)))
	srv.AddTool(compareRunsTool(), mcp.NewTypedToolHandler(compareRunsHandler(s)))
	srv.AddTool(waitForRunTool(), mcp.NewTypedToolHandler(waitForRunHandler(s)))

	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}

// --- start_run ---

type StartRunArgs struct {
	URLs      []string `json:"urls"`
	TestType  string   `json:"test_type"`
	VUs       int      `json:"vus"`
	ThinkTime int      `json:"think_time"`
	AuthJSON  string   `json:"auth_json"`
}

func startRunTool() mcp.Tool {
	return mcp.NewTool("start_run",
		mcp.WithDescription("Start a k6 web vitals load test against the given URLs. Returns a run ID to poll with get_run or wait_for_run."),
		mcp.WithArray("urls",
			mcp.Required(),
			mcp.Description("Full URLs to test (e.g. https://wwwdev.legalzoom.com/my)"),
			mcp.Items(map[string]any{"type": "string"}),
		),
		mcp.WithString("test_type",
			mcp.Description("Test preset: smoke, load, stress, soak. Default: smoke"),
		),
		mcp.WithNumber("vus",
			mcp.Description("Number of virtual users. Default: 1"),
		),
		mcp.WithNumber("think_time",
			mcp.Description("Think time in seconds between iterations. Default: 2"),
		),
		mcp.WithString("auth_json",
			mcp.Description("JSON auth config for cookie/bearer/header authentication"),
		),
	)
}

var presetStages = map[string][]k6.Stage{
	"smoke":  {{Duration: "15s", Target: 1}, {Duration: "45s", Target: 1}, {Duration: "15s", Target: 0}},
	"load":   {{Duration: "1m", Target: 5}, {Duration: "5m", Target: 5}, {Duration: "30s", Target: 0}},
	"stress": {{Duration: "1m", Target: 5}, {Duration: "3m", Target: 10}, {Duration: "2m", Target: 10}, {Duration: "30s", Target: 0}},
	"soak":   {{Duration: "1m", Target: 3}, {Duration: "30m", Target: 3}, {Duration: "30s", Target: 0}},
}

func startRunHandler(s *store.Store, runner *k6.Runner) func(context.Context, mcp.CallToolRequest, StartRunArgs) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req mcp.CallToolRequest, args StartRunArgs) (*mcp.CallToolResult, error) {
		if len(args.URLs) == 0 {
			return mcp.NewToolResultError("urls is required"), nil
		}

		testType := args.TestType
		if testType == "" {
			testType = "smoke"
		}
		preset, ok := presetStages[testType]
		if !ok {
			return mcp.NewToolResultError(fmt.Sprintf("unknown test_type: %s (use smoke, load, stress, soak)", testType)), nil
		}
		stages := make([]k6.Stage, len(preset))
		copy(stages, preset)

		vus := args.VUs
		if vus <= 0 {
			vus = 1
		}
		for i := range stages {
			if stages[i].Target > 0 {
				stages[i].Target = vus
			}
		}

		thinkTime := args.ThinkTime
		if thinkTime <= 0 {
			thinkTime = 2
		}

		id := generateID()
		run := &store.Run{
			ID:     id,
			Status: store.StatusPending,
			URLs:   args.URLs,
			Config: store.RunConfig{
				VUs:       vus,
				Stages:    toStoreStages(stages),
				ThinkTime: thinkTime,
				TestType:  testType,
				AuthJSON:  args.AuthJSON,
			},
			StartedAt: time.Now(),
		}
		s.Create(run)

		runCfg := k6.RunConfig{
			RunID:     id,
			URLs:      args.URLs,
			Stages:    stages,
			ThinkTime: thinkTime,
			AuthJSON:  args.AuthJSON,
		}

		go executeRun(s, runner, run, runCfg)

		return mcp.NewToolResultText(fmt.Sprintf(`{"runId":"%s","status":"started","testType":"%s","vus":%d,"urls":%d}`, id, testType, vus, len(args.URLs))), nil
	}
}

func executeRun(s *store.Store, runner *k6.Runner, run *store.Run, cfg k6.RunConfig) {
	ctx := context.Background()
	run.SetStatus(store.StatusRunning)

	result := runner.Start(ctx, cfg)
	agg := k6.NewAggregator()

	metricsCh := result.Metrics
	logsCh := result.Logs
	doneCh := result.Done
	var doneErr error

	for metricsCh != nil || logsCh != nil || doneCh != nil {
		select {
		case output, ok := <-metricsCh:
			if !ok {
				metricsCh = nil
			} else {
				url := output.Data.Tags["url"]
				agg.Add(url, output.Metric, output.Data.Value)
			}
		case _, ok := <-logsCh:
			if !ok {
				logsCh = nil
			}
		case err, ok := <-doneCh:
			if ok && err != nil {
				doneErr = err
			}
			doneCh = nil
		}
	}

	finalSnapshots := agg.Snapshot()
	for _, snap := range snapshotsToResults(finalSnapshots) {
		run.UpdateResult(snap)
	}

	if doneErr != nil {
		run.SetError(doneErr.Error())
	} else {
		run.SetStatus(store.StatusFinished)
	}
	s.Save(run)
	s.Deactivate(cfg.RunID)
}

func snapshotsToResults(snapshots []k6.MetricSnapshot) []store.URLResult {
	byURL := make(map[string]*store.URLResult)
	for _, snap := range snapshots {
		ur, ok := byURL[snap.URL]
		if !ok {
			ur = &store.URLResult{URL: snap.URL}
			byURL[snap.URL] = ur
		}
		vm := store.VitalMetrics{
			Samples: snap.Samples,
			P50:     snap.P50,
			P75:     snap.P75,
			P95:     snap.P95,
			Min:     snap.Min,
			Max:     snap.Max,
		}
		switch {
		case strings.Contains(snap.Metric, "lcp"):
			ur.LCP = vm
		case strings.Contains(snap.Metric, "fcp"):
			ur.FCP = vm
		case strings.Contains(snap.Metric, "cls"):
			ur.CLS = vm
		case strings.Contains(snap.Metric, "ttfb"):
			ur.TTFB = vm
		}
	}
	results := make([]store.URLResult, 0, len(byURL))
	for _, ur := range byURL {
		results = append(results, *ur)
	}
	return results
}

// --- get_run ---

type GetRunArgs struct {
	RunID string `json:"run_id"`
}

func getRunTool() mcp.Tool {
	return mcp.NewTool("get_run",
		mcp.WithDescription("Get the status and results of a load test run."),
		mcp.WithString("run_id",
			mcp.Required(),
			mcp.Description("The run ID returned by start_run"),
		),
	)
}

func getRunHandler(s *store.Store) func(context.Context, mcp.CallToolRequest, GetRunArgs) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req mcp.CallToolRequest, args GetRunArgs) (*mcp.CallToolResult, error) {
		run, ok := s.Get(args.RunID)
		if !ok {
			return mcp.NewToolResultError("run not found"), nil
		}
		data, _ := json.Marshal(run)
		return mcp.NewToolResultText(string(data)), nil
	}
}

// --- wait_for_run ---

type WaitForRunArgs struct {
	RunID string `json:"run_id"`
}

func waitForRunTool() mcp.Tool {
	return mcp.NewTool("wait_for_run",
		mcp.WithDescription("Wait for a load test run to finish and return the results. Blocks until the run completes (up to 10 minutes)."),
		mcp.WithString("run_id",
			mcp.Required(),
			mcp.Description("The run ID returned by start_run"),
		),
	)
}

func waitForRunHandler(s *store.Store) func(context.Context, mcp.CallToolRequest, WaitForRunArgs) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req mcp.CallToolRequest, args WaitForRunArgs) (*mcp.CallToolResult, error) {
		deadline := time.After(10 * time.Minute)
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-deadline:
				return mcp.NewToolResultError("timed out waiting for run to complete"), nil
			case <-ctx.Done():
				return mcp.NewToolResultError("cancelled"), nil
			case <-ticker.C:
				run, ok := s.Get(args.RunID)
				if !ok {
					return mcp.NewToolResultError("run not found"), nil
				}
				status := run.GetStatus()
				if status == store.StatusFinished || status == store.StatusError {
					data, _ := json.Marshal(run)
					return mcp.NewToolResultText(string(data)), nil
				}
			}
		}
	}
}

// --- list_runs ---

type ListRunsArgs struct {
	Limit int `json:"limit"`
}

func listRunsTool() mcp.Tool {
	return mcp.NewTool("list_runs",
		mcp.WithDescription("List recent load test runs with their status, URLs, and test config."),
		mcp.WithNumber("limit",
			mcp.Description("Max number of runs to return. Default: 10"),
		),
	)
}

func listRunsHandler(s *store.Store) func(context.Context, mcp.CallToolRequest, ListRunsArgs) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req mcp.CallToolRequest, args ListRunsArgs) (*mcp.CallToolResult, error) {
		runs := s.List()
		limit := args.Limit
		if limit <= 0 {
			limit = 10
		}
		if len(runs) > limit {
			runs = runs[:limit]
		}

		type summary struct {
			ID        string    `json:"id"`
			Status    string    `json:"status"`
			URLs      int       `json:"urls"`
			TestType  string    `json:"testType"`
			Host      string    `json:"host"`
			StartedAt time.Time `json:"startedAt"`
			Error     string    `json:"error,omitempty"`
		}
		out := make([]summary, len(runs))
		for i, r := range runs {
			host := ""
			if len(r.URLs) > 0 {
				parts := strings.SplitN(r.URLs[0], "/", 4)
				if len(parts) >= 3 {
					host = parts[2]
				}
			}
			out[i] = summary{
				ID:        r.ID,
				Status:    string(r.Status),
				URLs:      len(r.URLs),
				TestType:  r.Config.TestType,
				Host:      host,
				StartedAt: r.StartedAt,
				Error:     r.Error,
			}
		}
		data, _ := json.Marshal(out)
		return mcp.NewToolResultText(string(data)), nil
	}
}

// --- compare_runs ---

type CompareRunsArgs struct {
	RunA string `json:"run_a"`
	RunB string `json:"run_b"`
}

func compareRunsTool() mcp.Tool {
	return mcp.NewTool("compare_runs",
		mcp.WithDescription("Compare two load test runs side by side. Matches routes by path (works across different hosts). Returns per-route deltas for LCP, FCP, CLS, TTFB."),
		mcp.WithString("run_a",
			mcp.Required(),
			mcp.Description("Baseline run ID"),
		),
		mcp.WithString("run_b",
			mcp.Required(),
			mcp.Description("Comparison run ID"),
		),
	)
}

func compareRunsHandler(s *store.Store) func(context.Context, mcp.CallToolRequest, CompareRunsArgs) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req mcp.CallToolRequest, args CompareRunsArgs) (*mcp.CallToolResult, error) {
		runA, ok := s.Get(args.RunA)
		if !ok {
			return mcp.NewToolResultError("run_a not found"), nil
		}
		runB, ok := s.Get(args.RunB)
		if !ok {
			return mcp.NewToolResultError("run_b not found"), nil
		}

		type vitalDelta struct {
			Baseline   *float64 `json:"baseline"`
			Comparison *float64 `json:"comparison"`
			Delta      *float64 `json:"delta,omitempty"`
		}
		type routeComparison struct {
			Path string                `json:"path"`
			LCP  vitalDelta            `json:"lcp"`
			FCP  vitalDelta            `json:"fcp"`
			CLS  vitalDelta            `json:"cls"`
			TTFB vitalDelta            `json:"ttfb"`
		}

		urlPath := func(url string) string {
			parts := strings.SplitN(url, "/", 4)
			if len(parts) >= 4 {
				return "/" + parts[3]
			}
			return "/"
		}

		indexA := make(map[string]store.URLResult)
		indexB := make(map[string]store.URLResult)
		if runA.Results != nil {
			for url, r := range runA.Results {
				indexA[urlPath(url)] = r
			}
		}
		if runB.Results != nil {
			for url, r := range runB.Results {
				indexB[urlPath(url)] = r
			}
		}

		paths := make(map[string]bool)
		for p := range indexA { paths[p] = true }
		for p := range indexB { paths[p] = true }

		makeVD := func(a, b *store.URLResult, get func(store.URLResult) float64) vitalDelta {
			vd := vitalDelta{}
			if a != nil { v := get(*a); vd.Baseline = &v }
			if b != nil { v := get(*b); vd.Comparison = &v }
			if vd.Baseline != nil && vd.Comparison != nil {
				d := *vd.Comparison - *vd.Baseline
				vd.Delta = &d
			}
			return vd
		}

		var routes []routeComparison
		for p := range paths {
			a, hasA := indexA[p]
			b, hasB := indexB[p]
			var ap, bp *store.URLResult
			if hasA { ap = &a }
			if hasB { bp = &b }
			routes = append(routes, routeComparison{
				Path: p,
				LCP:  makeVD(ap, bp, func(r store.URLResult) float64 { return r.LCP.P75 }),
				FCP:  makeVD(ap, bp, func(r store.URLResult) float64 { return r.FCP.P75 }),
				CLS:  makeVD(ap, bp, func(r store.URLResult) float64 { return r.CLS.P75 }),
				TTFB: makeVD(ap, bp, func(r store.URLResult) float64 { return r.TTFB.P75 }),
			})
		}

		result := map[string]any{
			"baseline":   map[string]any{"id": runA.ID, "host": hostFromURLs(runA.URLs)},
			"comparison": map[string]any{"id": runB.ID, "host": hostFromURLs(runB.URLs)},
			"routes":     routes,
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(data)), nil
	}
}

func hostFromURLs(urls []string) string {
	if len(urls) == 0 {
		return ""
	}
	parts := strings.SplitN(urls[0], "/", 4)
	if len(parts) >= 3 {
		return parts[2]
	}
	return ""
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func toStoreStages(stages []k6.Stage) []store.Stage {
	out := make([]store.Stage, len(stages))
	for i, s := range stages {
		out[i] = store.Stage{Duration: s.Duration, Target: s.Target}
	}
	return out
}
