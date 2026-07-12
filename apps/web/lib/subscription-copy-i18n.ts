/**
 * subscription-copy-i18n.ts — display-layer 中文化 for /settings/subscription
 * feature copy.
 *
 * Source: reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md P2-7
 * ("訂閱頁 forward observation/SIM-only/caveat 英文術語"). The raw strings
 * live in packages/contracts/src/entitlements.ts (`subscriptionFeatures.
 * customerCopy`) — that package is outside this lane's edit scope (contracts
 * changes need a contracts-lane review), so this module follows the same
 * pattern as `ui-vocab.ts`: a small apps/web-only translation layer the
 * consuming page calls before rendering, leaving the contract's string
 * values untouched.
 *
 * Scope is deliberately narrow — only the specific English clauses actually
 * spotted mixed into otherwise-Chinese customerCopy sentences (verified by
 * grepping packages/contracts/src/entitlements.ts for every non-brand-name
 * English token). "KGI"/"SIM"/"Paper"/"Starter"/"Pro"/"Premium" are left
 * alone: they're established product/brand terms used consistently across
 * the whole subscription surface (tier level labels, feature ids, other
 * customerCopy sentences), not one-off engineering jargon leaking through.
 */
const SUBSCRIPTION_COPY_JARGON: Array<[RegExp, string]> = [
  [/forward observation/g, "前瞻觀察"],
  [/SIM-only\s*狀態/g, "僅限模擬狀態"],
  [/風險\s*caveat\s*/g, "風險注意事項"],
  [/最新\s*snapshot/g, "最新快照"],
  [/Daily smoke/g, "每日自動排查"],
];

/** Translates known raw English jargon clauses inside subscription feature
 * copy into Chinese. Safe to call on any string — text with no matching
 * clause passes through unchanged. */
export function translateSubscriptionCopy(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SUBSCRIPTION_COPY_JARGON) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
