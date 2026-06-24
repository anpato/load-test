import { useState } from 'react';
import type { RunConfig as RunConfigType, Stage, TestPreset } from '../lib/types';
import { TEST_PRESETS, parseDuration, formatDuration } from '../lib/types';

interface Props {
  onStart: (config: RunConfigType) => void;
  onBack?: () => void;
  disabled?: boolean;
}

const PRESET_ESTIMATES: Record<Exclude<TestPreset, 'custom'>, string> = {
  smoke: '1m 15s · 1 VU',
  load: '~7m · 50 VUs',
  stress: '~9m · ramps to 200 VUs',
  soak: '30m · 25 VUs',
};

const inputCls =
  'h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface transition-colors';

const labelCls = 'block font-semibold text-[12px] text-muted mb-[7px] uppercase tracking-wide';

export default function RunConfig({ onStart, onBack, disabled }: Props) {
  const [testType, setTestType] = useState<TestPreset>('smoke');
  const [vus, setVus] = useState(TEST_PRESETS.smoke.vus);
  const [stages, setStages] = useState<Stage[]>(TEST_PRESETS.smoke.stages);
  const [thinkTime, setThinkTime] = useState(2);

  function selectPreset(preset: TestPreset) {
    setTestType(preset);
    setVus(TEST_PRESETS[preset].vus);
    setStages(TEST_PRESETS[preset].stages);
  }

  function updateStage(index: number, field: keyof Stage, value: string | number) {
    setStages(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function addStage() {
    setStages(prev => [...prev, { duration: '30s', target: 1 }]);
  }

  function removeStage(index: number) {
    setStages(prev => prev.filter((_, i) => i !== index));
  }

  function handleStart() {
    onStart({
      vus,
      duration: stages.map(s => s.duration).join('+'),
      stages,
      thinkTime,
      testType,
    });
  }

  const estimatedLabel =
    testType === 'custom'
      ? formatDuration(stages.reduce((acc, s) => acc + parseDuration(s.duration), 0))
      : PRESET_ESTIMATES[testType as Exclude<TestPreset, 'custom'>];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {(Object.keys(TEST_PRESETS) as TestPreset[]).map(preset => (
          <button
            key={preset}
            onClick={() => selectPreset(preset)}
            disabled={disabled}
            className={`flex flex-col gap-[7px] text-left p-4 rounded-[8px] cursor-pointer border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              testType === preset
                ? 'bg-accent-soft border-accent'
                : 'bg-surface border-border hover:border-bs'
            }`}
          >
            <span className={`font-bold text-[13.5px] ${testType === preset ? 'text-accent' : 'text-fg'}`}>
              {TEST_PRESETS[preset].label}
            </span>
            <span className="text-[12px] text-muted leading-snug">{TEST_PRESETS[preset].description}</span>
          </button>
        ))}
      </div>

      {testType === 'custom' && (
        <div className="bg-surface border border-border rounded-[8px] p-4 space-y-4">
          <div>
            <label className={labelCls}>Virtual Users</label>
            <input
              type="number"
              min={1}
              max={10}
              value={vus}
              onChange={e => setVus(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              disabled={disabled}
              className={`${inputCls} w-[120px]`}
            />
          </div>

          <div className="h-px bg-border" />

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className={`${labelCls} mb-0`}>Stages</label>
              <button
                onClick={addStage}
                disabled={disabled}
                className="text-[13px] font-semibold text-accent hover:text-accent/80 disabled:opacity-50 transition-colors"
              >
                + Add stage
              </button>
            </div>
            <div className="space-y-2">
              {stages.map((stage, i) => (
                <div key={i} className="flex items-center gap-[10px]">
                  <span className="font-mono text-[12px] text-subtle w-4 shrink-0">{i + 1}</span>
                  <input
                    type="text"
                    value={stage.duration}
                    onChange={e => updateStage(i, 'duration', e.target.value)}
                    disabled={disabled}
                    placeholder="30s"
                    className={`${inputCls} w-[90px]`}
                  />
                  <span className="text-subtle text-[13px]">→</span>
                  <input
                    type="number"
                    min={0}
                    value={stage.target}
                    onChange={e => updateStage(i, 'target', parseInt(e.target.value) || 0)}
                    disabled={disabled}
                    className={`${inputCls} w-[70px]`}
                  />
                  <span className="text-[12px] text-muted font-semibold">VUs</span>
                  {stages.length > 1 && (
                    <button
                      onClick={() => removeStage(i)}
                      disabled={disabled}
                      className="text-subtle hover:text-bad text-[13px] disabled:opacity-50 transition-colors ml-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={testType === 'custom' ? '' : 'bg-surface border border-border rounded-[8px] p-4'}>
        {testType !== 'custom' && <div className="h-px bg-border mb-4 -mx-4 mt-0 hidden" />}
        <label className={labelCls}>Think Time (seconds)</label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={thinkTime}
          onChange={e => setThinkTime(parseFloat(e.target.value) || 0)}
          disabled={disabled}
          className={`${inputCls} w-[120px]`}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between">
        <div className="text-[13px] text-muted">
          Estimated duration:{' '}
          <span className="font-mono font-bold text-fg">{estimatedLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              disabled={disabled}
              className="h-[38px] px-4 rounded-[4px] border border-border bg-surface text-fg font-semibold text-[13px] hover:bg-s2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={handleStart}
            disabled={disabled || stages.length === 0}
            className="h-[38px] px-5 rounded-[4px] bg-accent text-accent-fg font-semibold text-[13px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            ▶ Start test
          </button>
        </div>
      </div>
    </div>
  );
}
