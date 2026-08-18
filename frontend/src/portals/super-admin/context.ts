import { useOutletContext } from 'react-router-dom';
import type { DateRange } from '@/data/types';

export interface SAContext {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
}

export function useSA() {
  return useOutletContext<SAContext>();
}
