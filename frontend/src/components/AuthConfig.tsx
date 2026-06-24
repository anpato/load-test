import { useState } from 'react';
import type { AuthConfig, LoginStep } from '../lib/types';
import { recordLogin } from '../lib/api';

interface AuthConfigProps {
  config: AuthConfig;
  onChange: (config: AuthConfig) => void;
}

const AUTH_TYPES: { value: AuthConfig['type']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'cookie', label: 'Cookie Login' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'headers', label: 'Custom Headers' },
];

const ACTIONS: LoginStep['action'][] = ['fill', 'click'];
const WAIT_FOR_OPTIONS: Array<LoginStep['waitFor']> = [undefined, 'networkidle', 'navigation'];

const inputCls =
  'h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface w-full transition-colors';

const labelCls = 'block font-semibold text-[12px] text-muted mb-[7px] uppercase tracking-wide';

function StepBuilder({
  steps,
  onChange,
}: {
  steps: LoginStep[];
  onChange: (steps: LoginStep[]) => void;
}) {
  function addStep() {
    onChange([...steps, { selector: '', action: 'fill', value: '', waitFor: undefined }]);
  }

  function removeStep(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<LoginStep>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded-[6px] border border-border bg-s2 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[12px] text-muted uppercase tracking-wide">Step {i + 1}</span>
            <button
              type="button"
              onClick={() => removeStep(i)}
              className="text-subtle hover:text-bad text-[12px] font-medium transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Selector</label>
              <input
                type="text"
                value={step.selector}
                onChange={(e) => updateStep(i, { selector: e.target.value })}
                placeholder="#email"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Action</label>
              <select
                value={step.action}
                onChange={(e) => updateStep(i, { action: e.target.value as LoginStep['action'] })}
                className={inputCls}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {step.action === 'fill' && (
            <div>
              <label className={labelCls}>Value</label>
              <input
                type="text"
                value={step.value}
                onChange={(e) => updateStep(i, { value: e.target.value })}
                placeholder="Enter value"
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Wait For (optional)</label>
            <select
              value={step.waitFor ?? ''}
              onChange={(e) =>
                updateStep(i, { waitFor: (e.target.value as LoginStep['waitFor']) || undefined })
              }
              className={inputCls}
            >
              <option value="">— none —</option>
              {WAIT_FOR_OPTIONS.filter(Boolean).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addStep}
        className="w-full rounded-[4px] border border-dashed border-bs text-muted hover:border-accent hover:text-accent py-2 text-[13px] font-semibold transition-colors"
      >
        + Add Step
      </button>
    </div>
  );
}

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const pairs = Object.entries(entries);

  function addPair() {
    onChange({ ...entries, '': '' });
  }

  function updatePair(oldKey: string, newKey: string, value: string) {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      if (k === oldKey) {
        next[newKey] = value;
      } else {
        next[k] = v;
      }
    }
    onChange(next);
  }

  function removePair(key: string) {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            value={k}
            onChange={(e) => updatePair(k, e.target.value, v)}
            placeholder={keyPlaceholder ?? 'Key'}
            className={inputCls}
          />
          <input
            type="text"
            value={v}
            onChange={(e) => updatePair(k, k, e.target.value)}
            placeholder={valuePlaceholder ?? 'Value'}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => removePair(k)}
            className="shrink-0 text-subtle hover:text-bad text-[13px] px-1 transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addPair}
        className="w-full rounded-[4px] border border-dashed border-bs text-muted hover:border-accent hover:text-accent py-2 text-[13px] font-semibold transition-colors"
      >
        + Add Header
      </button>
    </div>
  );
}

export function AuthConfig({ config, onChange }: AuthConfigProps) {
  const [fetchFromEndpoint, setFetchFromEndpoint] = useState(!!(config.bearer?.tokenUrl));
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  async function handleRecord() {
    const loginUrl = config.cookie?.loginUrl;
    if (!loginUrl) return;
    setRecording(true);
    setRecordError(null);
    try {
      const res = await recordLogin(loginUrl);
      if (res.steps && res.steps.length > 0) {
        onChange({
          ...config,
          cookie: { loginUrl: res.loginUrl || loginUrl, steps: res.steps },
        });
      } else {
        setRecordError('No actions were recorded. Try interacting with the login form before closing the browser.');
      }
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : 'Recording failed');
    } finally {
      setRecording(false);
    }
  }

  function setType(type: AuthConfig['type']) {
    const next: AuthConfig = { type };
    if (type === 'cookie') next.cookie = { loginUrl: '', steps: [] };
    if (type === 'bearer') next.bearer = { token: '' };
    if (type === 'headers') next.headers = {};
    onChange(next);
  }

  function patchCookie(patch: Partial<NonNullable<AuthConfig['cookie']>>) {
    onChange({ ...config, cookie: { loginUrl: '', steps: [], ...config.cookie, ...patch } });
  }

  function patchBearer(patch: Partial<NonNullable<AuthConfig['bearer']>>) {
    onChange({ ...config, bearer: { token: '', ...config.bearer, ...patch } });
  }

  return (
    <div className="bg-surface border border-border rounded-[8px] p-4">
      <div className="flex gap-1 p-1 bg-s2 border border-border rounded-[4px] mb-5">
        {AUTH_TYPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={`flex-1 h-[34px] font-semibold text-[13px] rounded-[3px] transition-colors ${
              config.type === value
                ? 'bg-surface shadow-sm text-fg'
                : 'bg-transparent text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {config.type === 'none' && (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-s2 border border-border rounded-[6px]">
          <span className="w-2 h-2 rounded-full bg-subtle shrink-0" />
          <span className="text-[13px] text-muted">No authentication will be applied to the test requests.</span>
        </div>
      )}

      {config.type === 'cookie' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Login Page URL</label>
            <input
              type="url"
              value={config.cookie?.loginUrl ?? ''}
              onChange={(e) => patchCookie({ loginUrl: e.target.value })}
              placeholder="https://example.com/login"
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRecord}
              disabled={recording || !config.cookie?.loginUrl}
              className="flex items-center gap-2 h-[38px] px-4 rounded-[4px] font-semibold text-[13px] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ backgroundColor: 'oklch(0.6 0.2 295)' }}
            >
              <span
                className="w-[7px] h-[7px] rounded-full bg-white shrink-0"
                style={{ animation: recording ? 'blink 1.4s infinite' : undefined }}
              />
              {recording ? 'Recording — interact with the browser, then close it...' : 'Record login flow'}
            </button>
            <span className="text-[12px] text-muted">Opens a browser — fill in the login form, then close the window</span>
          </div>

          {recordError && (
            <div className="rounded-[6px] border border-bad/30 bg-bad/8 px-3 py-2 text-[13px] text-bad">
              {recordError}
            </div>
          )}

          <div>
            <label className={labelCls}>Login Steps</label>
            <StepBuilder
              steps={config.cookie?.steps ?? []}
              onChange={(steps) => patchCookie({ steps })}
            />
          </div>
        </div>
      )}

      {config.type === 'bearer' && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[13px] text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fetchFromEndpoint}
              onChange={(e) => {
                setFetchFromEndpoint(e.target.checked);
                if (!e.target.checked) {
                  patchBearer({ tokenUrl: undefined, tokenField: undefined, credentials: undefined });
                }
              }}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="font-medium">Fetch token from endpoint</span>
          </label>

          {!fetchFromEndpoint ? (
            <div>
              <label className={labelCls}>Static Token</label>
              <textarea
                value={config.bearer?.token ?? ''}
                onChange={(e) => patchBearer({ token: e.target.value })}
                placeholder="eyJhbGci..."
                rows={3}
                className="w-full h-[90px] px-3 py-2 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface resize-none transition-colors"
              />
              <p className="mt-1.5 text-[12px] text-muted">Sent as <span className="font-mono">Authorization: Bearer &lt;token&gt;</span></p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Token Endpoint URL</label>
                <input
                  type="url"
                  value={config.bearer?.tokenUrl ?? ''}
                  onChange={(e) => patchBearer({ tokenUrl: e.target.value })}
                  placeholder="https://example.com/api/token"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Token Field Path</label>
                <input
                  type="text"
                  value={config.bearer?.tokenField ?? ''}
                  onChange={(e) => patchBearer({ tokenField: e.target.value })}
                  placeholder="data.access_token"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Credentials</label>
                <KeyValueEditor
                  entries={config.bearer?.credentials ?? {}}
                  onChange={(credentials) => patchBearer({ credentials })}
                  keyPlaceholder="username"
                  valuePlaceholder="value"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {config.type === 'headers' && (
        <div>
          <label className={labelCls}>Headers</label>
          <KeyValueEditor
            entries={config.headers ?? {}}
            onChange={(headers) => onChange({ ...config, headers })}
            keyPlaceholder="X-Api-Key"
            valuePlaceholder="value"
          />
        </div>
      )}
    </div>
  );
}
