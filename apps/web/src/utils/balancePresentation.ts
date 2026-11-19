/**
 * 第三方余额展示纯函数
 *
 * 显示规范的唯一权威是本机 CLI `cpa-balance.py`（dotfiles/cpa/bin/cpa-balance.py）里的
 * `write_snapshot` 与 `render_row`：这里的金额/日期格式化、状态/剩余额度/已用/备注的
 * 组合规则都必须与其保持语义一致。默认文案（defaultBalanceStrings）逐字沿用 CLI 输出，
 * 页面通过 buildBalanceStrings 传入本地化文案时也保持同一语义。
 */
import { parseTimestampMs } from './timestamp';
import type {
  BalanceQuotaUsageWindow,
  BalanceQuotaWindow,
  BalanceRecord,
} from '@/types/balance';

/** 快照过期阈值：与 CLI STALE_AFTER_MINUTES 一致（2 小时） */
export const BALANCE_STALE_AFTER_MS = 120 * 60 * 1000;

/** 低余额告警阈值：与 CLI ALERT_USD 一致（2 USD） */
export const BALANCE_ALERT_USD = 2;

/** 行内备注分隔符：与 CLI render_row 一致 */
export const BALANCE_NOTE_SEPARATOR = ' · ';

/**
 * 拼接备注片段，跳过空值。每个 strategy 分支都要按需拼若干个 bit，
 * 四处 `const bits = []; if (x) bits.push(...); bits.join(SEP)` 是同一段
 * 机制抄了四遍；这个 helper 让每行备注写成一个表达式。
 */
export function joinNotes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(BALANCE_NOTE_SEPARATOR);
}

/** render_row 输出的一行（表格五列） */
export interface BalanceRow {
  source: string;
  status: string;
  remaining: string;
  used: string;
  note: string;
  ok: boolean | null;
}

/** 展示文案（默认值逐字对应 CLI render_row 输出） */
export interface BalanceStrings {
  /** ok === true：CLI 字面输出 "ok"，面板规范用「正常」 */
  statusOk: string;
  statusOverdue: string;
  statusUnknown: string;
  /** remaining/used 的空占位（CLI 用 ASCII "-"） */
  empty: string;
  unlimited: string;
  /** "$28.33 / $39.92" */
  limitPair: (amount: string, limit: string) => string;
  /** "$1.27 累计" */
  usedTotal: (amount: string) => string;
  /** "$1.27 日志累计" */
  usedLogTotal: (amount: string) => string;
  /** "1,234 次请求" */
  requests: (count: string) => string;
  /** "1,234 tokens" */
  tokens: (count: string) => string;
  /** "今日 $1.27" */
  today: (amount: string) => string;
  /** "日志累计 $1.27" */
  logTotal: (amount: string) => string;
  overdraft: string;
  /** "余 5 credits" */
  creditsRemaining: (count: string) => string;
  /** "到期 2026-09-24" */
  expires: (date: string) => string;
  /** deepseek/stepfun 欠费备注 */
  insufficient: string;
  /** "84% (7d)"：订阅制最紧窗口的剩余百分比 */
  windowRemaining: (percent: string, label: string) => string;
  /** "5h 12% · 7d 16%"：各 token 窗口的已用百分比 */
  windowUsage: (label: string, percent: string) => string;
  /** "套餐 pro" */
  plan: (name: string) => string;
  /** "额度用尽，按重置时间恢复" */
  quotaExhausted: string;
  /** "MCP 5/1,000" */
  mcpUsage: (used: string, limit: string) => string;
}

export const defaultBalanceStrings: BalanceStrings = {
  statusOk: '正常',
  statusOverdue: '欠费/停用',
  statusUnknown: '—',
  empty: '-',
  unlimited: '不限量',
  limitPair: (amount, limit) => `${amount} / ${limit}`,
  usedTotal: (amount) => `${amount} 累计`,
  usedLogTotal: (amount) => `${amount} 日志累计`,
  requests: (count) => `${count} 次请求`,
  tokens: (count) => `${count} tokens`,
  today: (amount) => `今日 ${amount}`,
  logTotal: (amount) => `日志累计 ${amount}`,
  overdraft: '钱包透支',
  creditsRemaining: (count) => `余 ${count} credits`,
  expires: (date) => `到期 ${date}`,
  insufficient: '余额不足，请求会被拒',
  windowRemaining: (percent, label) => `${percent}% (${label})`,
  windowUsage: (label, percent) => `${label} ${percent}%`,
  plan: (name) => `套餐 ${name}`,
  quotaExhausted: '额度用尽，按重置时间恢复',
  mcpUsage: (used, limit) => `MCP ${used}/${limit}`,
};

/** 金额格式化：镜像 CLI fmt_money（$ / ¥、千分位、两位小数、负数前置负号） */
export function fmtMoney(value: number | null | undefined, currency: string = 'USD'): string {
  if (value === null || value === undefined) {
    return '-';
  }
  const symbol = currency === 'CNY' ? '¥' : '$';
  const sign = value < 0 ? '-' : '';
  const amount = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${amount}`;
}

/** 整数格式化：镜像 CLI 的 `f"{n:,}"`（千分位、不舍入） */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return Math.round(value).toLocaleString('en-US');
}

const pad2 = (value: number) => String(value).padStart(2, '0');

const fmtLocalDate = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** epoch 秒 → YYYY-MM-DD：镜像 CLI fmt_timestamp */
export function fmtEpochDate(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) {
    return '-';
  }
  return fmtLocalDate(new Date(epochSeconds * 1000));
}

/** ISO 时间 → 本地 "YYYY-MM-DD HH:MM"：镜像 CLI 快照头 `余额快照 {时间}` 的格式 */
export function fmtSnapshotTime(iso: string | null | undefined): string {
  const ms = parseTimestampMs(iso ?? '');
  if (!Number.isFinite(ms)) {
    return '-';
  }
  const date = new Date(ms);
  return `${fmtLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 快照是否过期：镜像 CLI print_cached（超过 2 小时或时间不可解析均视为过期） */
export function isSnapshotStale(
  collectedAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const ms = parseTimestampMs(collectedAt ?? '');
  if (!Number.isFinite(ms)) {
    return true;
  }
  return nowMs - ms > BALANCE_STALE_AFTER_MS;
}

/**
 * 低余额/欠费来源：镜像 CLI alert_sources
 * （ok === false，或 0 <= balance < 阈值，阈值默认 2 USD）
 */
export function collectAlertSources(
  records: BalanceRecord[],
  threshold: number = BALANCE_ALERT_USD
): string[] {
  const warned: string[] = [];
  for (const record of records) {
    if (record.ok === false) {
      warned.push(record.source);
      continue;
    }
    const balance = record.balance;
    if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0 && balance < threshold) {
      warned.push(record.source);
    }
  }
  return warned;
}

/**
 * 渲染一行表格：镜像 CLI render_row 的列语义与组合规则。
 * 备注列按 strategy 组合；openai_dashboard / newapi_console / sub2api 会用组合结果
 * 覆盖记录自带 note（与 CLI 一致），无 strategy 的记录整行只显示 note。
 */
export function renderBalanceRow(
  record: BalanceRecord,
  strings: BalanceStrings = defaultBalanceStrings
): BalanceRow {
  const ok = typeof record.ok === 'boolean' ? record.ok : null;
  const status = ok ? strings.statusOk : ok === false ? strings.statusOverdue : strings.statusUnknown;
  let remaining = strings.empty;
  let used = strings.empty;
  let note = record.note ?? '';
  const currency = record.currency ?? 'USD';

  if (record.strategy === 'openai_dashboard') {
    if (record.limit_usd === null || record.limit_usd === undefined) {
      remaining = strings.unlimited;
    } else {
      remaining = strings.limitPair(
        fmtMoney(record.balance, currency),
        fmtMoney(record.limit_usd, currency)
      );
    }
    used = strings.usedTotal(fmtMoney(record.used_usd, currency));
    note = joinNotes(
      record.credits_remaining !== null && record.credits_remaining !== undefined
        ? strings.creditsRemaining(fmtCount(record.credits_remaining))
        : null,
      record.access_until ? strings.expires(fmtEpochDate(record.access_until)) : null
    );
  } else if (record.strategy === 'newapi_console') {
    remaining = fmtMoney(record.balance, currency);
    const windowUsed = record.used_window_usd;
    const hasWindow = windowUsed !== null && windowUsed !== undefined;
    const hasConsumed = record.consumed_usd !== null && record.consumed_usd !== undefined;
    if (hasWindow) {
      used = strings.usedTotal(fmtMoney(windowUsed, currency));
    } else if (hasConsumed) {
      used = strings.usedLogTotal(fmtMoney(record.consumed_usd, currency));
    }
    note = joinNotes(
      record.request_count ? strings.requests(fmtCount(record.request_count)) : null,
      hasWindow && hasConsumed ? strings.logTotal(fmtMoney(record.consumed_usd, currency)) : null,
      record.balance !== null && record.balance !== undefined && record.balance < 0
        ? strings.overdraft
        : null
    );
  } else if (record.strategy === 'sub2api') {
    remaining = fmtMoney(record.balance, currency);
    const consumed = record.consumed_usd;
    used = consumed !== null && consumed !== undefined ? strings.usedTotal(fmtMoney(consumed, currency)) : strings.empty;
    note = joinNotes(
      record.request_count ? strings.requests(fmtCount(record.request_count)) : null,
      record.token_count ? strings.tokens(fmtCount(record.token_count)) : null,
      record.today_usd ? strings.today(fmtMoney(record.today_usd, currency)) : null
    );
  } else if (record.strategy === 'zhipu') {
    // 订阅制没有钱可显示：两个金额列改放百分比。只有 token 窗口进这两列，
    // MCP 是每月次数、量纲不同，混进来会让「已用」列自相矛盾。
    // 最紧的窗口占据「剩余额度」——套餐按先撞到的那个上限限流。
    const tokenWindows = tokenQuotaWindows(record);
    if (tokenWindows.length > 0) {
      // tokenQuotaWindows 保证 used_percent 非空，所以这里无需 ?? 0 兜底。
      const worst = tokenWindows.reduce((a, b) =>
        (b.used_percent as number) > (a.used_percent as number) ? b : a
      );
      remaining = strings.windowRemaining(
        fmtPercent(100 - (worst.used_percent as number)),
        worst.label || '?'
      );
      used = tokenWindows
        .map((window) => strings.windowUsage(window.label || '?', fmtPercent(window.used_percent)))
        .join(BALANCE_NOTE_SEPARATOR);
    }
    note = joinNotes(
      record.plan ? strings.plan(record.plan) : null,
      record.exhausted ? strings.quotaExhausted : null,
      ...mcpQuotaWindows(record).map((window) =>
        strings.mcpUsage(fmtCount(window.used), fmtCount(window.limit))
      )
    );
  } else if (record.strategy === 'deepseek' || record.strategy === 'stepfun') {
    remaining = fmtMoney(record.balance, currency);
    if (ok === false) {
      note = note || strings.insufficient;
    }
    if (record.strategy === 'stepfun' && record.account_type) {
      note = `${record.account_type}${note ? `${BALANCE_NOTE_SEPARATOR}${note}` : ''}`;
    }
  }

  return { source: record.source, status, remaining, used, note, ok };
}

/** 取某一类额度窗口（tokens / mcp），过滤掉结构不合法的条目 */
export function quotaUsageWindows(
  record: BalanceRecord,
  kind: string
): BalanceQuotaUsageWindow[] {
  const windows = record.windows;
  if (!Array.isArray(windows)) {
    return [];
  }
  return windows.filter(
    (window): window is BalanceQuotaUsageWindow =>
      Boolean(window) && typeof window === 'object' && window.kind === kind
  );
}

/**
 * 只保留可画条的 token 窗口：后端保证 token 窗口都带 used_percent，
 * 缺这个字段的条目（老快照或上游改字段）不能画成 0% 已用。
 */
export function tokenQuotaWindows(record: BalanceRecord): BalanceQuotaUsageWindow[] {
  return quotaUsageWindows(record, 'tokens').filter(
    (window) => window.used_percent !== null && window.used_percent !== undefined
  );
}

/** 只有带 limit 的 MCP 窗口才有「剩多少 / 共多少」可写。 */
export function mcpQuotaWindows(record: BalanceRecord): BalanceQuotaUsageWindow[] {
  return quotaUsageWindows(record, 'mcp').filter(
    (window) => window.limit !== null && window.limit !== undefined
  );
}

/**
 * 该记录是否有展开区可显示。给页面判断用：先问这个，再决定要不要渲染行，
 * 避免为了判断长度而先构造一遍 JSX。
 */
export function hasQuotaDetails(record: BalanceRecord): boolean {
  return (
    (record.platform_quotas?.length ?? 0) > 0 ||
    tokenQuotaWindows(record).length > 0 ||
    mcpQuotaWindows(record).length > 0
  );
}

/**
 * 百分比格式化：输出不含 `%`，由调用方经 BalanceStrings 拼单位。
 * 与 CLI `render_row` 的 `{:.0f}` 对齐到整数刻度；唯一差异是恰好 `.5` 时
 * JS 半数进位、Python 半数取偶（82.5 → 83 / 82）。百分比来自上游的整数刻度，
 * 只有人为构造的 .5 才碰得到，为它复刻 Python 的二进制取偶规则不值得。
 */
export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return String(Math.round(value));
}

/** 距离重置还有多久："5h 20m" / "3d 2h"；已过期返回空串 */
export function fmtResetCountdown(
  epochSeconds: number | null | undefined,
  nowMs: number = Date.now()
): string {
  if (epochSeconds === null || epochSeconds === undefined) {
    return '';
  }
  const remainingMs = epochSeconds * 1000 - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return '';
  }
  const minutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** sub2api 平台配额窗口的一格："$usage / $limit" */
export function fmtQuotaWindow(window: BalanceQuotaWindow | null | undefined): string {
  if (!window) {
    return '-';
  }
  return `${fmtMoney(window.usage_usd)} / ${fmtMoney(window.limit_usd)}`;
}
