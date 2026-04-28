// Risk D mitigation — feature-flag gate for the order-ticket UI.
// Default-false: the gate stays locked unless an operator explicitly
// flips NEXT_PUBLIC_IUF_ORDER_UI_ENABLED to "true" at build time.
export const ORDER_UI_ENABLED =
  process.env.NEXT_PUBLIC_IUF_ORDER_UI_ENABLED === "true";
