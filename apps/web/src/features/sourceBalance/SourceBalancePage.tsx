import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { BalancePlatformQuota, BalanceRecord, BalanceSnapshot } from '@/types/balance';
import {
  collectAlertSources,
  fmtCount,
  fmtPercent,
  fmtQuotaWindow,
  fmtResetCountdown,
  fmtSnapshotTime,
  hasQuotaDetails,
  isSnapshotStale,
  mcpQuotaWindows,
  renderBalanceRow,
  tokenQuotaWindows,
} from '@/utils/balancePresentation';
import { BALANCE_SNAPSHOT_URL, fetchBalanceSnapshot } from './balanceSnapshotService';
import { buildBalanceStrings } from './balanceStrings';
import styles from './SourceBalancePage.module.scss';

const CLOCK_REFRESH_INTERVAL_MS = 60_000;

export function SourceBalancePage() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<BalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 记录「被手动收起」的来源：额度窗口是这一页的主要信息，默认就该展开，
  // 所以状态按相反的极值保存——空对象 = 全部展开。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetchBalanceSnapshot(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSnapshot(next);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [refreshSignal]);

  // 每分钟推进一次本地时钟，用于重算「已过期」状态
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), CLOCK_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => setRefreshSignal((value) => value + 1), []);

  const strings = useMemo(() => buildBalanceStrings(t), [t]);
  const records = useMemo(() => snapshot?.records ?? [], [snapshot]);
  const rows = useMemo(
    () => records.map((record) => renderBalanceRow(record, strings)),
    [records, strings]
  );
  const alertSources = useMemo(() => collectAlertSources(records), [records]);
  const stale = snapshot ? isSnapshotStale(snapshot.collected_at, nowMs) : false;

  const renderQuotaRows = (quotas: BalancePlatformQuota[]) =>
    quotas.map((quota) => (
      <tr key={quota.platform}>
        <td>{quota.platform}</td>
        <td>{fmtQuotaWindow(quota.daily)}</td>
        <td>{fmtQuotaWindow(quota.weekly)}</td>
        <td>{fmtQuotaWindow(quota.monthly)}</td>
      </tr>
    ));

  /**
   * 订阅制额度窗口：每行 = 窗口名 + 进度条 + 剩余% + 重置倒计时。
   *
   * 「已用」不在这里重复一遍：表格的「已用」列已经写了每个窗口的百分比，
   * 展开区再抄一次只是同一事实说两遍。这里改用倒计时回答另一个问题
   * ——「这个额度还能撑多久 / 什么时候回满」。
   */
  const renderQuotaUsageWindows = (record: BalanceRecord) => {
    // 两类窗口共用的重置说明：token 与 MCP 行都要它，写法也只该有一处。
    const resetMeta = (resetAt: number | null | undefined) => {
      const countdown = fmtResetCountdown(resetAt, nowMs);
      return (
        <span className={styles.quotaWindowMeta}>
          {countdown
            ? t('sourceBalance.window_reset_in', { time: countdown })
            : t('sourceBalance.window_reset_due')}
        </span>
      );
    };
    const tokenRows = tokenQuotaWindows(record).map((window, index) => {
      const used = window.used_percent ?? 0;
      const remaining = Math.max(0, Math.min(100, 100 - used));
      // 轨道填充的是「剩余」，与比例尺方向一致：条越短越危险
      const tone = remaining <= 0 ? 'Bad' : remaining < 20 ? 'Warn' : 'Good';
      return (
        <div className={styles.quotaWindowRow} key={`${window.label}-${index}`}>
          <span className={styles.quotaWindowLabel}>{window.label || '?'}</span>
          <span className={styles.quotaTrack} aria-hidden="true">
            <span
              className={`${styles.quotaBar} ${styles[`quotaBar${tone}`]}`}
              style={{ width: `${remaining}%` }}
            />
          </span>
          <span className={styles.quotaWindowValue}>
            {/* 窗口名就在左边，这里只给条形的精确读数，不再重复 "剩 77%（5h）" */}
            {t('sourceBalance.window_remaining_short', {
              percent: fmtPercent(remaining),
            })}
          </span>
          {resetMeta(window.reset_at)}
        </div>
      );
    });
    // MCP 是每月次数，量纲不同，所以不画条——只报数并给重置时间。
    const mcpRows = mcpQuotaWindows(record).map((window, index) => (
      <div className={styles.quotaWindowRow} key={`mcp-${index}`}>
        <span className={styles.quotaWindowLabel}>{window.label || 'MCP'}</span>
        {/* 备注列已经写了「MCP 已用/上限」，这里给剩余量，别同一句话说两遍 */}
        <span className={styles.quotaWindowCount}>
          {t('sourceBalance.mcp_remaining', {
            remaining: fmtCount(
              window.remaining ?? Math.max(0, (window.limit ?? 0) - (window.used ?? 0))
            ),
            limit: fmtCount(window.limit),
          })}
        </span>
        {resetMeta(window.reset_at)}
      </div>
    ));
    return [...tokenRows, ...mcpRows];
  };

  return (
    <div className={styles.page}>
      <div className={styles.infoBar}>
        <div className={styles.infoMain}>
          <h2 className={styles.title}>{t('sourceBalance.title')}</h2>
          {snapshot ? (
            <span className={styles.metaPill}>
              {t('sourceBalance.snapshot_header', { time: fmtSnapshotTime(snapshot.collected_at) })}
            </span>
          ) : null}
          {stale ? (
            <span className={styles.staleBadge} title={t('sourceBalance.stale_hint')}>
              {t('sourceBalance.stale_badge')}
            </span>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
          {t('sourceBalance.refresh')}
        </Button>
      </div>

      {stale ? <div className={styles.staleHint}>{t('sourceBalance.stale_hint')}</div> : null}

      {alertSources.length > 0 ? (
        <div className={styles.alertBanner}>
          {t('sourceBalance.alert_banner', { sources: alertSources.join(', ') })}
        </div>
      ) : null}

      {failed ? (
        <div className={styles.statePanel}>
          <div className={styles.stateTitle}>{t('sourceBalance.error_title')}</div>
          <p className={styles.stateText}>
            {t('sourceBalance.error_hint', { url: BALANCE_SNAPSHOT_URL })}
          </p>
          <p className={styles.stateText}>
            {t('sourceBalance.start_command_label')}：
            <code className={styles.command}>{t('sourceBalance.start_command')}</code>
          </p>
          <Button variant="secondary" size="sm" onClick={refresh}>
            {t('sourceBalance.retry')}
          </Button>
        </div>
      ) : loading && !snapshot ? (
        <div className={styles.statePanel}>
          <LoadingSpinner />
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.statePanel}>
          <div className={styles.stateText}>{t('sourceBalance.empty_records')}</div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.balanceTable}>
            <thead>
              <tr>
                <th>{t('sourceBalance.column_source')}</th>
                <th>{t('sourceBalance.column_status')}</th>
                <th>{t('sourceBalance.column_remaining')}</th>
                <th>{t('sourceBalance.column_used')}</th>
                <th>{t('sourceBalance.column_note')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const record = records[index];
                const quotas = record.platform_quotas ?? [];
                const hasQuotas = quotas.length > 0;
                // 先问长度、再决定要不要渲染：为判断「有没有」而构造一遍 JSX
                // 是白做的，所以 usageBars 只在展开时才算。
                const hasUsageWindows =
                  tokenQuotaWindows(record).length > 0 || mcpQuotaWindows(record).length > 0;
                const hasDetails = hasQuotaDetails(record);
                const isExpanded = hasDetails && !collapsed[record.source];
                const statusClass =
                  row.ok === true
                    ? styles.statusOk
                    : row.ok === false
                      ? styles.statusBad
                      : styles.statusMuted;
                return (
                  <GroupedRow
                    key={record.source}
                    row={row}
                    statusClass={statusClass}
                    noteExtra={
                      hasDetails ? (
                        <button
                          type="button"
                          className={styles.expandButton}
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setCollapsed((prev) => ({ ...prev, [record.source]: !prev[record.source] }))
                          }
                        >
                          <span className={isExpanded ? styles.chevronOpen : styles.chevron}>
                            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                              <path
                                d="M4 2.5 8 6l-4 3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          {hasUsageWindows
                            ? t('sourceBalance.expand_quota_windows')
                            : t('sourceBalance.expand_quotas')}
                        </button>
                      ) : null
                    }
                    quotaRow={
                      isExpanded ? (
                        <tr key={`${record.source}-quotas`} className={styles.quotaRow}>
                          <td colSpan={5}>
                            {hasUsageWindows ? (
                              <div className={styles.quotaWindows}>
                                {renderQuotaUsageWindows(record)}
                              </div>
                            ) : null}
                            {hasQuotas ? (
                              <table className={styles.quotaTable}>
                                <thead>
                                  <tr>
                                    <th>{t('sourceBalance.quota_platform')}</th>
                                    <th>{t('sourceBalance.quota_daily')}</th>
                                    <th>{t('sourceBalance.quota_weekly')}</th>
                                    <th>{t('sourceBalance.quota_monthly')}</th>
                                  </tr>
                                </thead>
                                <tbody>{renderQuotaRows(quotas)}</tbody>
                              </table>
                            ) : null}
                          </td>
                        </tr>
                      ) : null
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupedRow({
  row,
  statusClass,
  noteExtra,
  quotaRow,
}: {
  row: ReturnType<typeof renderBalanceRow>;
  statusClass: string;
  noteExtra: ReactNode;
  quotaRow: ReactNode;
}) {
  return (
    <>
      <tr>
        <td>{row.source}</td>
        <td className={statusClass}>{row.status}</td>
        <td className={styles.remainingCell}>{row.remaining}</td>
        <td>{row.used}</td>
        <td className={styles.noteCell}>
          {row.note}
          {row.note && noteExtra ? ' ' : ''}
          {noteExtra}
        </td>
      </tr>
      {quotaRow}
    </>
  );
}
