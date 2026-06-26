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
// When ctx is cancelled, it does a final drain of any remaining
// lines before returning.
func StreamOutput(ctx context.Context, reader io.Reader, ch chan<- K6Output) error {
	r := bufio.NewReader(reader)

	for {
		select {
		case <-ctx.Done():
			drain(r, ch)
			return ctx.Err()
		default:
		}

		line, err := r.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				select {
				case <-ctx.Done():
					drain(r, ch)
					return ctx.Err()
				case <-time.After(200 * time.Millisecond):
					continue
				}
			}
			return err
		}

		parseLine(line, ch)
	}
}

func drain(r *bufio.Reader, ch chan<- K6Output) {
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			parseLine(line, ch)
		}
		if err != nil {
			return
		}
	}
}

func parseLine(line []byte, ch chan<- K6Output) {
	if len(line) == 0 {
		return
	}
	var out K6Output
	if json.Unmarshal(line, &out) != nil || out.Type != "Point" {
		return
	}
	ch <- out
}
