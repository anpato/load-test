package routes

import (
	"fmt"
	"strings"
)

const defaultMaxExpanded = 50

func ExpandRoutes(baseURL string, routes []Route, maxExpanded int) (*ManualRoutesResponse, error) {
	if maxExpanded <= 0 {
		maxExpanded = defaultMaxExpanded
	}

	seen := make(map[string]struct{})
	var expanded []string
	capped := false

	for _, route := range routes {
		if IsStatic(route.Pattern) {
			url := baseURL + route.Pattern
			if _, ok := seen[url]; !ok {
				seen[url] = struct{}{}
				if len(expanded) >= maxExpanded {
					capped = true
					break
				}
				expanded = append(expanded, url)
			}
			continue
		}

		paramNames := ParsePattern(route.Pattern)
		for _, name := range paramNames {
			if _, ok := route.Params[name]; !ok {
				return nil, fmt.Errorf("pattern %q references param %q but no values provided", route.Pattern, name)
			}
		}

		combinations := cartesianProduct(route.Params)
		for _, combo := range combinations {
			url := expandPattern(baseURL, route.Pattern, combo)
			if _, ok := seen[url]; !ok {
				seen[url] = struct{}{}
				if len(expanded) >= maxExpanded {
					capped = true
					break
				}
				expanded = append(expanded, url)
			}
		}
		if capped {
			break
		}
	}

	if expanded == nil {
		expanded = []string{}
	}

	return &ManualRoutesResponse{
		ExpandedURLs:   expanded,
		TotalGenerated: len(expanded),
		Capped:         capped,
	}, nil
}

func cartesianProduct(params map[string][]string) []map[string]string {
	// Deterministic ordering of keys so combinations are stable.
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}

	result := []map[string]string{{}}
	for _, key := range keys {
		values := params[key]
		var next []map[string]string
		for _, existing := range result {
			for _, v := range values {
				combo := make(map[string]string, len(existing)+1)
				for k, val := range existing {
					combo[k] = val
				}
				combo[key] = v
				next = append(next, combo)
			}
		}
		result = next
	}
	return result
}

func expandPattern(baseURL, pattern string, values map[string]string) string {
	segments := strings.Split(pattern, "/")
	for i, seg := range segments {
		if strings.HasPrefix(seg, ":") {
			name := seg[1:]
			if val, ok := values[name]; ok {
				segments[i] = val
			}
		}
	}
	return baseURL + strings.Join(segments, "/")
}
