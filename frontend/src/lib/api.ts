import type {
  CrawlRequest,
  CrawlResponse,
  LoginStep,
  ManualRoutesRequest,
  ManualRoutesResponse,
  Run,
  RunConfig,
} from './types';

const BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function crawl(req: CrawlRequest): Promise<CrawlResponse> {
  return request('/crawl', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function interactiveCrawl(
  url: string,
  authJson?: string
): Promise<{ urls: string[] }> {
  return request('/crawl/interactive', {
    method: 'POST',
    body: JSON.stringify({ url, authJson }),
  });
}

export function expandRoutes(
  req: ManualRoutesRequest
): Promise<ManualRoutesResponse> {
  return request('/routes/expand', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function createRun(
  urls: string[],
  config: RunConfig
): Promise<{ runId: string }> {
  return request('/runs', {
    method: 'POST',
    body: JSON.stringify({ urls, config }),
  });
}

export function getRun(id: string): Promise<Run> {
  return request(`/runs/${id}`);
}

export function stopRun(id: string): Promise<{ status: string }> {
  return request(`/runs/${id}`, { method: 'DELETE' });
}

export function listRuns(): Promise<Run[]> {
  return request('/runs');
}

export function rerunTest(id: string): Promise<{ runId: string }> {
  return request(`/runs/${id}/rerun`, { method: 'POST' });
}

export function recordLogin(
  loginUrl: string
): Promise<{ steps: LoginStep[]; loginUrl: string }> {
  return request('/auth/record', {
    method: 'POST',
    body: JSON.stringify({ loginUrl }),
  });
}
