/** Mobile app APNS category identifiers — must match iOS UNNotificationCategory registration. */
const ROUTE_TO_CATEGORY = Object.freeze({
  "/buy": "BUY_CATEGORY",
  "/sell": "SELL_CATEGORY",
  "/home": "OPEN_CATEGORY",
  "/mart": "SHOP_NOW_CATEGORY",
});

/** Default action button label per category (mobile may also read `action_button` from FCM data). */
const CATEGORY_BUTTON_LABEL = Object.freeze({
  BUY_CATEGORY: "Buy",
  SELL_CATEGORY: "Sell",
  OPEN_CATEGORY: "Open",
  SHOP_NOW_CATEGORY: "Shop Now",
});

const VALID_CATEGORIES = new Set(Object.values(ROUTE_TO_CATEGORY));

function normalizeRoute(route) {
  if (route === null || route === undefined) return "";
  const trimmed = String(route).trim();
  if (!trimmed) return "";
  const pathOnly = trimmed.split("?")[0].split("#")[0];
  if (!pathOnly) return "";
  return pathOnly.startsWith("/") ? pathOnly.replace(/\/+$/, "") || "/" : `/${pathOnly.replace(/\/+$/, "")}`;
}

function resolveCategoryFromRoute(route) {
  const normalized = normalizeRoute(route);
  if (!normalized) return null;
  return ROUTE_TO_CATEGORY[normalized] ?? null;
}

function isValidPushCategory(category) {
  return typeof category === "string" && VALID_CATEGORIES.has(category);
}

function resolveButtonLabelFromCategory(category) {
  if (!category) return null;
  return CATEGORY_BUTTON_LABEL[category] ?? null;
}

function resolvePushActionFromRoute(route, explicitCategory) {
  const normalizedRoute = normalizeRoute(route);
  const fromRoute = resolveCategoryFromRoute(normalizedRoute);
  const explicit = isValidPushCategory(explicitCategory) ? explicitCategory : null;
  const category = fromRoute || explicit || "OPEN_CATEGORY";

  return {
    actionRoute: normalizedRoute || null,
    actionType: category,
    actionButton: resolveButtonLabelFromCategory(category),
  };
}

module.exports = {
  ROUTE_TO_CATEGORY,
  CATEGORY_BUTTON_LABEL,
  VALID_CATEGORIES,
  normalizeRoute,
  resolveCategoryFromRoute,
  isValidPushCategory,
  resolveButtonLabelFromCategory,
  resolvePushActionFromRoute,
};
