import { AppError } from '../../utils/AppError';
import type { ReportDescriptor, ReportId, FilterFieldDef } from './types';
import { productsReport } from './reports/products';
import { resellersReport } from './reports/resellers';
import { ordersAdminReport } from './reports/orders-admin';
import { ordersResellerReport } from './reports/orders-reseller';
import { usersReport } from './reports/users';

/**
 * The one place `any` is used in this feature.
 *
 * Each descriptor is strongly typed at its definition site via `defineReport`;
 * the registry has to erase those type parameters to hold five differently
 * shaped reports in one map. The runner only ever calls `count`/`fetch` with
 * the filters that descriptor's own schema parsed, so the erasure is contained.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReport = ReportDescriptor<any, any>;

export const REPORTS: Record<ReportId, AnyReport> = {
  ORDERS_ADMIN: ordersAdminReport,
  ORDERS_RESELLER: ordersResellerReport,
  PRODUCTS: productsReport,
  USERS: usersReport,
  RESELLERS: resellersReport,
};

export const REPORT_IDS = Object.keys(REPORTS) as [ReportId, ...ReportId[]];

export function getReport(id: string): AnyReport {
  const r = REPORTS[id as ReportId];
  if (!r) throw AppError.notFound(`Unknown report "${id}"`);
  return r;
}

const fields = (r: AnyReport): Promise<FilterFieldDef[]> =>
  typeof r.filterFields === 'function' ? r.filterFields() : Promise.resolve(r.filterFields);

/**
 * What the admin screen renders from. Columns and filter controls are both
 * declared here, so the screen needs no per-report knowledge at all.
 */
export async function catalogue() {
  return Promise.all(
    REPORT_IDS.map(async (id) => {
      const r = REPORTS[id];
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        fileStem: r.fileStem,
        columns: r.columns.map((c) => ({ key: c.key, header: c.header, width: c.width ?? null })),
        filterFields: await fields(r),
      };
    }),
  );
}
