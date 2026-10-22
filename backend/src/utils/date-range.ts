/**
 * Date windows for reports and dashboards, resolved in IST.
 *
 * The business runs in IST (UTC+5:30) but the server does not necessarily. A
 * naive `new Date('2026-10-22')` parses as UTC midnight, which is 05:30 IST —
 * so an admin asking for "today" silently loses the first 5.5 hours of orders
 * at one end and borrows them from the previous day at the other. Every
 * calendar boundary here is therefore computed against the IST wall clock and
 * returned as the corresponding UTC instant, which is what Prisma compares.
 *
 * Reports and the dashboard share this file deliberately: the first question
 * anyone asks of a new report is why its totals disagree with the dashboard.
 */

const IST_OFFSET_MIN = 330; // +05:30

const shift = (d: Date, mins: number): Date => new Date(d.getTime() + mins * 60_000);

/** The UTC instant at which the IST calendar day containing `d` begins. */
export function startOfDayIst(d: Date): Date {
  const ist = shift(d, IST_OFFSET_MIN); // IST wall clock, read through the UTC getters
  ist.setUTCHours(0, 0, 0, 0);
  return shift(ist, -IST_OFFSET_MIN);
}

/** The last representable instant of that same IST day. */
export function endOfDayIst(d: Date): Date {
  return new Date(startOfDayIst(d).getTime() + 86_400_000 - 1);
}

/** Report period vocabulary: the client's "Date wise, Week, Month, Quarter, Year". */
export const REPORT_PERIODS = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM', 'ALL'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface DateWindow {
  from: Date | null; // null = unbounded (ALL)
  to: Date | null;
}

/**
 * Resolve a period to a window.
 *
 * Every named period is to-date — WEEK means "this week so far", not "the last
 * seven days" — so the figures line up with how the business reads a calendar.
 * CUSTOM takes the caller's dates and widens them to whole IST days, so a
 * from/to of the same date yields that entire day rather than a zero-width
 * window.
 */
export function resolvePeriod(
  period: ReportPeriod,
  custom?: { from?: Date; to?: Date },
  now: Date = new Date(),
): DateWindow {
  if (period === 'ALL') return { from: null, to: null };

  if (period === 'CUSTOM') {
    return {
      from: custom?.from ? startOfDayIst(custom.from) : null,
      to: custom?.to ? endOfDayIst(custom.to) : null,
    };
  }

  const to = endOfDayIst(now);
  const ist = shift(now, IST_OFFSET_MIN); // read calendar fields in IST
  const anchor = new Date(ist);

  switch (period) {
    case 'DAY':
      return { from: startOfDayIst(now), to };
    case 'WEEK': {
      // Week starts Monday; getUTCDay() is 0=Sunday on the IST-shifted clock.
      const dow = (anchor.getUTCDay() + 6) % 7;
      anchor.setUTCDate(anchor.getUTCDate() - dow);
      break;
    }
    case 'MONTH':
      anchor.setUTCDate(1);
      break;
    case 'QUARTER':
      anchor.setUTCMonth(Math.floor(anchor.getUTCMonth() / 3) * 3, 1);
      break;
    case 'YEAR':
      anchor.setUTCMonth(0, 1);
      break;
  }

  return { from: startOfDayIst(shift(anchor, -IST_OFFSET_MIN)), to };
}

/** Prisma `where` fragment for a window; `{}` when unbounded. */
export function dateWhere(w: DateWindow): { gte?: Date; lte?: Date } | undefined {
  if (!w.from && !w.to) return undefined;
  return { ...(w.from ? { gte: w.from } : {}), ...(w.to ? { lte: w.to } : {}) };
}

// ── Legacy dashboard vocabulary ──────────────────────────────────────────────

export type DashboardRangeLabel = '7D' | '30D' | 'QTD' | 'YTD';

/**
 * The dashboard's rolling windows, now IST-aligned.
 *
 * 7D/30D stay rolling from this instant (they are "the last N days", not
 * calendar-aligned); QTD/YTD snap to the IST quarter/year start, which is the
 * part that was previously computed in whatever timezone the server happened
 * to run in.
 */
export function rangeWindow(range: DashboardRangeLabel): { from: Date; now: Date } {
  const now = new Date();
  if (range === '7D') return { from: new Date(now.getTime() - 7 * 86_400_000), now };
  if (range === '30D') return { from: new Date(now.getTime() - 30 * 86_400_000), now };
  const w = resolvePeriod(range === 'QTD' ? 'QUARTER' : 'YEAR', undefined, now);
  return { from: w.from ?? now, now };
}
