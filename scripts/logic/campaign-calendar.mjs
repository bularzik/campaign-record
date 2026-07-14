import { formatComponentsFallback } from "./campaign-date.mjs";

/** The active in-world calendar, or null on pre-v13 cores / when unavailable. */
function calendar() {
  const cal = game.time?.calendar;
  return cal && typeof cal.timeToComponents === "function" ? cal : null;
}

export function hasCalendar() {
  return calendar() != null;
}

/** Localized months with 0-based indices; [] when no calendar. */
export function getCalendarMonths() {
  const cal = calendar();
  if (!cal) return [];
  return cal.months.values.map((m, index) => ({
    index,
    name: game.i18n.localize(m.name),
    days: m.leapDays ?? m.days
  }));
}

/** Validation bounds for campaign-date entry; safe defaults when no calendar. */
export function calendarBounds() {
  const cal = calendar();
  const days = cal?.days ?? {};
  return {
    monthCount: cal ? cal.months.values.length : 12,
    monthDayCounts: cal ? cal.months.values.map((m) => m.leapDays ?? m.days) : [],
    hoursPerDay: days.hoursPerDay ?? 24,
    minutesPerHour: days.minutesPerHour ?? 60
  };
}

/** Localized in-world date label for stored components; "" when unset. */
export function formatCampaignDate(components) {
  if (!components) return "";
  const monthName = getCalendarMonths()[components.month]?.name ?? `Month ${components.month + 1}`;
  return formatComponentsFallback(components, monthName);
}
