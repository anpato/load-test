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

interface SessionResponse {
  status: string;
  urls?: string[];
  steps?: LoginStep[];
  error?: string;
}

async function pollSession<T>(
  sessionId: string,
  transform: (data: SessionResponse) => T
): Promise<T> {
  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await request<SessionResponse>(`/sessions/${sessionId}`);
    if (res.status === 'done') return transform(res);
    if (res.status === 'error')
      throw new Error(res.error || 'Session failed');
  }
}

export function crawl(req: CrawlRequest): Promise<CrawlResponse> {
  return request('/crawl', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function interactiveCrawl(
  url: string,
  authJson?: string
): Promise<{ urls: string[] }> {
  const { sessionId } = await request<{ sessionId: string }>(
    '/crawl/interactive',
    {
      method: 'POST',
      body: JSON.stringify({ url, authJson }),
    }
  );
  return pollSession<{ urls: string[] }>(sessionId, (data) => ({
    urls: data.urls ?? [],
  }));
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
  config: RunConfig,
  name?: string,
  tags?: string[],
): Promise<{ runId: string }> {
  return request('/runs', {
    method: 'POST',
    body: JSON.stringify({ urls, config, name, tags }),
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

export function deleteRun(id: string): Promise<{ status: string }> {
  return request(`/runs/${id}/delete`, { method: 'DELETE' });
}

export function rerunTest(
  id: string,
  options?: { authJson?: string },
): Promise<{ runId: string }> {
  return request(`/runs/${id}/rerun`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  });
}

export async function recordLogin(
  loginUrl: string
): Promise<{ steps: LoginStep[]; loginUrl: string }> {
  const { sessionId } = await request<{ sessionId: string }>('/auth/record', {
    method: 'POST',
    body: JSON.stringify({ loginUrl }),
  });
  return pollSession<{ steps: LoginStep[]; loginUrl: string }>(
    sessionId,
    (data) => ({
      steps: data.steps ?? [],
      loginUrl,
    })
  );
}
