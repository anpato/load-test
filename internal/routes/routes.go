package routes

import "strings"

type Route struct {
	Pattern string              `json:"pattern"`
	Params  map[string][]string `json:"params"`
}

type ManualRoutesRequest struct {
	BaseURL string  `json:"baseUrl"`
	Routes  []Route `json:"routes"`
}

type ManualRoutesResponse struct {
	ExpandedURLs   []string `json:"expandedURLs"`
	TotalGenerated int      `json:"totalGenerated"`
	Capped         bool     `json:"capped"`
}

func ParsePattern(pattern string) []string {
	var params []string
	for _, segment := range strings.Split(pattern, "/") {
		if strings.HasPrefix(segment, ":") {
			params = append(params, segment[1:])
		}
	}
	return params
}

func IsStatic(pattern string) bool {
	return len(ParsePattern(pattern)) == 0
}
