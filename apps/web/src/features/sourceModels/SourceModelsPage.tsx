import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { fmtSnapshotTime } from '@/utils/balancePresentation';
import { MODEL_SNAPSHOT_URL, fetchModelSnapshot, refreshModelSnapshot } from './modelSnapshotService';
import type { ModelSnapshot } from '@/types/models';
import styles from './SourceModelsPage.module.scss';

function formatTokens(value?: number | null): string {
  if (!value) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function SourceModelsPage() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const refresh = useCallback(() => setRefreshSignal((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const load = refreshSignal === 0 ? fetchModelSnapshot : refreshModelSnapshot;
    load(controller.signal)
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

  const models = useMemo(() => snapshot?.models ?? [], [snapshot]);
  const gaps = models.filter((model) => model.issues.length > 0).length;

  return (
    <div className={styles.page}>
      <div className={styles.infoBar}>
        <div className={styles.infoMain}>
          <h2 className={styles.title}>{t('sourceModels.title')}</h2>
          {snapshot ? (
            <span className={styles.metaPill}>
              {t('sourceModels.snapshot_header', {
                time: snapshot.collected_at ? fmtSnapshotTime(snapshot.collected_at) : '—',
                origin: snapshot.origin,
              })}
            </span>
          ) : null}
          {gaps ? <span className={styles.gapPill}>{t('sourceModels.gaps', { count: gaps })}</span> : null}
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
          {t('sourceModels.refresh')}
        </Button>
      </div>

      {failed ? (
        <div className={styles.statePanel}>
          <div className={styles.stateTitle}>{t('sourceModels.error_title')}</div>
          <p className={styles.stateText}>{t('sourceModels.error_hint', { url: MODEL_SNAPSHOT_URL })}</p>
          <Button variant="secondary" size="sm" onClick={refresh}>
            {t('sourceModels.retry')}
          </Button>
        </div>
      ) : loading && !snapshot ? (
        <div className={styles.statePanel}>
          <LoadingSpinner />
        </div>
      ) : models.length === 0 ? (
        <div className={styles.statePanel}>
          <div className={styles.stateText}>{t('sourceModels.empty')}</div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('sourceModels.column_model')}</th>
                <th>{t('sourceModels.column_source')}</th>
                <th>{t('sourceModels.column_status')}</th>
                <th>{t('sourceModels.column_effort')}</th>
                <th>{t('sourceModels.column_context')}</th>
                <th>{t('sourceModels.column_output')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className={model.issues.length ? styles.gapRow : undefined}>
                  <td>{model.id}</td>
                  <td>{model.source}</td>
                  <td>
                    {model.available === false
                      ? t('sourceModels.status_down')
                      : model.available
                        ? t('sourceModels.status_up')
                        : '—'}
                  </td>
                  <td>
                    {model.effort || '—'}
                    {model.levels.length ? ` · ${model.levels.join('/')}` : ''}
                  </td>
                  <td>
                    {formatTokens(model.context_window)}
                    {model.max_context_window && model.max_context_window !== model.context_window
                      ? ` / ${formatTokens(model.max_context_window)}`
                      : ''}
                    {model.issues.includes('missing_context') ? ` · ${t('sourceModels.missing_context')}` : ''}
                  </td>
                  <td>{formatTokens(model.max_output_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
