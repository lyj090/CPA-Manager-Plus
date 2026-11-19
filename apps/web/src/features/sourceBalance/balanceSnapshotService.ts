import type { BalanceRecord, BalanceSnapshot } from '@/types/balance';

/**
 * 第三方余额快照数据源
 *
 * 本机 cpa-balance 采集链路每 30 分钟把各 API 平台的余额快照写入
 * ~/.cache/cpa-balance/latest.json，本地 sidecar 服务（cpa-balance-view）
 * 直接读取该文件并通过 HTTP 暴露（带 Access-Control-Allow-Origin: *）。
 * 端点固定为本机回环地址，不做成可配置项。
 */
export const BALANCE_SNAPSHOT_URL = 'http://127.0.0.1:18427/latest.json';

function normalizeRecord(value: unknown): BalanceRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.source !== 'string' || !record.source) {
    return null;
  }
  return value as BalanceRecord;
}

export async function fetchBalanceSnapshot(signal?: AbortSignal): Promise<BalanceSnapshot> {
  const response = await fetch(BALANCE_SNAPSHOT_URL, { signal });
  if (!response.ok) {
    throw new Error(`balance snapshot request failed: ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('balance snapshot payload is not an object');
  }
  const data = payload as Record<string, unknown>;
  const records = Array.isArray(data.records)
    ? data.records.map(normalizeRecord).filter((record): record is BalanceRecord => record !== null)
    : [];
  return {
    collected_at: typeof data.collected_at === 'string' ? data.collected_at : '',
    records,
  };
}
