import type { ModelRecord, ModelSnapshot } from '@/types/models';

/** 与余额页同一个 sidecar：面板隧道只转发 18427，不再加端口。 */
export const MODEL_SNAPSHOT_URL = 'http://127.0.0.1:18427/models.json';
export const MODEL_REFRESH_URL = 'http://127.0.0.1:18427/models/refresh';

function normalize(value: unknown): ModelRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    source: typeof record.source === 'string' ? record.source : record.id.split('/')[0],
    available: typeof record.available === 'boolean' ? record.available : null,
    effort: typeof record.effort === 'string' ? record.effort : null,
    levels: Array.isArray(record.levels) ? record.levels.filter((item) => typeof item === 'string') : [],
    context_window: typeof record.context_window === 'number' ? record.context_window : null,
    max_context_window: typeof record.max_context_window === 'number' ? record.max_context_window : null,
    max_output_tokens: typeof record.max_output_tokens === 'number' ? record.max_output_tokens : null,
    input: Array.isArray(record.input) ? record.input.filter((item) => typeof item === 'string') : ['text'],
    issues: Array.isArray(record.issues) ? record.issues.filter((item) => typeof item === 'string') : [],
  };
}

export async function refreshModelSnapshot(signal?: AbortSignal): Promise<ModelSnapshot> {
  const response = await fetch(MODEL_REFRESH_URL, { method: 'POST', signal });
  if (!response.ok) {
    throw new Error(`model refresh failed: ${response.status}`);
  }
  return fetchModelSnapshot(signal);
}

export async function fetchModelSnapshot(signal?: AbortSignal): Promise<ModelSnapshot> {
  const response = await fetch(MODEL_SNAPSHOT_URL, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`model snapshot request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('model snapshot payload is not an object');
  const data = payload as Record<string, unknown>;
  return {
    collected_at: typeof data.collected_at === 'string' ? data.collected_at : '',
    origin: typeof data.origin === 'string' ? data.origin : 'catalog',
    models: Array.isArray(data.models)
      ? data.models.map(normalize).filter((item): item is ModelRecord => item !== null)
      : [],
  };
}
