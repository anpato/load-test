package k6

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"time"
)

type K6Output struct {
	Type   string    `json:"type"`
	Data   PointData `json:"data"`
	Metric string    `json:"metric"`
}

type PointData struct {
	Time  time.Time         `json:"time"`
	Value float64           `json:"value"`
	Tags  map[string]string `json:"tags"`
}

// StreamOutput tails a file that k6 is writing NDJSON to.
// It polls for new data since the file grows incrementally.
func StreamOutput(ctx context.Context, reader io.Reader, ch chan<- K6Output) error {
	r := bufio.NewReader(reader)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := r.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(200 * time.Millisecond):
					continue
				}
			}
			return err
		}

		if len(line) == 0 {
			continue
		}

		var out K6Output
		if err := json.Unmarshal(line, &out); err != nil {
			continue
		}

		if out.Type != "Point" {
			continue
		}

		select {
		case ch <- out:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
