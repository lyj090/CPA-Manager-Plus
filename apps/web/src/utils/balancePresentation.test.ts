import { describe, expect, it } from 'vitest';
import {
  collectAlertSources,
  defaultBalanceStrings,
  fmtCount,
  fmtEpochDate,
  fmtMoney,
  fmtQuotaWindow,
  fmtSnapshotTime,
  isSnapshotStale,
  renderBalanceRow,
  BALANCE_STALE_AFTER_MS,
  fmtResetCountdown,
  hasQuotaDetails,
  mcpQuotaWindows,
  quotaUsageWindows,
  tokenQuotaWindows,
} from './balancePresentation';
import type { BalanceRecord } from '@/types/balance';

describe('fmtMoney', () => {
  it('formats USD with $ and two decimals', () => {
    expect(fmtMoney(1.27)).toBe('$1.27');
    expect(fmtMoney(0)).toBe('$0.00');
  });

  it('formats CNY with ¥', () => {
    expect(fmtMoney(0.59, 'CNY')).toBe('¥0.59');
  });

  it('keeps the minus sign in front of the symbol for negative balances', () => {
    expect(fmtMoney(-0.39)).toBe('-$0.39');
  });

  it('groups thousands', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
  });

  it('returns "-" for missing values', () => {
    expect(fmtMoney(null)).toBe('-');
    expect(fmtMoney(undefined)).toBe('-');
  });
});

describe('fmtCount', () => {
  it('groups thousands and rounds to integers', () => {
    expect(fmtCount(1234)).toBe('1,234');
    expect(fmtCount(5.4)).toBe('5');
  });

  it('returns "-" for missing values', () => {
    expect(fmtCount(null)).toBe('-');
  });
});

describe('fmtEpochDate', () => {
  it('formats epoch seconds as YYYY-MM-DD in local time', () => {
    const date = new Date(2026, 8, 24);
    expect(fmtEpochDate(date.getTime() / 1000)).toBe('2026-09-24');
  });

  it('returns "-" for missing values', () => {
    expect(fmtEpochDate(null)).toBe('-');
  });
});

describe('fmtSnapshotTime', () => {
  it('formats ISO timestamps as local YYYY-MM-DD HH:MM', () => {
    const iso = new Date(2026, 8, 24, 3, 9, 9).toISOString();
    expect(fmtSnapshotTime(iso)).toBe('2026-09-24 03:09');
  });

  it('falls back to "-" for unparsable timestamps', () => {
    expect(fmtSnapshotTime('not-a-time')).toBe('-');
  });
});

describe('isSnapshotStale', () => {
  const collectedAt = '2026-09-24T03:09:09+08:00';

  it('is fresh within two hours and stale beyond', () => {
    const collectedMs = Date.parse(collectedAt);
    expect(isSnapshotStale(collectedAt, collectedMs + BALANCE_STALE_AFTER_MS - 1)).toBe(false);
    expect(isSnapshotStale(collectedAt, collectedMs + BALANCE_STALE_AFTER_MS + 1)).toBe(true);
  });

  it('treats unparsable timestamps as stale', () => {
    expect(isSnapshotStale(undefined, Date.now())).toBe(true);
  });
});

describe('collectAlertSources', () => {
  it('flags failed sources and thin wallets below the USD threshold', () => {
    const records: BalanceRecord[] = [
      { source: 'a', ok: false, balance: 50 },
      { source: 'b', ok: true, balance: 1.27 },
      { source: 'c', ok: true, balance: 0 },
      { source: 'd', ok: true, balance: 2 },
      { source: 'e', ok: true, balance: -0.39 },
      { source: 'f', ok: true },
    ];
    expect(collectAlertSources(records)).toEqual(['a', 'b', 'c']);
  });
});

describe('renderBalanceRow', () => {
  it('maps ok states like the CLI (true/false/null)', () => {
    expect(renderBalanceRow({ source: 'x', ok: true }).status).toBe('正常');
    expect(renderBalanceRow({ source: 'x', ok: false }).status).toBe('欠费/停用');
    expect(renderBalanceRow({ source: 'x', ok: null }).status).toBe('—');
    expect(renderBalanceRow({ source: 'x' }).status).toBe('—');
  });

  it('shows only the note when a record has no strategy', () => {
    expect(renderBalanceRow({ source: 'cctq', ok: null, note: '未找到 API key' })).toEqual({
      source: 'cctq',
      status: '—',
      remaining: '-',
      used: '-',
      note: '未找到 API key',
      ok: null,
    });
  });

  it('renders openai_dashboard rows: unlimited limit, used total, credits and expiry notes', () => {
    const unlimited = renderBalanceRow({
      source: 'codex',
      strategy: 'openai_dashboard',
      ok: true,
      limit_usd: null,
      used_usd: 12.5,
    });
    expect(unlimited.remaining).toBe('不限量');
    expect(unlimited.used).toBe('$12.50 累计');

    const limited = renderBalanceRow({
      source: 'codex',
      strategy: 'openai_dashboard',
      ok: true,
      used_usd: 11.59,
      limit_usd: 39.92,
      balance: 28.33,
      credits_remaining: 5,
      access_until: new Date(2026, 8, 24).getTime() / 1000,
    });
    expect(limited.remaining).toBe('$28.33 / $39.92');
    expect(limited.used).toBe('$11.59 累计');
    expect(limited.note).toBe('余 5 credits · 到期 2026-09-24');
  });

  it('renders newapi_console rows: window/log usage, requests and overdraft notes', () => {
    const windowed = renderBalanceRow({
      source: 'cctq',
      strategy: 'newapi_console',
      ok: true,
      balance: 1.27,
      used_window_usd: 8.35,
      consumed_usd: 107.82,
      request_count: 1234,
    });
    expect(windowed.remaining).toBe('$1.27');
    expect(windowed.used).toBe('$8.35 累计');
    expect(windowed.note).toBe('1,234 次请求 · 日志累计 $107.82');

    const logOnly = renderBalanceRow({
      source: 'cctq',
      strategy: 'newapi_console',
      ok: true,
      balance: -0.39,
      consumed_usd: 3.5,
    });
    expect(logOnly.used).toBe('$3.50 日志累计');
    expect(logOnly.note).toBe('钱包透支');
  });

  it('renders zhipu subscription rows: worst token window headlines remaining', () => {
    const row = renderBalanceRow({
      source: 'glm',
      strategy: 'zhipu',
      ok: true,
      plan: 'pro',
      windows: [
        { kind: 'tokens', label: '5h', used_percent: 12 },
        { kind: 'tokens', label: '7d', used_percent: 16 },
        { kind: 'mcp', label: 'MCP', used: 5, limit: 1000, used_percent: 1 },
      ],
    });
    // 7d 是更紧的窗口，所以它决定「剩余额度」；「已用」列出全部 token 窗口。
    expect(row.remaining).toBe('84% (7d)');
    expect(row.used).toBe('5h 12% · 7d 16%');
    expect(row.note).toBe('套餐 pro · MCP 5/1,000');
  });

  it('keeps the MCP count out of the percentage columns', () => {
    // MCP 是每月次数、量纲不同；混进百分比列会让「已用」自相矛盾。
    const row = renderBalanceRow({
      source: 'glm',
      strategy: 'zhipu',
      ok: true,
      windows: [{ kind: 'mcp', label: 'MCP', used: 900, limit: 1000, used_percent: 90 }],
    });
    expect(row.remaining).toBe('-');
    expect(row.used).toBe('-');
    expect(row.note).toBe('MCP 900/1,000');
  });

  it('flags an exhausted window without turning it into debt', () => {
    const row = renderBalanceRow({
      source: 'glm',
      strategy: 'zhipu',
      ok: null,
      exhausted: true,
      windows: [{ kind: 'tokens', label: '5h', used_percent: 100 }],
    });
    expect(row.remaining).toBe('0% (5h)');
    expect(row.note).toContain('额度用尽');
    // 订阅额度用尽会在重置时自愈，不能等同钱包欠费。
    expect(collectAlertSources([{ source: 'glm', strategy: 'zhipu', ok: null, exhausted: true }])).toEqual([]);
  });

  it('formats the reset countdown at the right granularity', () => {
    const now = new Date(2026, 9, 11, 17, 0, 0).getTime();
    const at = (secondsFromNow: number) => (now + secondsFromNow * 1000) / 1000;
    // 5h window: 小时+分钟足够
    expect(fmtResetCountdown(at(5 * 3600 + 20 * 60), now)).toBe('5h 20m');
    // 7d window: 只给小时会看不出是几天
    expect(fmtResetCountdown(at(3 * 86400 + 2 * 3600), now)).toBe('3d 2h');
    expect(fmtResetCountdown(at(45 * 60), now)).toBe('45m');
    // 已过期不该显示负数
    expect(fmtResetCountdown(at(-60), now)).toBe('');
    expect(fmtResetCountdown(null, now)).toBe('');
  });

  it('quotaUsageWindows filters by kind and ignores malformed rows', () => {
    const record: BalanceRecord = {
      source: 'glm',
      strategy: 'zhipu',
      windows: [
        { kind: 'tokens', label: '5h', used_percent: 1 },
        { kind: 'mcp', label: 'MCP', used: 1, limit: 2 },
        null as unknown as { kind: string },
      ],
    };
    expect(quotaUsageWindows(record, 'tokens')).toHaveLength(1);
    expect(quotaUsageWindows(record, 'mcp')).toHaveLength(1);
    expect(quotaUsageWindows({ source: 'x' }, 'tokens')).toEqual([]);
  });

  it('token/mcp 专用谓词各自剔除缺字段的窗口', () => {
    // 老快照可能带没有 used_percent 的 token 窗口、没有 limit 的 MCP 窗口。
    // 前者画成 0% 已用、后者写不出「剩多少/共多少」，所以都要提前剔除，
    // 而不是在渲染处用 ?? 0 兜底掩盖掉。
    const record: BalanceRecord = {
      source: 'glm',
      strategy: 'zhipu',
      windows: [
        { kind: 'tokens', label: '5h', used_percent: 23 },
        { kind: 'tokens', label: '7d' },
        { kind: 'mcp', label: 'MCP', used: 5, limit: 1000 },
        { kind: 'mcp', label: 'MCP-X', used: 5 },
      ],
    };
    expect(tokenQuotaWindows(record).map((w) => w.label)).toEqual(['5h']);
    expect(mcpQuotaWindows(record).map((w) => w.label)).toEqual(['MCP']);
  });

  it('hasQuotaDetails 同时认可平台额度与用量窗口', () => {
    expect(hasQuotaDetails({ source: 'x' })).toBe(false);
    expect(
      hasQuotaDetails({
        source: 'x',
        platform_quotas: [{ platform: 'p' }],
      })
    ).toBe(true);
    // 只有字段残缺的窗口不算「有详情」：展开了也没有东西可画。
    expect(
      hasQuotaDetails({
        source: 'x',
        windows: [{ kind: 'mcp', label: 'MCP' }],
      })
    ).toBe(false);
    expect(
      hasQuotaDetails({
        source: 'x',
        windows: [{ kind: 'tokens', label: '5h', used_percent: 1 }],
      })
    ).toBe(true);
  });

  it('renders sub2api rows: consumed total, requests, tokens and today notes', () => {
    const row = renderBalanceRow({
      source: 'sub',
      strategy: 'sub2api',
      ok: true,
      balance: 4.2,
      consumed_usd: 20.1,
      request_count: 10,
      token_count: 45678,
      today_usd: 0.5,
    });
    expect(row.remaining).toBe('$4.20');
    expect(row.used).toBe('$20.10 累计');
    expect(row.note).toBe('10 次请求 · 45,678 tokens · 今日 $0.50');

    const withoutUsage = renderBalanceRow({ source: 'sub', strategy: 'sub2api', ok: true, balance: 1 });
    expect(withoutUsage.used).toBe('-');
  });

  it('renders deepseek and stepfun rows in CNY', () => {
    const deepseek = renderBalanceRow({
      source: 'deepseek',
      strategy: 'deepseek',
      ok: true,
      currency: 'CNY',
      balance: 0.59,
    });
    expect(deepseek.remaining).toBe('¥0.59');
    expect(deepseek.used).toBe('-');
    expect(deepseek.note).toBe('');

    const overdue = renderBalanceRow({
      source: 'deepseek',
      strategy: 'deepseek',
      ok: false,
      currency: 'CNY',
      balance: 0,
    });
    expect(overdue.note).toBe('余额不足，请求会被拒');

    const stepfun = renderBalanceRow({
      source: 'stepfun',
      strategy: 'stepfun',
      ok: true,
      currency: 'CNY',
      balance: 5,
      account_type: '订阅包',
    });
    expect(stepfun.remaining).toBe('¥5.00');
    expect(stepfun.note).toBe('订阅包');
  });

  it('accepts localized strings while keeping the same composition', () => {
    const row = renderBalanceRow(
      {
        source: 'cctq',
        strategy: 'newapi_console',
        ok: true,
        balance: 1,
        used_window_usd: 2,
        request_count: 3,
      },
      {
        ...defaultBalanceStrings,
        statusOk: 'OK',
        statusOverdue: 'Overdue',
        statusUnknown: '—',
        empty: '-',
        unlimited: 'Unlimited',
        limitPair: (amount, limit) => `${amount} / ${limit}`,
        usedTotal: (amount) => `${amount} total`,
        usedLogTotal: (amount) => `${amount} log total`,
        requests: (count) => `${count} requests`,
        tokens: (count) => `${count} tokens`,
        today: (amount) => `Today ${amount}`,
        logTotal: (amount) => `Log total ${amount}`,
        overdraft: 'Overdraft',
        creditsRemaining: (count) => `${count} credits left`,
        expires: (date) => `Expires ${date}`,
        insufficient: 'Insufficient balance',
      }
    );
    expect(row.used).toBe('$2.00 total');
    expect(row.note).toBe('3 requests');
  });
});

describe('fmtQuotaWindow', () => {
  it('shows usage over limit in USD', () => {
    expect(fmtQuotaWindow({ usage_usd: 0.12, limit_usd: 5 })).toBe('$0.12 / $5.00');
  });

  it('falls back to "-" placeholders for missing parts', () => {
    expect(fmtQuotaWindow(null)).toBe('-');
    expect(fmtQuotaWindow({})).toBe('- / -');
  });
});
