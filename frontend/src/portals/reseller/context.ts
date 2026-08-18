import { useOutletContext } from 'react-router-dom';
import type { DateRange } from '@/data/types';

export interface RSContext {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  openCoupon: () => void;
}

export function useRS() {
  return useOutletContext<RSContext>();
}
