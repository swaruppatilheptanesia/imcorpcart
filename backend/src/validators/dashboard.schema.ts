import { z } from 'zod';

export const dashboardQuery = z.object({
  range: z.enum(['7D', '30D', 'QTD', 'YTD']).default('30D'),
});

export type DashboardRange = z.infer<typeof dashboardQuery>['range'];
