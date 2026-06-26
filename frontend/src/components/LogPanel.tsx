import { useEffect, useRef, useState } from 'react';

interface LogPanelProps {
  logs: string[];
  defaultOpen?: boolean;
}

function lineColor(line: string): string {
  if (line.toLowerCase().includes('setup') || line.toLowerCase().includes('teardown'))
    return 'var(--color-terminal-dim)';
  return 'var(--color-terminal-text)';
}

export default function LogPanel({ logs, defaultOpen = false }: LogPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  const filtered = filter
    ? logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{
        background: 'var(--color-terminal-bg)',
        border: '1px solid var(--color-terminal-border)',
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-3 cursor-pointer select-none"
        style={{
          background: 'var(--color-terminal-header)',
          borderBottom: '1px solid var(--color-terminal-border)',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className="w-3 h-3 transition-transform flex-shrink-0"
          style={{ color: 'var(--color-terminal-dim)', transform: open ? 'rotate(90deg)' : undefined }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-mono font-bold text-[12px] shrink-0" style={{ color: 'var(--color-terminal-dim)' }}>
          k6 output
        </span>
        {open && (
          <>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Filter..."
              className="flex-1 px-2 py-0.5 rounded-[3px] font-mono text-[12px] outline-none min-w-0"
              style={{
                background: 'var(--color-terminal-bg)',
                border: '1px solid var(--color-terminal-border)',
                color: 'var(--color-terminal-input)',
              }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); setAutoScroll((v) => !v); }}
              className="font-mono font-semibold text-[11px] px-2 py-0.5 rounded-full shrink-0 transition-colors"
              style={{
                color: autoScroll ? 'var(--color-terminal-accent)' : 'var(--color-terminal-dim)',
                background: autoScroll ? 'color-mix(in srgb, var(--color-terminal-accent) 12%, transparent)' : 'transparent',
              }}
            >
              {autoScroll ? 'Following' : 'Paused'}
            </button>
          </>
        )}
        <span className="font-mono text-[11px] shrink-0 ml-auto" style={{ color: 'var(--color-terminal-dim)' }}>
          {filtered.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto p-[10px_13px] transition-[height] duration-200"
        style={{
          background: 'var(--color-terminal-bg)',
          height: open ? 200 : 0,
          padding: open ? undefined : '0 13px',
        }}
      >
        {filtered.length === 0 ? (
          <span className="font-mono text-[12.5px]" style={{ color: 'var(--color-terminal-muted)' }}>
            No output.
          </span>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className="font-mono text-[12.5px] leading-relaxed" style={{ color: lineColor(line) }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
