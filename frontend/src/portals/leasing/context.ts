import { useOutletContext } from 'react-router-dom';
import type { LeasingProfile } from '@/data/leasing-api';

export interface LeasingContext {
  profile: LeasingProfile | null;
  refreshProfile: () => void;
}

export function useLeasing() {
  return useOutletContext<LeasingContext>();
}
