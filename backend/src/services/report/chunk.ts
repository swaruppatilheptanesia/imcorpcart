import { REPORT } from '../../config/constants';

/**
 * Keyset pagination over a Prisma query.
 *
 * Not `skip`/`take`: at 40,000 rows deep an offset scan with these joins
 * degrades badly, while a cursor stays flat. The caller must order by a TOTAL
 * ordering ending in `id` — Prisma's cursor is only correct when no two rows
 * tie — e.g. `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`.
 */
export async function* pageAll<T extends { id: string }>(
  query: (cursor: string | null) => Promise<T[]>,
): AsyncGenerator<T[], void, void> {
  let cursor: string | null = null;
  for (;;) {
    const page = await query(cursor);
    if (page.length === 0) return;
    yield page;
    if (page.length < REPORT.pageSize) return;
    cursor = page[page.length - 1].id;
  }
}

/** The `take`/`cursor` half of a keyset query, so descriptors stay readable. */
export function keyset(cursor: string | null) {
  return {
    take: REPORT.pageSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}
