import { useEffect, useState } from 'react';
import type { AuthConfig } from '../lib/types';
import { ensureProtocol } from '../lib/url';

export interface SavedAuth {
  name: string;
  auth: AuthConfig;
}

const AUTH_STORAGE_KEY = 'load-test-saved-auths';

function loadSavedAuths(): SavedAuth[] {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedAuths(items: SavedAuth[]) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(items));
}

interface SavedAuthPickerProps {
  currentAuth: AuthConfig;
  onSelect: (auth: AuthConfig) => void;
}

export function SavedAuthPicker({ currentAuth, onSelect }: SavedAuthPickerProps) {
  const [items, setItems] = useState<SavedAuth[]>(loadSavedAuths);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    setItems(loadSavedAuths());
  }, []);

  function handleSave() {
    const name = saveName.trim();
    if (!name || currentAuth.type === 'none') return;
    const next = items.filter((i) => i.name !== name).concat({ name, auth: currentAuth });
    persistSavedAuths(next);
    setItems(next);
    setShowSave(false);
    setSaveName('');
  }

  function handleDelete(name: string) {
    const next = items.filter((i) => i.name !== name);
    persistSavedAuths(next);
    setItems(next);
  }

  if (items.length === 0 && currentAuth.type === 'none') return null;

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div>
          <label className="block font-semibold text-[12px] text-muted mb-[7px] uppercase tracking-wide">
            Saved credentials
          </label>
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <div key={item.name} className="flex items-center gap-1">
                <button
                  onClick={() => onSelect(item.auth)}
                  className="h-[30px] px-3 text-[12px] font-medium rounded-[4px] border border-border bg-s2 text-fg hover:bg-border transition-colors"
                >
                  {item.name}
                  <span className="ml-1.5 text-[10px] text-subtle">{item.auth.type}</span>
                </button>
                <button
                  onClick={() => handleDelete(item.name)}
                  className="text-subtle hover:text-bad text-[11px] px-0.5 transition-colors"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentAuth.type !== 'none' && (
        showSave ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Credential name"
              autoFocus
              className="flex-1 h-[30px] px-2 bg-s2 border border-border rounded-[4px] text-fg font-mono text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="h-[30px] px-3 text-[12px] font-medium bg-accent text-accent-fg rounded-[4px] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              Save
            </button>
            <button
              onClick={() => { setShowSave(false); setSaveName(''); }}
              className="h-[30px] px-2 text-[12px] text-muted hover:text-fg transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSave(true)}
            className="text-[12px] font-semibold text-accent hover:text-accent/80 transition-colors"
          >
            + Save current credentials
          </button>
        )
      )}
    </div>
  );
}

interface HostSwapProps {
  urls: string[];
  onSwap: (newUrls: string[]) => void;
}

export function HostSwap({ urls, onSwap }: HostSwapProps) {
  const [newHost, setNewHost] = useState('');

  const currentHost = (() => {
    try { return new URL(urls[0]).host; } catch { return ''; }
  })();

  function handleSwap() {
    const target = ensureProtocol(newHost.trim());
    if (!target || !currentHost) return;
    onSwap(swapHost(urls, currentHost, target));
    setNewHost('');
  }

  if (urls.length === 0) return null;

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="block font-semibold text-[12px] text-muted mb-[7px] uppercase tracking-wide">
          Target host
          <span className="normal-case font-normal text-subtle ml-2">
            currently {currentHost}
          </span>
        </label>
        <input
          type="text"
          value={newHost}
          onChange={(e) => setNewHost(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSwap()}
          placeholder={currentHost}
          className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
        />
      </div>
      <button
        onClick={handleSwap}
        disabled={!newHost.trim()}
        className="h-[38px] px-4 text-[13px] font-medium bg-accent text-accent-fg rounded-[4px] hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        Swap host
      </button>
    </div>
  );
}

export function swapHost(urls: string[], fromHost: string, toHost: string): string[] {
  if (!fromHost || !toHost || fromHost === toHost) return urls;
  return urls.map((url) => {
    try {
      const parsed = new URL(url);
      const from = new URL(fromHost.includes('://') ? fromHost : 'https://' + fromHost);
      if (parsed.host === from.host) {
        const to = new URL(toHost.includes('://') ? toHost : 'https://' + toHost);
        parsed.host = to.host;
        parsed.protocol = to.protocol;
        return parsed.toString();
      }
      return url;
    } catch {
      return url;
    }
  });
}
