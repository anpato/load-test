package crawler

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"golang.org/x/net/html"
)

type CrawlConfig struct {
	BaseURL     string
	MaxDepth    int
	MaxPages    int
	Concurrency int
	UserAgent   string
	AuthJSON    string
}

type CrawlResult struct {
	URLs        []string
	IsSPA       bool
	Framework   string
	SitemapURLs []string
}

func applyDefaults(cfg *CrawlConfig) {
	if cfg.MaxDepth == 0 {
		cfg.MaxDepth = 3
	}
	if cfg.MaxPages == 0 {
		cfg.MaxPages = 100
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = 5
	}
}

func Crawl(ctx context.Context, cfg CrawlConfig) (*CrawlResult, error) {
	applyDefaults(&cfg)

	// If auth is provided, use Playwright browser crawl (handles JS + auth)
	if cfg.AuthJSON != "" {
		return BrowserCrawl(ctx, cfg)
	}

	sitemapURLs, err := FetchSitemap(ctx, cfg.BaseURL)
	if err != nil {
		sitemapURLs = nil
	}

	var crawled []string
	if len(sitemapURLs) < 5 {
		crawled = crawlLinks(ctx, cfg)
	}

	seen := make(map[string]struct{})
	var merged []string
	for _, u := range sitemapURLs {
		if _, ok := seen[u]; !ok {
			seen[u] = struct{}{}
			merged = append(merged, u)
		}
	}
	for _, u := range crawled {
		if _, ok := seen[u]; !ok {
			seen[u] = struct{}{}
			merged = append(merged, u)
		}
	}

	isSPA, framework := DetectSPA(ctx, cfg.BaseURL)

	return &CrawlResult{
		URLs:        merged,
		IsSPA:       isSPA,
		Framework:   framework,
		SitemapURLs: sitemapURLs,
	}, nil
}

type visitEntry struct {
	rawURL string
	depth  int
}

func crawlLinks(ctx context.Context, cfg CrawlConfig) []string {
	base, err := url.Parse(cfg.BaseURL)
	if err != nil {
		return nil
	}

	visited := make(map[string]struct{})
	var mu sync.Mutex
	var results []string

	sem := make(chan struct{}, cfg.Concurrency)
	queue := make(chan visitEntry, cfg.MaxPages*2)
	var wg sync.WaitGroup

	enqueue := func(rawURL string, depth int) bool {
		mu.Lock()
		defer mu.Unlock()
		if len(visited) >= cfg.MaxPages {
			return false
		}
		if _, ok := visited[rawURL]; ok {
			return false
		}
		visited[rawURL] = struct{}{}
		return true
	}

	if enqueue(cfg.BaseURL, 0) {
		wg.Add(1)
		queue <- visitEntry{cfg.BaseURL, 0}
	}

	go func() {
		wg.Wait()
		close(queue)
	}()

	for entry := range queue {
		e := entry
		sem <- struct{}{}
		go func() {
			defer func() {
				<-sem
				wg.Done()
			}()

			links := fetchAndExtract(ctx, e.rawURL, cfg.UserAgent)
			mu.Lock()
			results = append(results, e.rawURL)
			mu.Unlock()

			if e.depth >= cfg.MaxDepth {
				return
			}

			for _, link := range links {
				resolved := resolveURL(base, link)
				if resolved == "" {
					continue
				}
				if !isSameOrigin(base, resolved) {
					continue
				}
				normalized := normalizeURL(resolved)
				if normalized == "" {
					continue
				}
				if enqueue(normalized, e.depth+1) {
					wg.Add(1)
					select {
					case queue <- visitEntry{normalized, e.depth + 1}:
					default:
						wg.Done()
					}
				}
			}
		}()
	}

	return results
}

func fetchAndExtract(ctx context.Context, rawURL, userAgent string) []string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil
	}
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		return nil
	}

	return extractLinks(resp.Body)
}

func extractLinks(r interface{ Read([]byte) (int, error) }) []string {
	doc, err := html.Parse(r)
	if err != nil {
		return nil
	}

	var links []string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "a" {
			for _, attr := range n.Attr {
				if attr.Key == "href" {
					links = append(links, attr.Val)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return links
}

func resolveURL(base *url.URL, ref string) string {
	if strings.HasPrefix(ref, "javascript:") || strings.HasPrefix(ref, "mailto:") || strings.HasPrefix(ref, "#") {
		return ""
	}
	refURL, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(refURL)
	resolved.Fragment = ""
	return resolved.String()
}

func normalizeURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	u.Fragment = ""
	s := u.String()
	s = strings.TrimRight(s, "/")
	return s
}

func isSameOrigin(base *url.URL, rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(base.Host, u.Host)
}
