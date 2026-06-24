package crawler

import (
	"context"
	"io"
	"net/http"
	"strings"

	"golang.org/x/net/html"
)

func DetectSPA(ctx context.Context, rawURL string) (bool, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false, ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return false, ""
	}

	content := string(body)

	markers := []struct {
		framework string
		signals   []string
	}{
		{"next", []string{"__NEXT_DATA__", "_next/static"}},
		{"remix", []string{"__remixContext"}},
		{"gatsby", []string{"gatsby-chunk-mapping", "___gatsby"}},
		{"nuxt", []string{"__nuxt", "_nuxt/"}},
		{"angular", []string{"ng-version", "_angular_"}},
		{"react", []string{"__reactFiber", "react-root", "data-reactroot"}},
		{"vue", []string{"__vue_app__", "data-v-app"}},
	}

	for _, m := range markers {
		for _, sig := range m.signals {
			if strings.Contains(content, sig) {
				return true, m.framework
			}
		}
	}

	scriptCount, anchorCount := countTagsFromHTML(body)
	if scriptCount > 5 && anchorCount < 3 {
		return true, ""
	}

	return false, ""
}

func countTagsFromHTML(body []byte) (scripts, anchors int) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return 0, 0
	}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script":
				scripts++
			case "a":
				anchors++
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return scripts, anchors
}
