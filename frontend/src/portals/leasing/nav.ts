import { LayoutDashboard, Landmark, Building2, SlidersHorizontal, type LucideIcon } from 'lucide-react';

export interface NavDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const navDefs: NavDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'requests', label: 'Lease requests', icon: Landmark },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'settings', label: 'Lease parameters', icon: SlidersHorizontal },
];

export function activeNav(route: string): string {
  return route;
}

export interface RouteMeta {
  title: string;
  sub: string;
}

export const titles: Record<string, RouteMeta> = {
  dashboard: { title: 'Dashboard', sub: 'Your Smart EPP lease book at a glance' },
  requests: { title: 'Lease requests', sub: 'HR-approved Smart EPP requests awaiting your financing decision' },
  companies: { title: 'Companies', sub: 'Corporates whose employees lease through you' },
  settings: { title: 'Lease parameters', sub: 'PTPM, tenure, buy-back, PV discounts and the advance every quote is built from' },
};
