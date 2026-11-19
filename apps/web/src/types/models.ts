/**
 * 本机模型快照。
 *
 * cpa refresh 把统一目录收成 ~/.cache/cpa-models/latest.json，sidecar
 * 以 /models.json 暴露。字段是一次调用实际会用的档位和窗口，不是上游原文。
 */

export interface ModelRecord {
  id: string;
  source: string;
  available?: boolean | null;
  effort?: string | null;
  levels: string[];
  context_window?: number | null;
  max_context_window?: number | null;
  max_output_tokens?: number | null;
  input: string[];
  issues: string[];
}

export interface ModelSnapshot {
  collected_at: string;
  origin: 'live' | 'catalog' | string;
  models: ModelRecord[];
}
