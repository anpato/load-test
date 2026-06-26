package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
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

type interactiveSession struct {
	Status string          `json:"status"`
	URLs   []string        `json:"urls,omitempty"`
	Steps  []auth.LoginStep `json:"steps,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type Server struct {
	store    *store.Store
	runner   *k6.Runner
	hub      *Hub
	cancels  map[string]context.CancelFunc
	sessions map[string]*interactiveSession
	mu       sync.Mutex
}

func NewServer(s *store.Store, runner *k6.Runner) *Server {
	return &Server{
		store:    s,
		runner:   runner,
		hub:      NewHub(),
		cancels:  make(map[string]context.CancelFunc),
		sessions: make(map[string]*interactiveSession),
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
	Name   string         `json:"name,omitempty"`
	Tags   []string       `json:"tags,omitempty"`
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
		Name:      req.Name,
		Tags:      req.Tags,
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
		Headed:    req.Config.Headed,
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
					run.AppendLog(line)
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

		// Ensure every selected URL appears in results, even if
		// it was never reached during the test.
		for _, u := range req.URLs {
			existing := run.GetResults()
			if _, ok := existing[u]; !ok {
				run.UpdateResult(store.URLResult{URL: u})
			}
		}

		if doneErr != nil && ctx.Err() == nil {
			var tbErr *k6.ThresholdBreachedError
			if errors.As(doneErr, &tbErr) {
				run.SetStatus(store.StatusBreached)
				s.broadcastEvent(id, "status", map[string]any{
					"state": "breached",
				})
			} else {
				run.SetError(doneErr.Error())
				s.broadcastEvent(id, "status", map[string]any{
					"state": "error",
					"error": doneErr.Error(),
				})
			}
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
		case snap.Metric == "page_errors":
			ur.Errors = len(snap.Samples)
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

func (s *Server) HandleDeleteRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	s.mu.Lock()
	if cancel, ok := s.cancels[id]; ok {
		cancel()
		delete(s.cancels, id)
	}
	s.mu.Unlock()

	s.store.Delete(id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
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

	log.Printf("[api] interactive crawl: url=%s authJson=%d bytes", req.URL, len(req.AuthJSON))

	sessionID, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate session ID")
		return
	}
	s.mu.Lock()
	s.sessions[sessionID] = &interactiveSession{Status: "running"}
	s.mu.Unlock()

	go func() {
		urls, err := crawler.InteractiveCrawl(context.Background(), req.URL, req.AuthJSON)
		s.mu.Lock()
		defer s.mu.Unlock()
		sess := s.sessions[sessionID]
		if err != nil {
			sess.Status = "error"
			sess.Error = err.Error()
		} else {
			sess.Status = "done"
			sess.URLs = urls
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{
		"sessionId": sessionID,
	})
}

func (s *Server) HandleSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	sess, ok := s.sessions[id]
	s.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, sess)
	if sess.Status != "running" {
		s.mu.Lock()
		delete(s.sessions, id)
		s.mu.Unlock()
	}
}

func (s *Server) HandleRerun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	original, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	var override struct {
		AuthJSON *string  `json:"authJson,omitempty"`
		Name     *string  `json:"name,omitempty"`
		Tags     []string `json:"tags,omitempty"`
		Headed   *bool    `json:"headed,omitempty"`
	}
	_ = readJSON(r, &override)

	config := original.Config
	if override.AuthJSON != nil {
		config.AuthJSON = *override.AuthJSON
	}
	if override.Headed != nil {
		config.Headed = *override.Headed
	}

	name := original.Name
	if override.Name != nil {
		name = *override.Name
	}
	tags := original.Tags
	if override.Tags != nil {
		tags = override.Tags
	}

	req := createRunRequest{
		URLs:   original.URLs,
		Config: config,
		Name:   name,
		Tags:   tags,
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

	sessionID, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate session ID")
		return
	}
	s.mu.Lock()
	s.sessions[sessionID] = &interactiveSession{Status: "running"}
	s.mu.Unlock()

	go func() {
		steps, err := recorder.Record(context.Background(), req.LoginURL)
		s.mu.Lock()
		defer s.mu.Unlock()
		sess := s.sessions[sessionID]
		if err != nil {
			sess.Status = "error"
			sess.Error = err.Error()
		} else {
			sess.Status = "done"
			sess.Steps = steps
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{
		"sessionId": sessionID,
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
