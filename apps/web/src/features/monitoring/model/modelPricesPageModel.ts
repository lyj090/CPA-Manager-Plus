import type { ModelPrice, ModelPriceContextTier, ModelPriceServiceTier } from '@/utils/usage';
import type {
  ModelPriceUsageSummaryResponse,
  ModelPriceSyncCandidate,
  ModelPriceSyncCandidateSet,
} from '@/services/api/usageService';
import { canonicalModelName } from '@/utils/modelCanonicalName';

export type ModelPriceFilter = 'all' | 'missing' | 'saved' | 'candidates';

export type PriceRuleDraft = {
  prompt: string;
  completion: string;
  cache: string;
  cacheRead: string;
  cacheCreation: string;
};

export type ContextTierDraft = PriceRuleDraft & {
  thresholdTokens: string;
};

export type ServiceTierDraft = PriceRuleDraft & {
  mode: string;
  serviceTier: string;
};

export type PriceDraft = {
  model: string;
  prompt: string;
  completion: string;
  cache: string;
  cacheRead: string;
  cacheCreation: string;
  contextTiers: ContextTierDraft[];
  serviceTiers: ServiceTierDraft[];
};

export type PriceDraftValidationError =
  | 'context_threshold'
  | 'context_duplicate_threshold'
  | 'context_price'
  | 'service_identity'
  | 'service_duplicate_identity'
  | 'service_price';

/**
 * Calls carried by one route on a price row.
 *
 * The prefix is a routing detail, so it must not decide the price — but it does
 * decide *which upstream answered*, and therefore whether the displayed number
 * is the list price or a borrowed estimate. Keeping the per-route counts on the
 * row is what lets the badge say "this row contains wb/ traffic" instead of
 * implying the model was called through wb/.
 */
export type ModelPriceRouteUsage = {
  /** Route prefix that carried the calls; `''` for a direct, unprefixed call. */
  route: string;
  calls: number;
};

export type ModelPriceRow = {
  model: string;
  /**
   * Requests for this model, counted once.
   *
   * The backend reports one summary row per *name* per request: the requested
   * name (`wb/glm-5.3`) and the resolved name (`glm-5.3`) are two rows for the
   * same request. Summing `requested_calls` and `resolved_calls` therefore
   * counts every request twice. This takes the larger of the two views instead:
   * the requested view is the only one that preserves routing, and the resolved
   * view also covers requests whose requested name was not recorded. Each view
   * counts every request once, so the larger one is the honest total.
   */
  calls: number;
  requestedCalls: number;
  resolvedCalls: number;
  /** Per-route breakdown of `calls`, for route-accurate attribution. */
  routes: ModelPriceRouteUsage[];
  hasPrice: boolean;
  price?: ModelPrice;
  candidateCount: number;
  /**
   * True when a route that actually served this model has no published upstream
   * price, so the displayed number is an estimate rather than a quantity the
   * upstream bills against.
   *
   * Traffic is required: merely *listing* a `wb/` runtime model does not make
   * the estimate claim true, and flags a row whose calls all went elsewhere.
   */
  estimatedPrice: boolean;
  /** True when the model was reached only through a retired route. */
  retiredRoute: boolean;
};

export type ModelPriceSummary = {
  total: number;
  saved: number;
  missing: number;
  candidates: number;
};

/**
 * Strips the routing prefix from a runtime model id.
 *
 * A prefix such as `wb/`, `ds/` or `cctq/` selects a gateway or an account
 * pool. It says nothing about which model is being called, so it must not
 * change what that model costs: `wb/deepseek-v4-pro` and `ds/deepseek-v4-pro`
 * are the same priced model reached two ways.
 *
 * Only the first path segment is dropped, and only when something follows it.
 */
export { canonicalModelName };

/**
 * How much a record should be trusted for the model it describes; higher wins.
 *
 * A vendor's own catalog entry is the list price. A reseller or marketplace
 * record (OpenRouter, aihubmix, 302ai…) may carry that reseller's markup or
 * subsidy — which is how `wb/glm-5.2` was stored as 0.032/12.00 against Z.AI's
 * 1.4/4.4. A hand-entered price outranks everything.
 */
const VENDOR_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'zai',
  'zhipuai',
  'moonshotai',
  'minimax',
  'stepfun',
  'xai',
  'xiaomi',
  'tencent-tokenhub',
  'alibaba',
  'meta',
  'mistralai',
]);

export function priceAuthority(price?: Pick<ModelPrice, 'source' | 'sourceModelId'>): number {
  if (!price) return 0;
  const source = String(price.source ?? '')
    .trim()
    .toLowerCase();
  if (source === 'manual') return 4;
  if (source !== 'models.dev') return 1;
  const sourceModelId = String(price.sourceModelId ?? '');
  const slash = sourceModelId.indexOf('/');
  if (slash < 0) return 1;
  return VENDOR_PROVIDERS.has(sourceModelId.slice(0, slash).toLowerCase()) ? 3 : 1;
}

/**
 * Collapses prefix variants onto one price per canonical model name, so a
 * route prefix cannot change what a model costs, and the price page shows one
 * row per model instead of one per route.
 *
 * The canonical (bare) key always wins when it already has a price: it is
 * either hand-entered or a deliberate earlier decision. Among prefixed
 * variants, the highest-authority record wins, with a stable tiebreak on the
 * sorted key so the result is reproducible.
 */
export function mergeModelPricesByCanonicalName(
  prices: Record<string, ModelPrice>
): Record<string, ModelPrice> {
  const entries = Object.entries(prices);
  if (entries.length === 0) return prices;

  const bare = new Set<string>();
  for (const [key] of entries) {
    if (canonicalModelName(key) === key) bare.add(key);
  }

  const winners = new Map<string, { key: string; price: ModelPrice }>();
  for (const [key, price] of entries.slice().sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const target = canonicalModelName(key);
    // A bare row already owns this model name; skip the prefixed variant.
    if (bare.has(target) && key !== target) continue;
    const incumbent = winners.get(target);
    if (!incumbent || priceAuthority(price) > priceAuthority(incumbent.price)) {
      winners.set(target, { key, price });
    }
  }

  const merged: Record<string, ModelPrice> = {};
  for (const [key, price] of entries) {
    if (canonicalModelName(key) === key) merged[key] = price;
  }
  for (const [target, { price }] of winners) {
    merged[target] = price;
  }
  return merged;
}

export type ModelPriceCandidateGroup = {
  source: string;
  candidates: ModelPriceSyncCandidate[];
};

export const createEmptyPriceDraft = (): PriceDraft => ({
  model: '',
  prompt: '',
  completion: '',
  cache: '',
  cacheRead: '',
  cacheCreation: '',
  contextTiers: [],
  serviceTiers: [],
});

const createConfiguredDraftValue = (value: number | undefined, configured?: boolean): string =>
  configured || Number(value) > 0 ? String(Number(value) || 0) : '';

const createRulePriceDraft = (
  rule: ModelPriceContextTier | ModelPriceServiceTier
): PriceRuleDraft => ({
  prompt: createConfiguredDraftValue(rule.prompt, rule.promptConfigured),
  completion: createConfiguredDraftValue(rule.completion, rule.completionConfigured),
  cache: createConfiguredDraftValue(rule.cache, rule.cacheConfigured),
  cacheRead: createConfiguredDraftValue(rule.cacheRead, rule.cacheReadConfigured),
  cacheCreation: createConfiguredDraftValue(rule.cacheCreation, rule.cacheCreationConfigured),
});

export const createEmptyContextTierDraft = (): ContextTierDraft => ({
  thresholdTokens: '',
  prompt: '',
  completion: '',
  cache: '',
  cacheRead: '',
  cacheCreation: '',
});

export const createEmptyServiceTierDraft = (): ServiceTierDraft => ({
  mode: '',
  serviceTier: '',
  prompt: '',
  completion: '',
  cache: '',
  cacheRead: '',
  cacheCreation: '',
});

export const createPriceDraft = (model: string, price?: ModelPrice): PriceDraft => ({
  model,
  prompt: price ? createConfiguredDraftValue(price.prompt, price.promptConfigured) : '',
  completion: price ? createConfiguredDraftValue(price.completion, price.completionConfigured) : '',
  cache: price ? String(price.cache) : '',
  cacheRead: price ? createConfiguredDraftValue(price.cacheRead, price.cacheReadConfigured) : '',
  cacheCreation: price
    ? createConfiguredDraftValue(price.cacheCreation, price.cacheCreationConfigured)
    : '',
  contextTiers: (price?.contextTiers ?? []).map((tier) => ({
    thresholdTokens: String(tier.thresholdTokens),
    ...createRulePriceDraft(tier),
  })),
  serviceTiers: (price?.serviceTiers ?? []).map((tier) => ({
    mode: tier.mode,
    serviceTier: tier.serviceTier,
    ...createRulePriceDraft(tier),
  })),
});

export const parsePriceValue = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const PRICE_RULE_FIELDS = [
  'prompt',
  'completion',
  'cache',
  'cacheRead',
  'cacheCreation',
] as const satisfies readonly (keyof PriceRuleDraft)[];

const hasConfiguredRulePrice = (draft: PriceRuleDraft) =>
  PRICE_RULE_FIELDS.some((field) => draft[field].trim() !== '');

const hasInvalidRulePrice = (draft: PriceRuleDraft) =>
  PRICE_RULE_FIELDS.some((field) => {
    const value = draft[field].trim();
    if (!value) return false;
    const parsed = Number(value);
    return !Number.isFinite(parsed) || parsed < 0;
  });

export const validatePriceDraft = (draft: PriceDraft): PriceDraftValidationError | null => {
  const contextThresholds = new Set<number>();
  for (const tier of draft.contextTiers) {
    const threshold = Number(tier.thresholdTokens);
    if (!Number.isSafeInteger(threshold) || threshold <= 0) return 'context_threshold';
    if (contextThresholds.has(threshold)) return 'context_duplicate_threshold';
    contextThresholds.add(threshold);
    if (!hasConfiguredRulePrice(tier) || hasInvalidRulePrice(tier)) return 'context_price';
  }

  const serviceIdentifiers = new Set<string>();
  for (const tier of draft.serviceTiers) {
    const mode = tier.mode.trim().toLowerCase();
    const serviceTier = tier.serviceTier.trim().toLowerCase();
    if (!mode || !serviceTier) return 'service_identity';
    if (serviceIdentifiers.has(mode) || serviceIdentifiers.has(serviceTier)) {
      return 'service_duplicate_identity';
    }
    serviceIdentifiers.add(mode);
    serviceIdentifiers.add(serviceTier);
    if (!hasConfiguredRulePrice(tier) || hasInvalidRulePrice(tier)) return 'service_price';
  }
  return null;
};

const buildRulePrice = (draft: PriceRuleDraft) => ({
  prompt: parsePriceValue(draft.prompt),
  completion: parsePriceValue(draft.completion),
  cache: parsePriceValue(draft.cache),
  cacheRead: parsePriceValue(draft.cacheRead),
  cacheCreation: parsePriceValue(draft.cacheCreation),
  promptConfigured: draft.prompt.trim() !== '',
  completionConfigured: draft.completion.trim() !== '',
  cacheConfigured: draft.cache.trim() !== '',
  cacheReadConfigured: draft.cacheRead.trim() !== '',
  cacheCreationConfigured: draft.cacheCreation.trim() !== '',
});

export const buildPriceFromDraft = (draft: PriceDraft): ModelPrice | null => {
  const model = draft.model.trim();
  if (!model || validatePriceDraft(draft)) return null;
  const prompt = parsePriceValue(draft.prompt);
  const completion = parsePriceValue(draft.completion);
  const cache = draft.cache.trim() === '' ? prompt : parsePriceValue(draft.cache);
  return {
    prompt,
    completion,
    cache,
    cacheRead: parsePriceValue(draft.cacheRead),
    cacheCreation: parsePriceValue(draft.cacheCreation),
    promptConfigured: draft.prompt.trim() !== '',
    completionConfigured: draft.completion.trim() !== '',
    cacheReadConfigured: draft.cacheRead.trim() !== '',
    cacheCreationConfigured: draft.cacheCreation.trim() !== '',
    source: 'manual',
    contextTiers: draft.contextTiers
      .map((tier) => ({
        thresholdTokens: Number(tier.thresholdTokens),
        ...buildRulePrice(tier),
      }))
      .sort((left, right) => left.thresholdTokens - right.thresholdTokens),
    serviceTiers: draft.serviceTiers
      .map((tier) => ({
        mode: tier.mode.trim().toLowerCase(),
        serviceTier: tier.serviceTier.trim().toLowerCase(),
        ...buildRulePrice(tier),
      }))
      .sort(
        (left, right) =>
          left.mode.localeCompare(right.mode) || left.serviceTier.localeCompare(right.serviceTier)
      ),
  };
};

export const applyCandidatePrice = (
  prices: Record<string, ModelPrice>,
  model: string,
  candidate: ModelPriceSyncCandidate
): Record<string, ModelPrice> => ({
  ...prices,
  [model]: {
    ...candidate.price,
    source: candidate.price.source || 'sync',
    sourceModelId: candidate.sourceModelId,
  },
});

export const getModelPriceCandidateSource = (candidate: ModelPriceSyncCandidate) =>
  candidate.price.source?.trim() || 'sync';

export const getModelPriceCandidateIdentity = (candidate: ModelPriceSyncCandidate) =>
  JSON.stringify([getModelPriceCandidateSource(candidate), candidate.sourceModelId]);

export const groupModelPriceCandidatesBySource = (
  candidates: ModelPriceSyncCandidate[]
): ModelPriceCandidateGroup[] => {
  const groups = new Map<string, ModelPriceSyncCandidate[]>();
  candidates.forEach((candidate) => {
    const source = getModelPriceCandidateSource(candidate);
    const group = groups.get(source);
    if (group) {
      group.push(candidate);
      return;
    }
    groups.set(source, [candidate]);
  });
  return Array.from(groups, ([source, sourceCandidates]) => ({
    source,
    candidates: sourceCandidates,
  }));
};

/**
 * Route prefixes whose upstream has been retired from this deployment.
 *
 * Retiring a source removes it from the CPA registry, but its historical
 * `usage_events` rows stay in SQLite forever, and models.dev keeps listing the
 * vendor globally. Without this filter the price sync would re-import the
 * retired vendor's catalogue on the next run — the rows would come back no
 * matter how often they are deleted.
 *
 * `step/` (StepFun) was retired 2026-10-06: prepaid balance went to -¥0.11 and
 * requests returned `quota_exceeded`.
 */
export const RETIRED_ROUTE_PREFIXES = ['step/'];

/**
 * Bare names belonging to a retired vendor.
 *
 * Needed because the prefix strip runs first: a price row stored as
 * `step-3.7-flash` (or a usage event already canonicalised) carries no `/`,
 * so a prefix test alone would let it through and the sync would re-import it.
 *
 * `step-5-preview` is deliberately **absent**: WorkBuddy (`wb/`) resells that
 * same model today, so the bare name is live and must not be condemned. The
 * precedence matters because `isRetiredRoute` cannot distinguish a bare row
 * that came from the retired `step/` route from one that is merely the
 * canonical form of `wb/step-5-preview` — `canonicalModelName` strips both to
 * the same string. Condemning the name therefore hides a live model's row and
 * skips it during price sync. Retirement of the StepFun *route* is still
 * covered by `RETIRED_ROUTE_PREFIXES`, which is precise: it matches
 * `step/step-5-preview` and leaves `wb/step-5-preview` alone.
 */
export const RETIRED_MODEL_NAMES = new Set([
  'step-1o-turbo-vision',
  'step-3.5-flash',
  'step-3.5-flash-2603',
  'step-3.7-flash',
  'step-gui',
  'step-router-v1',
]);

export const isRetiredRoute = (model: string): boolean => {
  const normalized = String(model ?? '')
    .trim()
    .toLowerCase();
  if (RETIRED_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return RETIRED_MODEL_NAMES.has(canonicalModelName(normalized));
};

export const buildSyncPriceModelsFromSummary = (
  summary: ModelPriceUsageSummaryResponse | null,
  prices: Record<string, ModelPrice>,
  runtimeModels: string[] = []
) => {
  // Sync only models this deployment can still call. Existing rows are kept
  // so their advanced rules can refresh; historical usage names that are no
  // longer runtime models must not resurrect deleted prices.
  const active = new Set(runtimeModels.map((model) => canonicalModelName(model)));
  const models = new Set<string>();
  Object.keys(prices).forEach((model) => {
    if (!isRetiredRoute(model)) models.add(canonicalModelName(model));
  });
  summary?.models?.forEach((item) => {
    const canonical = canonicalModelName(item.model ?? '');
    if (canonical && active.has(canonical) && !isRetiredRoute(item.model)) {
      models.add(canonical);
    }
  });
  return Array.from(models)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
};

export const buildCandidateMap = (candidateSets: ModelPriceSyncCandidateSet[] = []) => {
  const map = new Map<string, ModelPriceSyncCandidate[]>();
  candidateSets.forEach((set) => {
    if (!set.model || !Array.isArray(set.candidates) || set.candidates.length === 0) return;
    const canonical = canonicalModelName(set.model);
    // A model reached through two prefixes offers the same alternatives twice.
    map.set(canonical, [...(map.get(canonical) ?? []), ...set.candidates]);
  });
  return map;
};

export const buildModelPriceRows = (
  summary: ModelPriceUsageSummaryResponse | null,
  prices: Record<string, ModelPrice>,
  candidateSets: ModelPriceSyncCandidateSet[] = [],
  runtimeModels: string[] = []
): ModelPriceRow[] => {
  const rowMap = new Map<string, ModelPriceRow>();
  const candidateMap = buildCandidateMap(candidateSets);

  const ensureRow = (model: string): ModelPriceRow => {
    // Rows are keyed by canonical name: `wb/hy4-preview-f` and `hy4-preview-f`
    // are one model, and the page shows one row for it under the bare name.
    const canonical = canonicalModelName(model);
    const existing = rowMap.get(canonical);
    if (existing) return existing;
    const price = prices[canonical];
    const row: ModelPriceRow = {
      model: canonical,
      calls: 0,
      requestedCalls: 0,
      resolvedCalls: 0,
      routes: [],
      hasPrice: Boolean(price),
      price,
      candidateCount: 0,
      // Never inferred from the mere presence of a `wb/` runtime id: an
      // unpriced route only makes the *displayed number* an estimate when that
      // route actually carried traffic (set below from the usage summary).
      estimatedPrice: false,
      // Provisional only: `retiredRoute` is re-derived per row from the routes
      // that actually carried traffic once the summary is folded in, because a
      // row is keyed by canonical name and several routes may share it.
      retiredRoute: isRetiredRoute(model),
    };
    rowMap.set(canonical, row);
    return row;
  };

  Object.keys(prices).forEach(ensureRow);
  // A candidate set is a model the backend proposed a price for; it must keep a
  // row even with no traffic and no saved price, or the "needs confirmation"
  // list would be empty for a model that only ever appears as a candidate.
  candidateMap.forEach((_candidates, model) => ensureRow(model));
  runtimeModels.forEach((model) => {
    const trimmed = typeof model === 'string' ? model.trim() : '';
    if (trimmed) ensureRow(trimmed);
  });

  const summaryModels = (summary?.models ?? []).filter((item) => item.model);
  summaryModels.forEach((item) => ensureRow(item.model));

  // A single request appears as *two* summary rows — the name the client asked
  // for (`requested_model`, e.g. `wb/glm-5.3`) and the name it resolved to
  // (`resolved_model`, e.g. `glm-5.3`). They are views of one request, not two
  // disjoint sets, so adding them together reports every call twice.
  //
  // Keep the per-route requested breakdown (it is the only place the prefix
  // lives, and the prefix is what decides estimate-vs-list price), but take the
  // larger of the two views as the request count: the resolved total also
  // covers requests whose requested name was not recorded, while the requested
  // total is the only one that preserves routing. Both count each request once.
  const routedCalls = new Map<string, Map<string, number>>();
  const resolvedTotal = new Map<string, number>();

  summaryModels.forEach((item) => {
    const row = ensureRow(item.model);
    const requested = Number(item.requested_calls) || 0;
    const resolved = Number(item.resolved_calls) || 0;
    row.requestedCalls += requested;
    row.resolvedCalls += resolved;
    if (resolved > 0) {
      resolvedTotal.set(row.model, (resolvedTotal.get(row.model) ?? 0) + resolved);
    }
    if (requested > 0) {
      const byRoute = routedCalls.get(row.model) ?? new Map<string, number>();
      const route = routePrefixOf(item.model);
      byRoute.set(route, (byRoute.get(route) ?? 0) + requested);
      routedCalls.set(row.model, byRoute);
    }
  });

  rowMap.forEach((row) => {
    const byRoute = routedCalls.get(row.model) ?? new Map<string, number>();
    const routedSum = Array.from(byRoute.values()).reduce((sum, n) => sum + n, 0);
    row.calls = Math.max(routedSum, resolvedTotal.get(row.model) ?? 0);
    row.routes = Array.from(byRoute, ([route, calls]) => ({ route, calls })).sort(
      (left, right) => right.calls - left.calls || left.route.localeCompare(right.route)
    );
    // Only routes that actually carried traffic can make the price an estimate,
    // and `usage.route` is already in prefix form (`wb/`) — exactly what
    // `isUnpricedUpstreamRoute` matches on. A bare runtime id never sets this.
    row.estimatedPrice = row.routes.some(
      (usage) => usage.calls > 0 && isUnpricedUpstreamRoute(usage.route)
    );
    // Retirement is a property of the row's *routes*, not of whichever name
    // happened to create it. Rows are keyed by canonical name, so the retired
    // `step/step-5-preview` and the live `wb/step-5-preview` share one row;
    // latching the flag at creation let a dead route hide a live one (or the
    // reverse) depending on iteration order.
    //
    // A live *named* route wins outright: the page is about prices this
    // deployment still pays, so one working route justifies the row. A bare
    // route (`''`, from a resolved-only summary row) names no source and so
    // decides nothing — only an all-retired set of named routes condemns the
    // row. With no named route at all, the row's own name is the only evidence
    // left, which is all a stored price row carries.
    const namedRoutes = row.routes.filter((usage) => usage.route !== '');
    row.retiredRoute =
      namedRoutes.length > 0
        ? namedRoutes.every((usage) => isRetiredRoute(usage.route))
        : isRetiredRoute(row.model);
    const candidates = candidateMap.get(row.model);
    row.candidateCount = candidates?.length ?? 0;
  });

  // Retired routes are dropped last, so their historical events do not keep a
  // row alive on a page about prices this deployment still pays.
  return Array.from(rowMap.values())
    .filter((row) => !row.retiredRoute)
    .sort(
      (left, right) =>
        Number(left.hasPrice) - Number(right.hasPrice) ||
        right.candidateCount - left.candidateCount ||
        right.calls - left.calls ||
        left.model.localeCompare(right.model)
    );
};

export const buildModelPriceSummary = (rows: ModelPriceRow[]): ModelPriceSummary => {
  const saved = rows.filter((row) => row.hasPrice).length;
  const candidates = rows.filter((row) => !row.hasPrice && row.candidateCount > 0).length;
  return {
    total: rows.length,
    saved,
    missing: rows.length - saved,
    candidates,
  };
};

export const filterModelPriceRows = (
  rows: ModelPriceRow[],
  filter: ModelPriceFilter,
  search: string
) => {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'missing' && row.hasPrice) return false;
    if (filter === 'saved' && !row.hasPrice) return false;
    if (filter === 'candidates' && (row.hasPrice || row.candidateCount === 0)) return false;
    if (!query) return true;
    return (
      row.model.toLowerCase().includes(query) ||
      row.price?.sourceModelId?.toLowerCase().includes(query) ||
      row.price?.source?.toLowerCase().includes(query)
    );
  });
};

/**
 * Every stored price is USD per 1,000,000 tokens; the DB columns are literally
 * `*_per_1m` and `calculateCost` divides tokens by `TOKENS_PER_PRICE_UNIT`.
 * Formatting must never round a real sub-cent price down to `$0.0000`, because
 * that reads as "free" next to a genuinely unpriced (`--`) model.
 */
export const PRICE_UNIT_LABEL = 'USD / 1M tokens';

/** Significant digits kept before falling back to exponential form. */
const PRICE_SIGNIFICANT_DIGITS = 4;

/** Every ordinary price is shown with three decimal places. */
const PRICE_DECIMALS = 3;

export const formatPriceUnit = (value: number | undefined) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `$${formatPriceAmount(num)}`;
};

/**
 * Digit budget by magnitude, so `1.40` does not print as `$1.4000` and
 * `0.000064` does not collapse to `$0.0001` (which would misstate the price).
 * Values at or above $1 keep two decimals — the conventional money shape —
 * but only when that does not silently drop a significant digit.
 */
export function formatPriceAmount(num: number): string {
  if (num === 0) return '0.000';
  const magnitude = Math.abs(num);
  if (magnitude < 0.001) {
    return num.toExponential(PRICE_SIGNIFICANT_DIGITS - 1);
  }
  return num.toFixed(PRICE_DECIMALS);
}

/**
 * Where a price came from, as far as cost of being wrong goes.
 *
 * - `official`  — the vendor's own catalog entry for its own model
 * - `aggregator`— a reseller/marketplace record (OpenRouter, aihubmix, 302ai…)
 *                 that may carry that reseller's markup or subsidy
 * - `manual`    — entered by hand in this panel
 *
 * Confidence is a property of the *record*, not of the route that reached it:
 * the prefix is stripped before pricing (see `canonicalModelName`), so a model
 * is never "less official" for having been called through WorkBuddy.
 */
export type PriceConfidence = 'official' | 'aggregator' | 'manual' | 'none';

export function classifyPriceConfidence(
  price?: Pick<ModelPrice, 'source' | 'sourceModelId'>
): PriceConfidence {
  if (!price || !String(price.source ?? '').trim()) return 'none';
  const authority = priceAuthority(price);
  if (authority === 4) return 'manual';
  return authority === 3 ? 'official' : 'aggregator';
}

/**
 * Routes whose upstream publishes no per-token price at all.
 *
 * `wb/` goes through the codebuddy2api gateway to CodeBuddy, which lists no
 * public price and has no models.dev entry. Whatever the table shows for a
 * model reached this way is *borrowed* from a comparable public model, so it is
 * good for magnitude comparison and nothing else.
 *
 * This is deliberately separate from `PriceConfidence`: the prefix must not
 * change what a model costs (see `canonicalModelName`), but it does change how
 * much the cost estimate can be trusted. One is about the price, the other
 * about the estimate.
 */
const UNPRICED_UPSTREAM_PREFIXES = ['wb/'];

export const isUnpricedUpstreamRoute = (model: string): boolean => {
  const normalized = String(model ?? '')
    .trim()
    .toLowerCase();
  return UNPRICED_UPSTREAM_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

/**
 * The routing prefix of a runtime model id, or `''` for a bare name.
 *
 * Inverse of the strip in `canonicalModelName`: only the first segment counts,
 * and only when something follows it. Keeping it as a prefix (not a bare name)
 * means the result can be fed straight back to `isUnpricedUpstreamRoute`.
 */
export const routePrefixOf = (model: string): string => {
  const trimmed = String(model ?? '').trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return '';
  return `${trimmed.slice(0, slash)}/`;
};

export const resolveContextTierDisplayPrice = (
  price: ModelPrice | undefined,
  tier: ModelPriceContextTier
) => ({
  prompt: tier.promptConfigured ? tier.prompt : price?.prompt,
  completion: tier.completionConfigured ? tier.completion : price?.completion,
});

export const resolveServiceTierDisplayPrice = (
  price: ModelPrice | undefined,
  tier: ModelPriceServiceTier
) => ({
  prompt: tier.promptConfigured ? tier.prompt : price?.prompt,
  completion: tier.completionConfigured ? tier.completion : price?.completion,
});

export const formatServiceTierRule = (tier: ModelPriceServiceTier) => {
  const mode = tier.mode.trim();
  const serviceTier = tier.serviceTier.trim();
  if (!mode) return serviceTier || '--';
  if (!serviceTier || mode.toLowerCase() === serviceTier.toLowerCase()) return mode;
  return `${mode}/${serviceTier}`;
};

export const formatContextThreshold = (value: number) => {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return '--';
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}K`;
  return tokens.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
