/**
 * 第三方余额快照类型
 *
 * 对应本机 cpa-balance 采集链路（~/.cache/cpa-balance/latest.json）
 * 通过本地 sidecar（127.0.0.1:18427）暴露的 JSON 结构。
 */

/** sub2api 平台配额的一个时间窗口 */
export interface BalanceQuotaWindow {
  limit_usd?: number | null;
  usage_usd?: number | null;
}

/** sub2api 记录中的平台配额 */
export interface BalancePlatformQuota {
  platform: string;
  daily?: BalanceQuotaWindow | null;
  weekly?: BalanceQuotaWindow | null;
  monthly?: BalanceQuotaWindow | null;
}

export type BalanceStrategy =
  | 'newapi_console'
  | 'openai_dashboard'
  | 'sub2api'
  | 'deepseek'
  | 'stepfun'
  | 'zhipu';

/** GLM Coding Plan 的一个额度窗口（token 窗口或 MCP 次数窗口） */
export interface BalanceQuotaUsageWindow {
  /** tokens = 5h/7d 滚动窗口；mcp = 月度工具调用次数；上游新增类型时原样透传 */
  kind?: string;
  /** 已本地化的窗口名（"5h" / "7d" / "MCP"），由采集端定，面板原样显示 */
  label?: string;
  /** 已用百分比（0–100） */
  used_percent?: number | null;
  /** mcp 窗口的已用次数 / 上限 / 剩余 */
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  /** 窗口下次重置时间（epoch 秒） */
  reset_at?: number | null;
}

/** 单条余额记录；按 strategy 不同字段可缺省 */
export interface BalanceRecord {
  source: string;
  strategy?: BalanceStrategy | string;
  ok?: boolean | null;
  currency?: string;
  note?: string;
  // newapi_console
  balance?: number | null;
  consumed_usd?: number | null;
  used_window_usd?: number | null;
  request_count?: number | null;
  group?: string | null;
  limit_usd?: number | null;
  // openai_dashboard
  used_usd?: number | null;
  credits_remaining?: number | null;
  access_until?: number | null;
  // sub2api
  token_count?: number | null;
  today_usd?: number | null;
  frozen?: boolean | null;
  platform_quotas?: BalancePlatformQuota[] | null;
  // deepseek
  granted?: number | null;
  topped_up?: number | null;
  // stepfun
  account_type?: string | null;
  cash?: number | null;
  voucher?: number | null;
  // zhipu（订阅制：无钱包，只有窗口百分比）
  windows?: BalanceQuotaUsageWindow[] | null;
  plan?: string | null;
  /** 某个 token 窗口已用尽；不等同于欠费，仅用于展示 */
  exhausted?: boolean | null;
}

/** 一次采集的完整快照 */
export interface BalanceSnapshot {
  collected_at: string;
  records: BalanceRecord[];
}
