package k6

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type MetricSnapshot struct {
	URL       string
	Metric    string
	Samples   []float64
	P50       float64
	P75       float64
	P95       float64
	Min       float64
	Max       float64
	Timestamp time.Time
}

type Aggregator struct {
	mu      sync.Mutex
	samples map[string]map[string][]float64 // url -> metric -> samples
}

func NewAggregator() *Aggregator {
	return &Aggregator{
		samples: make(map[string]map[string][]float64),
	}
}

func isRelevantMetric(metric string) bool {
	return strings.Contains(metric, "web_vital") || strings.HasPrefix(metric, "custom_")
}

func (a *Aggregator) Add(url, metric string, value float64) {
	if !isRelevantMetric(metric) {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.samples[url] == nil {
		a.samples[url] = make(map[string][]float64)
	}
	a.samples[url][metric] = append(a.samples[url][metric], value)
}

func (a *Aggregator) Snapshot() []MetricSnapshot {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	var snapshots []MetricSnapshot

	for url, metrics := range a.samples {
		for metric, vals := range metrics {
			if len(vals) == 0 {
				continue
			}

			sorted := make([]float64, len(vals))
			copy(sorted, vals)
			sort.Float64s(sorted)

			snap := MetricSnapshot{
				URL:       url,
				Metric:    metric,
				Samples:   sorted,
				P50:       a.percentile(sorted, 50),
				P75:       a.percentile(sorted, 75),
				P95:       a.percentile(sorted, 95),
				Min:       sorted[0],
				Max:       sorted[len(sorted)-1],
				Timestamp: now,
			}
			snapshots = append(snapshots, snap)
		}
	}

	return snapshots
}

func (a *Aggregator) percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	// Nearest-rank method: index = ceil(p/100 * n) - 1
	idx := int(p/100*float64(len(sorted))+0.999) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}
