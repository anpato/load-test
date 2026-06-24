package crawler

import (
	"bufio"
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const userAgent = "load-test-crawler/1.0"

type SitemapIndex struct {
	XMLName  xml.Name       `xml:"sitemapindex"`
	Sitemaps []SitemapEntry `xml:"sitemap"`
}

type SitemapEntry struct {
	Loc string `xml:"loc"`
}

type URLSet struct {
	XMLName xml.Name   `xml:"urlset"`
	URLs    []URLEntry `xml:"url"`
}

type URLEntry struct {
	Loc        string  `xml:"loc"`
	Priority   float64 `xml:"priority"`
	ChangeFreq string  `xml:"changefreq"`
}

func FetchSitemap(ctx context.Context, baseURL string) ([]string, error) {
	origin, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}
	origin = &url.URL{Scheme: origin.Scheme, Host: origin.Host}

	seen := make(map[string]struct{})
	var results []string

	collect := func(u string) {
		if _, ok := seen[u]; !ok {
			seen[u] = struct{}{}
			results = append(results, u)
		}
	}

	candidates := []string{
		origin.String() + "/sitemap.xml",
		origin.String() + "/sitemap_index.xml",
	}

	robotsSitemaps, _ := fetchRobotsSitemaps(ctx, origin.String()+"/robots.txt")
	candidates = append(candidates, robotsSitemaps...)

	visited := make(map[string]struct{})
	for _, loc := range candidates {
		urls, err := fetchSitemapURLs(ctx, loc, origin, visited, 0)
		if err != nil {
			continue
		}
		for _, u := range urls {
			collect(u)
		}
	}

	return results, nil
}

func fetchSitemapURLs(ctx context.Context, loc string, origin *url.URL, visited map[string]struct{}, depth int) ([]string, error) {
	if depth > 3 {
		return nil, nil
	}
	if _, ok := visited[loc]; ok {
		return nil, nil
	}
	visited[loc] = struct{}{}

	body, err := fetchURL(ctx, loc)
	if err != nil {
		return nil, err
	}

	// Try parsing as a sitemap index first; fall back to urlset.
	var idx SitemapIndex
	if err := xml.Unmarshal(body, &idx); err == nil && len(idx.Sitemaps) > 0 {
		var all []string
		for _, entry := range idx.Sitemaps {
			if !sameOrigin(entry.Loc, origin) {
				continue
			}
			urls, err := fetchSitemapURLs(ctx, entry.Loc, origin, visited, depth+1)
			if err != nil {
				continue
			}
			all = append(all, urls...)
		}
		return all, nil
	}

	var set URLSet
	if err := xml.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("parse sitemap %s: %w", loc, err)
	}

	var urls []string
	for _, entry := range set.URLs {
		if sameOrigin(entry.Loc, origin) {
			urls = append(urls, entry.Loc)
		}
	}
	return urls, nil
}

func fetchRobotsSitemaps(ctx context.Context, robotsURL string) ([]string, error) {
	body, err := fetchURL(ctx, robotsURL)
	if err != nil {
		return nil, err
	}

	var sitemaps []string
	scanner := bufio.NewScanner(strings.NewReader(string(body)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(strings.ToLower(line), "sitemap:") {
			loc := strings.TrimSpace(line[len("sitemap:"):])
			if loc != "" {
				sitemaps = append(sitemaps, loc)
			}
		}
	}
	return sitemaps, scanner.Err()
}

func fetchURL(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: status %d", rawURL, resp.StatusCode)
	}

	var buf []byte
	tmp := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if readErr != nil {
			break
		}
	}
	return buf, nil
}

func sameOrigin(rawURL string, origin *url.URL) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, origin.Host) && strings.EqualFold(u.Scheme, origin.Scheme)
}
