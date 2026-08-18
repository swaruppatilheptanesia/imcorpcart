import { LayoutDashboard, Users, ShoppingBag, Building2, type LucideIcon } from 'lucide-react';

export interface NavDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const navDefs: NavDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'employees', label: 'Employees', icon: Users },
  { key: 'orders', label: 'Orders', icon: ShoppingBag },
  { key: 'profile', label: 'Company', icon: Building2 },
];

export function activeNav(route: string): string {
  return route;
}

export interface RouteMeta {
  title: string;
  sub: string;
}

export const titles: Record<string, RouteMeta> = {
  dashboard: { title: 'Dashboard', sub: 'Your company at a glance' },
  employees: { title: 'Employees', sub: 'Manage staff, credit limits, and access' },
  orders: { title: 'Orders', sub: 'EPP orders placed by your employees' },
  profile: { title: 'Company', sub: 'Organisation profile and program' },
};
