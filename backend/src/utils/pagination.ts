import { PAGINATION } from '../config/constants';

export interface PageParams {
  page?: number | string;
  pageSize?: number | string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// Normalise raw query params into safe skip/take values.
export function parsePagination(params: PageParams): Pagination {
  const page = Math.max(1, Number(params.page) || PAGINATION.defaultPage);
  const rawSize = Number(params.pageSize) || PAGINATION.defaultPageSize;
  const pageSize = Math.min(PAGINATION.maxPageSize, Math.max(1, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(total: number, p: Pagination): PageMeta {
  return {
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}
