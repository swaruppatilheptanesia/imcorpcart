import { useOutletContext } from 'react-router-dom';
import type { CompanyProfile, CompanyEmployee } from '@/data/company-api';

export interface CompanyContext {
  profile: CompanyProfile | null;
  openAddEmployee: () => void;
  openEditEmployee: (employee: CompanyEmployee) => void;
  employeesVersion: number;
}

export function useCompany() {
  return useOutletContext<CompanyContext>();
}
