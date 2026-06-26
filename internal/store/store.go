package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type RunStatus string

const (
	StatusPending  RunStatus = "pending"
	StatusRunning  RunStatus = "running"
	StatusFinished RunStatus = "finished"
	StatusBreached RunStatus = "breached"
	StatusError    RunStatus = "error"
)

type VitalMetrics struct {
	Samples []float64 `json:"samples"`
	P50     float64   `json:"p50"`
	P75     float64   `json:"p75"`
	P95     float64   `json:"p95"`
	Min     float64   `json:"min"`
	Max     float64   `json:"max"`
}

type URLResult struct {
	URL    string       `json:"url"`
	LCP    VitalMetrics `json:"lcp"`
	FCP    VitalMetrics `json:"fcp"`
	CLS    VitalMetrics `json:"cls"`
	TTFB   VitalMetrics `json:"ttfb"`
	Errors int          `json:"errors"`
}

type Run struct {
	ID        string               `json:"id"`
	Status    RunStatus            `json:"status"`
	Name      string               `json:"name,omitempty"`
	Tags      []string             `json:"tags,omitempty"`
	URLs      []string             `json:"urls"`
	Config    RunConfig            `json:"config"`
	Results   map[string]URLResult `json:"results"`
	Logs      []string             `json:"logs,omitempty"`
	Error     string               `json:"error,omitempty"`
	StartedAt time.Time            `json:"startedAt"`
	EndedAt   *time.Time           `json:"endedAt,omitempty"`

	mu sync.RWMutex
}

type RunConfig struct {
	VUs       int    `json:"vus"`
	Duration  string `json:"duration"`
	Stages    []Stage `json:"stages"`
	ThinkTime int    `json:"thinkTime"`
	TestType  string `json:"testType"`
	AuthJSON  string `json:"authJson,omitempty"`
}

type Stage struct {
	Duration string `json:"duration"`
	Target   int    `json:"target"`
}

type Store struct {
	db     *sql.DB
	active sync.Map
}

func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}

	log.Printf("[store] opened database at %s", dbPath)
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS runs (
			id         TEXT PRIMARY KEY,
			status     TEXT NOT NULL,
			urls       TEXT NOT NULL,
			config     TEXT NOT NULL,
			results    TEXT,
			error      TEXT,
			started_at TEXT NOT NULL,
			ended_at   TEXT,
			name       TEXT NOT NULL DEFAULT '',
			tags       TEXT NOT NULL DEFAULT '[]',
			logs       TEXT NOT NULL DEFAULT '[]'
		)
	`)
	if err != nil {
		return err
	}

	for _, col := range []struct{ name, def string }{
		{"name", "TEXT NOT NULL DEFAULT ''"},
		{"tags", "TEXT NOT NULL DEFAULT '[]'"},
		{"logs", "TEXT NOT NULL DEFAULT '[]'"},
	} {
		db.Exec("ALTER TABLE runs ADD COLUMN " + col.name + " " + col.def)
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Create(run *Run) {
	s.active.Store(run.ID, run)
	s.persist(run)
}

func (s *Store) Get(id string) (*Run, bool) {
	if v, ok := s.active.Load(id); ok {
		return v.(*Run), true
	}
	return s.loadFromDB(id)
}

func (s *Store) Delete(id string) {
	s.active.Delete(id)
	s.db.Exec("DELETE FROM runs WHERE id = ?", id)
}

func (s *Store) List() []*Run {
	rows, err := s.db.Query("SELECT id, status, urls, config, results, error, started_at, ended_at, name, tags, logs FROM runs ORDER BY started_at DESC")
	if err != nil {
		log.Printf("[store] list query error: %v", err)
		return nil
	}
	defer rows.Close()

	var runs []*Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			log.Printf("[store] scan error: %v", err)
			continue
		}
		if v, ok := s.active.Load(run.ID); ok {
			runs = append(runs, v.(*Run))
		} else {
			runs = append(runs, run)
		}
	}
	return runs
}

func (s *Store) Save(run *Run) {
	s.persist(run)
}

func (s *Store) Deactivate(id string) {
	if v, ok := s.active.Load(id); ok {
		s.persist(v.(*Run))
		s.active.Delete(id)
	}
}

func (s *Store) persist(run *Run) {
	run.mu.RLock()
	defer run.mu.RUnlock()

	urlsJSON, _ := json.Marshal(run.URLs)
	configJSON, _ := json.Marshal(run.Config)
	tagsJSON, _ := json.Marshal(run.Tags)
	logsJSON, _ := json.Marshal(run.Logs)
	var resultsJSON []byte
	if run.Results != nil {
		resultsJSON, _ = json.Marshal(run.Results)
	}

	var endedAt *string
	if run.EndedAt != nil {
		s := run.EndedAt.Format(time.RFC3339)
		endedAt = &s
	}

	_, err := s.db.Exec(`
		INSERT INTO runs (id, status, urls, config, results, error, started_at, ended_at, name, tags, logs)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			status = excluded.status,
			results = excluded.results,
			error = excluded.error,
			ended_at = excluded.ended_at,
			logs = excluded.logs
	`, run.ID, string(run.Status), string(urlsJSON), string(configJSON),
		nullableString(resultsJSON), run.Error, run.StartedAt.Format(time.RFC3339), endedAt,
		run.Name, string(tagsJSON), string(logsJSON))

	if err != nil {
		log.Printf("[store] persist error for run %s: %v", run.ID, err)
	}
}

func (s *Store) loadFromDB(id string) (*Run, bool) {
	row := s.db.QueryRow("SELECT id, status, urls, config, results, error, started_at, ended_at, name, tags, logs FROM runs WHERE id = ?", id)
	run, err := scanRunRow(row)
	if err != nil {
		return nil, false
	}
	return run, true
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRun(rows *sql.Rows) (*Run, error) {
	return scanRunRow(rows)
}

func scanRunRow(s scannable) (*Run, error) {
	var (
		id, status, urlsStr, configStr string
		resultsStr, errStr             sql.NullString
		startedAtStr                   string
		endedAtStr                     sql.NullString
		name                           string
		tagsStr                        string
		logsStr                        string
	)

	if err := s.Scan(&id, &status, &urlsStr, &configStr, &resultsStr, &errStr, &startedAtStr, &endedAtStr, &name, &tagsStr, &logsStr); err != nil {
		return nil, err
	}

	run := &Run{
		ID:     id,
		Status: RunStatus(status),
		Name:   name,
	}

	json.Unmarshal([]byte(urlsStr), &run.URLs)
	json.Unmarshal([]byte(configStr), &run.Config)
	json.Unmarshal([]byte(tagsStr), &run.Tags)
	json.Unmarshal([]byte(logsStr), &run.Logs)

	if resultsStr.Valid && resultsStr.String != "" {
		run.Results = make(map[string]URLResult)
		json.Unmarshal([]byte(resultsStr.String), &run.Results)
	}

	if errStr.Valid {
		run.Error = errStr.String
	}

	run.StartedAt, _ = time.Parse(time.RFC3339, startedAtStr)
	if endedAtStr.Valid {
		t, _ := time.Parse(time.RFC3339, endedAtStr.String)
		run.EndedAt = &t
	}

	return run, nil
}

func nullableString(b []byte) *string {
	if b == nil {
		return nil
	}
	s := string(b)
	return &s
}

func (r *Run) SetStatus(status RunStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Status = status
	if status == StatusFinished || status == StatusError || status == StatusBreached {
		now := time.Now()
		r.EndedAt = &now
	}
}

func (r *Run) SetError(err string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Status = StatusError
	r.Error = err
	now := time.Now()
	r.EndedAt = &now
}

func (r *Run) UpdateResult(urlResult URLResult) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Results == nil {
		r.Results = make(map[string]URLResult)
	}
	r.Results[urlResult.URL] = urlResult
}

func (r *Run) AppendLog(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Logs = append(r.Logs, line)
}

func (r *Run) GetResults() map[string]URLResult {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cp := make(map[string]URLResult, len(r.Results))
	for k, v := range r.Results {
		cp[k] = v
	}
	return cp
}

func (r *Run) GetStatus() RunStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.Status
}
