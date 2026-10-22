import { z } from 'zod';
import { REPORT_IDS } from '../services/report/registry';

/**
 * Only the report id and the output format are validated centrally — each
 * report owns its own filter schema, which the controller applies after
 * resolving the descriptor. That keeps a report's filters next to the query
 * that consumes them rather than in a shared file nobody can safely change.
 */
export const reportTypeParams = z.object({ type: z.enum(REPORT_IDS) });

export const reportDownloadQuery = z.object({ format: z.enum(['CSV', 'XLSX']).default('CSV') });

export const reportPreviewQuery = z.object({});
