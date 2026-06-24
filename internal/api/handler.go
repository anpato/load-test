package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/anpato/load-test/internal/auth"
	"github.com/anpato/load-test/internal/crawler"
	"github.com/anpato/load-test/internal/k6"
	"github.com/anpato/load-test/internal/recorder"
	"github.com/anpato/load-test/internal/routes"
	"github.com/anpato/load-test/internal/store"
)

type Server struct {
	store   *store.Store
	runner  *k6.Runner
	hub     *Hub
	cancels map[string]context.CancelFunc
	mu      sync.Mutex
}

func NewServer(s *store.Store, runner *k6.Runner) *Server {
	return &Server{
		store:   s,
		runner:  runner,
		hub:     NewHub(),
		cancels: make(map[string]context.CancelFunc),
	}
}

func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type crawlRequest struct {
	URL      string `json:"url"`
	MaxDepth int    `json:"maxDepth"`
	MaxPages int    `json:"maxPages"`
	AuthJSON string `json:"authJson,omitempty"`
}

type crawlResponse struct {
	URLs      []string `json:"urls"`
	IsSPA     bool     `json:"isSPA"`
	Framework string   `json:"framework"`
}

func (s *Server) HandleCrawl(w http.ResponseWriter, r *http.Request) {
	var req crawlRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := crawler.Crawl(r.Context(), crawler.CrawlConfig{
		BaseURL:  req.URL,
		MaxDepth: req.MaxDepth,
		MaxPages: req.MaxPages,
		AuthJSON: req.AuthJSON,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, crawlResponse{
		URLs:      result.URLs,
		IsSPA:     result.IsSPA,
		Framework: result.Framework,
	})
}

func (s *Server) HandleExpandRoutes(w http.ResponseWriter, r *http.Request) {
	var req routes.ManualRoutesRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp, err := routes.ExpandRoutes(req.BaseURL, req.Routes, 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

type createRunRequest struct {
	URLs   []string       `json:"urls"`
	Config store.RunConfig `json:"config"`
}

type createRunResponse struct {
	RunID string `json:"runId"`
}

func (s *Server) HandleCreateRun(w http.ResponseWriter, r *http.Request) {
	var req createRunRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.startRun(w, req)
}

func (s *Server) startRun(w http.ResponseWriter, req createRunRequest) {
	id, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	run := &store.Run{
		ID:        id,
		Status:    store.StatusPending,
		URLs:      req.URLs,
		Config:    req.Config,
		StartedAt: time.Now(),
	}
	s.store.Create(run)

	var authJSON string
	if req.Config.AuthJSON != "" {
		var cfg auth.AuthConfig
		if err := json.Unmarshal([]byte(req.Config.AuthJSON), &cfg); err != nil {
			writeError(w, http.StatusBadRequest, "invalid auth config: "+err.Error())
			return
		}
		if err := auth.Validate(&cfg); err != nil {
			writeError(w, http.StatusBadRequest, "invalid auth config: "+err.Error())
			return
		}
		authJSON = req.Config.AuthJSON
	}

	k6Stages := make([]k6.Stage, len(req.Config.Stages))
	for i, st := range req.Config.Stages {
		k6Stages[i] = k6.Stage{
			Duration: st.Duration,
			Target:   st.Target,
		}
	}

	runCfg := k6.RunConfig{
		RunID:     id,
		URLs:      req.URLs,
		Stages:    k6Stages,
		ThinkTime: req.Config.ThinkTime,
		AuthJSON:  authJSON,
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancels[id] = cancel
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.cancels, id)
			s.mu.Unlock()
			cancel()
		}()

		run.SetStatus(store.StatusRunning)

		result := s.runner.Start(ctx, runCfg)

		s.broadcastEvent(id, "status", map[string]any{
			"state": "running",
			"urls":  req.URLs,
		})

		agg := k6.NewAggregator()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		metricsCh := result.Metrics
		logsCh := result.Logs
		doneCh := result.Done

		var doneErr error
		running := true

		for running {
			select {
			case output, ok := <-metricsCh:
				if !ok {
					metricsCh = nil
				} else {
					url := output.Data.Tags["url"]
					agg.Add(url, output.Metric, output.Data.Value)
				}
			case line, ok := <-logsCh:
				if !ok {
					logsCh = nil
				} else {
					s.broadcastEvent(id, "log", map[string]any{
						"message": line,
					})
				}
			case err, ok := <-doneCh:
				if ok && err != nil {
					doneErr = err
				}
				doneCh = nil
			case <-ticker.C:
				snapshots := agg.Snapshot()
				if len(snapshots) > 0 {
					if data, err := json.Marshal(map[string]any{
						"type":      "metrics",
						"snapshots": snapshots,
					}); err == nil {
						s.hub.Broadcast(id, data)
					}
				}
			}

			if metricsCh == nil && logsCh == nil && doneCh == nil {
				running = false
			}
		}

		// Final drain — build run results from all accumulated data
		finalSnapshots := agg.Snapshot()
		if len(finalSnapshots) > 0 {
			if data, err := json.Marshal(map[string]any{
				"type":      "metrics",
				"snapshots": finalSnapshots,
			}); err == nil {
				s.hub.Broadcast(id, data)
			}

			urlResults := snapshotsToResults(finalSnapshots)
			for _, ur := range urlResults {
				run.UpdateResult(ur)
			}
		}

		if doneErr != nil && ctx.Err() == nil {
			run.SetError(doneErr.Error())
			s.broadcastEvent(id, "status", map[string]any{
				"state": "error",
				"error": doneErr.Error(),
			})
		} else {
			run.SetStatus(store.StatusFinished)
			s.broadcastEvent(id, "status", map[string]any{
				"state": "finished",
			})
		}

		s.store.Save(run)
		s.store.Deactivate(id)
		s.hub.CleanupRun(id)
	}()

	writeJSON(w, http.StatusAccepted, createRunResponse{RunID: id})
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

func (s *Server) broadcastEvent(runID, eventType string, payload map[string]any) {
	payload["type"] = eventType
	if data, err := json.Marshal(payload); err == nil {
		s.hub.Broadcast(runID, data)
	}
}

func (s *Server) HandleGetRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) HandleStopRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	cancel, ok := s.cancels[id]
	s.mu.Unlock()

	if !ok {
		writeError(w, http.StatusNotFound, "run not found or already stopped")
		return
	}

	cancel()
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (s *Server) HandleListRuns(w http.ResponseWriter, r *http.Request) {
	runs := s.store.List()
	if runs == nil {
		runs = []*store.Run{}
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) HandleInteractiveCrawl(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL      string `json:"url"`
		AuthJSON string `json:"authJson,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	urls, err := crawler.InteractiveCrawl(r.Context(), req.URL, req.AuthJSON)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"urls": urls,
	})
}

func (s *Server) HandleRerun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	original, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	req := createRunRequest{
		URLs:   original.URLs,
		Config: original.Config,
	}

	s.startRun(w, req)
}

func (s *Server) HandleRecordLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LoginURL string `json:"loginUrl"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.LoginURL == "" {
		writeError(w, http.StatusBadRequest, "loginUrl is required")
		return
	}

	steps, err := recorder.Record(r.Context(), req.LoginURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"steps":    steps,
		"loginUrl": req.LoginURL,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
