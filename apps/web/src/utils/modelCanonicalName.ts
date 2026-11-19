/**
 * Reduce a runtime model id to the name used by the price table.
 *
 * A routing prefix selects a gateway or account pool, but never changes the
 * model being called. `cpa-` is different: it was a gateway-internal alias and
 * only survives in historical usage events, so it is stripped as a read-only
 * compatibility rule after the routing prefix has been removed.
 */
export const canonicalModelName = (model: string): string => {
  const trimmed = String(model ?? '').trim();
  const slash = trimmed.indexOf('/');
  const withoutRoute = slash < 0 || slash === trimmed.length - 1
    ? trimmed
    : trimmed.slice(slash + 1);
  return withoutRoute.startsWith('cpa-gpt-') ? withoutRoute.slice(4) : withoutRoute;
};
