import type { TFunction } from 'i18next';
import { defaultBalanceStrings, type BalanceStrings } from '@/utils/balancePresentation';

/**
 * 把 i18n 文案接进余额行渲染：语义与 CLI render_row 保持一致，
 * 不随语言变化的符号（"—"、"-"、"$x / $y" 组合）直接复用 CLI 默认值。
 */
export function buildBalanceStrings(t: TFunction): BalanceStrings {
  return {
    statusOk: t('sourceBalance.status_ok'),
    statusOverdue: t('sourceBalance.status_overdue'),
    statusUnknown: defaultBalanceStrings.statusUnknown,
    empty: defaultBalanceStrings.empty,
    unlimited: t('sourceBalance.unlimited'),
    limitPair: defaultBalanceStrings.limitPair,
    usedTotal: (amount) => t('sourceBalance.used_total', { amount }),
    usedLogTotal: (amount) => t('sourceBalance.used_log_total', { amount }),
    requests: (count) => t('sourceBalance.requests', { n: count }),
    tokens: (count) => t('sourceBalance.tokens', { n: count }),
    today: (amount) => t('sourceBalance.today', { amount }),
    logTotal: (amount) => t('sourceBalance.log_total', { amount }),
    overdraft: t('sourceBalance.overdraft'),
    creditsRemaining: (count) => t('sourceBalance.credits_remaining', { n: count }),
    expires: (date) => t('sourceBalance.expires', { date }),
    insufficient: t('sourceBalance.insufficient'),
    windowRemaining: (percent, label) =>
      t('sourceBalance.window_remaining', { percent, label }),
    windowUsage: (label, percent) => t('sourceBalance.window_usage', { label, percent }),
    plan: (name) => t('sourceBalance.plan', { name }),
    quotaExhausted: t('sourceBalance.quota_exhausted'),
    mcpUsage: (used, limit) => t('sourceBalance.mcp_usage', { used, limit }),
  };
}
