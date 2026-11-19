import { describe, expect, it } from 'vitest';
import type { ModelPrice } from '@/utils/usage';
import {
  buildModelPriceRows,
  buildSyncPriceModelsFromSummary,
  canonicalModelName,
  classifyPriceConfidence,
  isRetiredRoute,
  isUnpricedUpstreamRoute,
  mergeModelPricesByCanonicalName,
  priceAuthority,
} from './modelPricesPageModel';

const price = (over: Partial<ModelPrice> = {}): ModelPrice => ({
  prompt: 1,
  completion: 1,
  cache: 1,
  source: 'models.dev',
  sourceModelId: 'vendor/model',
  ...over,
});

describe('canonicalModelName', () => {
  it('drops the routing prefix', () => {
    expect(canonicalModelName('wb/deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(canonicalModelName('ds/deepseek-flash')).toBe('deepseek-flash');
    expect(canonicalModelName('cctq/gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(canonicalModelName('auth/cpa-gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });

  it('drops only the first segment, keeping a provider path', () => {
    expect(canonicalModelName('openrouter/z-ai/glm-5')).toBe('z-ai/glm-5');
  });

  it('leaves bare names and non-model keys untouched', () => {
    expect(canonicalModelName('glm-5.2')).toBe('glm-5.2');
    expect(canonicalModelName('auto')).toBe('auto');
    expect(canonicalModelName('claude-3(high)')).toBe('claude-3(high)');
    expect(canonicalModelName('')).toBe('');
    expect(canonicalModelName('trailing/')).toBe('trailing/');
  });
});

describe('priceAuthority', () => {
  it('ranks a hand-entered price above every fetched source', () => {
    expect(priceAuthority(price({ source: 'manual' }))).toBe(4);
    expect(priceAuthority(price({ source: 'openrouter' }))).toBe(1);
  });

  it('trusts a vendor-owned models.dev record over a reseller one', () => {
    expect(priceAuthority(price({ source: 'models.dev', sourceModelId: 'zai/glm-5.2' }))).toBe(3);
    expect(priceAuthority(price({ source: 'models.dev', sourceModelId: '302ai/glm-5.2' }))).toBe(1);
    expect(priceAuthority(price({ source: 'models.dev', sourceModelId: 'aihubmix/hy3' }))).toBe(1);
  });
});

describe('mergeModelPricesByCanonicalName', () => {
  it('gives every prefix the same price for the same model', () => {
    const merged = mergeModelPricesByCanonicalName({
      'wb/glm-5.2': price({ prompt: 0.032, completion: 12, source: 'openrouter' }),
      'glm/glm-5.2': price({ prompt: 0.032, completion: 12, source: 'openrouter' }),
      'glm-5.2': price({
        prompt: 1.4,
        completion: 4.4,
        source: 'models.dev',
        sourceModelId: 'zai/glm-5.2',
      }),
    });

    expect(Object.keys(merged).sort()).toEqual(['glm-5.2']);
    expect(merged['glm-5.2'].prompt).toBe(1.4);
    expect(merged['glm-5.2'].completion).toBe(4.4);
  });

  it('prefers the vendor record when no bare key exists', () => {
    const merged = mergeModelPricesByCanonicalName({
      'wb/glm-5.3': price({ prompt: 0.07, completion: 7, source: 'openrouter' }),
      'ds/glm-5.3': price({
        prompt: 1.4,
        completion: 4.4,
        source: 'models.dev',
        sourceModelId: 'zai/glm-5.3',
      }),
    });

    expect(Object.keys(merged)).toEqual(['glm-5.3']);
    expect(merged['glm-5.3'].prompt).toBe(1.4);
  });

  it('never lets a prefixed variant overwrite a bare key', () => {
    const merged = mergeModelPricesByCanonicalName({
      // A reseller record would win on score if the bare key were not protected.
      'wb/kimi-k2.6': price({ prompt: 99, source: 'openrouter', sourceModelId: 'reseller/x' }),
      'kimi-k2.6': price({ prompt: 0.95, source: 'manual' }),
    });

    expect(merged['kimi-k2.6'].prompt).toBe(0.95);
    expect(Object.keys(merged)).toEqual(['kimi-k2.6']);
  });

  it('keeps dispatch aliases and unrelated bare names intact', () => {
    const merged = mergeModelPricesByCanonicalName({
      auto: price({ prompt: 0, completion: 0 }),
      'wb/auto': price({ prompt: 0, completion: 0 }),
      'gpt-5.6-sol': price({ prompt: 4, completion: 20 }),
    });

    expect(Object.keys(merged).sort()).toEqual(['auto', 'gpt-5.6-sol']);
  });

  it('is deterministic for equally-authoritative records', () => {
    const input = {
      'wb/thing': price({ prompt: 2 }),
      'ds/thing': price({ prompt: 1 }),
    };
    const first = mergeModelPricesByCanonicalName(input);
    const second = mergeModelPricesByCanonicalName({ ...input });
    expect(first['thing'].prompt).toBe(second['thing'].prompt);
  });

  it('returns the input unchanged when empty', () => {
    expect(mergeModelPricesByCanonicalName({})).toEqual({});
  });
});

describe('classifyPriceConfidence', () => {
  it('reads confidence off the record, not the route', () => {
    // The same record reached through a gateway prefix is no less official.
    expect(classifyPriceConfidence(price({ source: 'manual' }))).toBe('manual');
    expect(
      classifyPriceConfidence(price({ source: 'models.dev', sourceModelId: 'zai/glm-5.2' }))
    ).toBe('official');
    expect(
      classifyPriceConfidence(price({ source: 'models.dev', sourceModelId: '302ai/glm-5.2' }))
    ).toBe('aggregator');
    expect(classifyPriceConfidence(price({ source: 'openrouter' }))).toBe('aggregator');
  });

  it('reports none when no source is recorded', () => {
    expect(classifyPriceConfidence(undefined)).toBe('none');
    expect(classifyPriceConfidence(price({ source: '' }))).toBe('none');
  });
});

const usageSummaryOf = (models: { model: string; calls: number }[]) => ({
  sampled_events: 1,
  total_events: 1,
  truncated: false,
  models: models.map((m) => ({
    model: m.model,
    calls: m.calls,
    requested_calls: m.calls,
    resolved_calls: 0,
  })),
});

describe('buildModelPriceRows prefix collapsing', () => {
  it('shows one row per model under the bare name', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([
        { model: 'wb/glm-5.3', calls: 267 },
        { model: 'glm/glm-5.3', calls: 3 },
      ]),
      { 'glm-5.3': price({ prompt: 1.4, source: 'manual' }) }
    );

    expect(rows.map((row) => row.model)).toEqual(['glm-5.3']);
    expect(rows[0].hasPrice).toBe(true);
  });

  it('sums call counts across the prefixes of one model', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([
        { model: 'wb/glm-5.3', calls: 267 },
        { model: 'glm/glm-5.3', calls: 3 },
      ]),
      { 'glm-5.3': price() }
    );

    expect(rows[0].calls).toBe(270);
    expect(rows[0].routes).toEqual([
      { route: 'wb/', calls: 267 },
      { route: 'glm/', calls: 3 },
    ]);
  });

  it('prices a runtime model reported under a prefixed name', () => {
    // The backend compares raw runtime ids against the price map, so a
    // prefixed runtime model arrives "unpriced" and must still match.
    const rows = buildModelPriceRows(null, { 'hy4-preview-f': price() }, [], [
      'wb/hy4-preview-f',
    ]);

    expect(rows.map((row) => row.model)).toEqual(['hy4-preview-f']);
    expect(rows[0].hasPrice).toBe(true);
  });

  it('never emits a prefixed row name', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([{ model: 'cctq/gpt-6-sol', calls: 5 }]),
      { 'cctq/gpt-6-sol': price(), 'gpt-6-sol': price() },
      [],
      ['maolao/gpt-6-sol']
    );

    expect(rows.every((row) => !row.model.includes('/'))).toBe(true);
    expect(rows.map((row) => row.model)).toEqual(['gpt-6-sol']);
  });

  it('reports one sync model per canonical name', () => {
    const models = buildSyncPriceModelsFromSummary(
      usageSummaryOf([
        { model: 'wb/glm-5.3', calls: 1 },
        { model: 'glm/glm-5.3', calls: 1 },
        { model: 'retired-history', calls: 1 },
      ]),
      { 'glm-5.3': price(), 'kimi-k2.6': price() },
      ['wb/glm-5.3', 'kimi-k2.6']
    );

    expect(models).toEqual(['glm-5.3', 'kimi-k2.6']);
  });

  it('does not sync historical models that are no longer served', () => {
    const models = buildSyncPriceModelsFromSummary(
      usageSummaryOf([{ model: 'old-model', calls: 1 }]),
      {},
      ['current-model']
    );
    expect(models).toEqual([]);
  });

  it('counts one request once when the backend reports both of its names', () => {
    // The backend emits the requested name (`wb/glm-5.3`) and the resolved name
    // (`glm-5.3`) for the same request. Summing them reported every call twice:
    // the live summary had 26,172 real `deepseek-v4.1-flash` requests showing as
    // 51,794. Exactly one of the two views must be counted, never both.
    const rows = buildModelPriceRows(
      {
        sampled_events: 2,
        total_events: 2,
        truncated: false,
        models: [
          { model: 'wb/deepseek-v4.1-flash', calls: 10197, requested_calls: 10197, resolved_calls: 0 },
          { model: 'deepseek-v4.1-flash', calls: 10197, requested_calls: 0, resolved_calls: 10197 },
        ],
      },
      { 'deepseek-v4.1-flash': price() }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].calls).toBe(10197);
    expect(rows[0].requestedCalls).toBe(10197);
    expect(rows[0].resolvedCalls).toBe(10197);
    expect(rows[0].routes).toEqual([{ route: 'wb/', calls: 10197 }]);
  });

  it('still counts requests that only the resolved view records', () => {
    // An alias whose requested name is not tracked separately: the resolved
    // total is real traffic and must not be dropped. No route is claimed,
    // because the backend never told us which prefix (if any) carried it.
    const rows = buildModelPriceRows(
      {
        sampled_events: 1,
        total_events: 1,
        truncated: false,
        models: [
          { model: 'gpt-5.5', calls: 40, requested_calls: 0, resolved_calls: 40 },
        ],
      },
      { 'gpt-5.5': price() }
    );

    expect(rows[0].calls).toBe(40);
    expect(rows[0].routes).toEqual([]);
    expect(rows[0].estimatedPrice).toBe(false);
  });
});

describe('estimate badge for routes with no published upstream price', () => {
  it('flags a model served through the wb gateway', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([{ model: 'wb/deepseek-v4.1-flash', calls: 10197 }]),
      { 'deepseek-v4.1-flash': price({ source: 'manual' }) }
    );

    expect(rows[0].model).toBe('deepseek-v4.1-flash');
    expect(rows[0].hasPrice).toBe(true);
    expect(rows[0].estimatedPrice).toBe(true);
  });

  it('does not flag a model reached only through a priced route', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([{ model: 'cctq/gpt-6-sol', calls: 25 }]),
      { 'gpt-6-sol': price({ source: 'models.dev', sourceModelId: 'openai/gpt-6-sol' }) }
    );

    expect(rows[0].estimatedPrice).toBe(false);
  });

  it('flags a row when any of its routes is the unpriced one', () => {
    // Same model reached two ways: the shared price is still an estimate.
    const rows = buildModelPriceRows(
      usageSummaryOf([
        { model: 'cctq/glm-5.3', calls: 5 },
        { model: 'wb/glm-5.3', calls: 267 },
      ]),
      { 'glm-5.3': price() }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedPrice).toBe(true);
    expect(rows[0].calls).toBe(272);
  });

  it('does not flag a row whose wb calls are zero', () => {
    // A `wb/` runtime id with no traffic behind it is a listing, not a call:
    // flagging it would claim an estimate for a model that never used the route.
    const rows = buildModelPriceRows(null, { 'glm-5.3': price() }, [], ['wb/glm-5.3']);

    expect(rows[0].model).toBe('glm-5.3');
    expect(rows[0].calls).toBe(0);
    expect(rows[0].estimatedPrice).toBe(false);
  });

  it('does not flag the subscription route just because the model also has a wb route', () => {
    // The real 2026-10-11 case: `glm-5.3` was called only through the Zhipu
    // subscription, while the same model *name* had historical wb traffic.
    const rows = buildModelPriceRows(
      {
        sampled_events: 2,
        total_events: 2,
        truncated: false,
        models: [
          { model: 'glm/glm-5.3', calls: 601, requested_calls: 601, resolved_calls: 0 },
          { model: 'glm-5.3', calls: 601, requested_calls: 0, resolved_calls: 601 },
        ],
      },
      { 'glm-5.3': price({ source: 'manual' }) }
    );

    expect(rows[0].estimatedPrice).toBe(false);
    expect(rows[0].calls).toBe(601);
    expect(rows[0].routes).toEqual([{ route: 'glm/', calls: 601 }]);
  });

  it('does not flag an unpriced model, which already shows no price', () => {
    const rows = buildModelPriceRows(
      usageSummaryOf([{ model: 'wb/space-bunny', calls: 3 }]),
      {}
    );

    expect(rows[0].hasPrice).toBe(false);
    expect(rows[0].estimatedPrice).toBe(true);
  });

  it('recognizes the unpriced route by prefix only', () => {
    expect(isUnpricedUpstreamRoute('wb/hy3')).toBe(true);
    expect(isUnpricedUpstreamRoute('WB/hy3')).toBe(true);
    expect(isUnpricedUpstreamRoute('hy3')).toBe(false);
    expect(isUnpricedUpstreamRoute('cctq/hy3')).toBe(false);
    expect(isUnpricedUpstreamRoute('')).toBe(false);
  });
});

describe('retired routes stay gone', () => {
  // Retiring a source removes it from the CPA registry, but its historical
  // usage events stay in SQLite and models.dev keeps listing the vendor. These
  // tests pin both halves of the fix: the row must not render, and the sync
  // must not be asked for its price (which is what re-imported it before).
  const stepUsage = usageSummaryOf([
    { model: 'step/step-5-preview', calls: 16 },
    { model: 'step/step-gui', calls: 19 },
  ]);

  it('hides a retired route from the table even with recorded traffic', () => {
    const rows = buildModelPriceRows(stepUsage, {});

    expect(rows).toEqual([]);
  });

  it('hides a retired route even when a price row still exists', () => {
    // The row is named `step-5-preview` after the prefix strip, so the filter
    // cannot rely on the row name alone.
    const rows = buildModelPriceRows(stepUsage, { 'step-5-preview': price() });

    expect(rows).toEqual([]);
  });

  it('never asks the sync to price a route only the retired vendor served', () => {
    // A row stored under the retired prefix must not resurrect the vendor.
    const models = buildSyncPriceModelsFromSummary(stepUsage, {
      'step/step-3.7-flash': price(),
    });

    expect(models).toEqual([]);
  });

  it('keeps live routes while dropping the retired one', () => {
    const summary = usageSummaryOf([
      { model: 'step/step-5-preview', calls: 16 },
      { model: 'wb/glm-5.3', calls: 267 },
    ]);
    const rows = buildModelPriceRows(summary, { 'glm-5.3': price() });
    const syncModels = buildSyncPriceModelsFromSummary(summary, { 'glm-5.3': price() }, ['wb/step-5-preview', 'glm/glm-5.3']);

    expect(rows.map((row) => row.model)).toEqual(['glm-5.3']);
    expect(syncModels).toEqual(['glm-5.3']);
  });

  it('does not hide a live route that shares a name with a retired one', () => {
    // `canonicalModelName` maps `step/step-5-preview` and `wb/step-5-preview`
    // to the same row, so retirement cannot be latched at row creation: doing
    // so hid the live WorkBuddy resale behind the dead StepFun route whenever
    // the retired name was seen first.
    const summary = usageSummaryOf([
      { model: 'step/step-5-preview', calls: 16 },
      { model: 'wb/step-5-preview', calls: 6 },
    ]);
    const rows = buildModelPriceRows(summary, { 'step-5-preview': price() });
    const syncModels = buildSyncPriceModelsFromSummary(summary, {
      'wb/step-5-preview': price(),
    });

    expect(rows.map((row) => row.model)).toEqual(['step-5-preview']);
    expect(syncModels).toEqual(['step-5-preview']);
  });

  it('reaches the same verdict regardless of summary order', () => {
    // The verdict must be a property of the routes, not of iteration order.
    const liveFirst = usageSummaryOf([
      { model: 'wb/step-5-preview', calls: 6 },
      { model: 'step/step-5-preview', calls: 16 },
    ]);
    const rows = buildModelPriceRows(liveFirst, {});

    expect(rows.map((row) => row.model)).toEqual(['step-5-preview']);
  });

  it('identifies a retired route by prefix and by bare name', () => {
    expect(isRetiredRoute('step/step-5-preview')).toBe(true);
    expect(isRetiredRoute('STEP/step-gui')).toBe(true);
    // The bare name matters for models only the retired vendor served: it is
    // what a stored price row and a canonicalised usage event look like after
    // the prefix strip.
    expect(isRetiredRoute('step-gui')).toBe(true);
    // `step-5-preview` is deliberately *not* retired as a bare name: WorkBuddy
    // resells that same model today (`wb/step-5-preview`), so condemning the
    // name would hide a live model. The `step/` prefix still covers the dead
    // route without touching the live one.
    expect(isRetiredRoute('step-5-preview')).toBe(false);
    expect(isRetiredRoute('wb/step-5-preview')).toBe(false);
    expect(isRetiredRoute('wb/glm-5.3')).toBe(false);
    expect(isRetiredRoute('glm-5.3')).toBe(false);
    expect(isRetiredRoute('')).toBe(false);
  });
});
