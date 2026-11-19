import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_REFRESH_URL,
  MODEL_SNAPSHOT_URL,
  fetchModelSnapshot,
  refreshModelSnapshot,
} from './modelSnapshotService';

const jsonResponse = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchModelSnapshot', () => {
  it('requests the sidecar snapshot URL and normalizes records', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        collected_at: '2026-10-11T08:30:30Z',
        origin: 'live',
        models: [
          {
            id: 'glm/glm-5.3',
            source: 'glm',
            available: true,
            effort: 'high',
            levels: ['low', 'high'],
            context_window: 200000,
            max_context_window: 1000000,
            max_output_tokens: 64000,
            input: ['text', 'image'],
            issues: ['missing_context'],
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchModelSnapshot();

    expect(fetchMock).toHaveBeenCalledWith(MODEL_SNAPSHOT_URL, {
      signal: undefined,
      cache: 'no-store',
    });
    expect(snapshot.origin).toBe('live');
    expect(snapshot.collected_at).toBe('2026-10-11T08:30:30Z');
    expect(snapshot.models).toEqual([
      {
        id: 'glm/glm-5.3',
        source: 'glm',
        available: true,
        effort: 'high',
        levels: ['low', 'high'],
        context_window: 200000,
        max_context_window: 1000000,
        max_output_tokens: 64000,
        input: ['text', 'image'],
        issues: ['missing_context'],
      },
    ]);
  });

  it('derives source from the id prefix and fills defaults for missing fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ models: [{ id: 'wb/glm-5.3-flash' }] }))
    );

    const snapshot = await fetchModelSnapshot();

    expect(snapshot).toMatchObject({ collected_at: '', origin: 'catalog' });
    expect(snapshot.models[0]).toEqual({
      id: 'wb/glm-5.3-flash',
      source: 'wb',
      available: null,
      effort: null,
      levels: [],
      context_window: null,
      max_context_window: null,
      max_output_tokens: null,
      input: ['text'],
      issues: [],
    });
  });

  it('drops records without a usable id instead of rendering blank rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ models: [null, 'nope', {}, { id: '' }, { id: 'ok/model' }] })
      )
    );

    const snapshot = await fetchModelSnapshot();

    expect(snapshot.models.map((model) => model.id)).toEqual(['ok/model']);
  });

  it('tolerates a payload with no models array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ collected_at: 'x' })));

    const snapshot = await fetchModelSnapshot();

    expect(snapshot.models).toEqual([]);
  });

  it('fails loudly on a non-OK response so the page can show its hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 502)));

    await expect(fetchModelSnapshot()).rejects.toThrow('model snapshot request failed: 502');
  });

  it('rejects a non-object payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)));

    await expect(fetchModelSnapshot()).rejects.toThrow('model snapshot payload is not an object');
  });
});

describe('refreshModelSnapshot', () => {
  it('POSTs the refresh endpoint before re-reading the snapshot', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ models: [{ id: 'glm/glm-5.3' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await refreshModelSnapshot();

    expect(fetchMock).toHaveBeenNthCalledWith(1, MODEL_REFRESH_URL, {
      method: 'POST',
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, MODEL_SNAPSHOT_URL, {
      signal: undefined,
      cache: 'no-store',
    });
    expect(snapshot.models.map((model) => model.id)).toEqual(['glm/glm-5.3']);
  });

  it('does not read the snapshot when the refresh call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshModelSnapshot()).rejects.toThrow('model refresh failed: 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
