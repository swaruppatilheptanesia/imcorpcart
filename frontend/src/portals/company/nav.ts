import { LayoutDashboard, Users, ShoppingBag, Building2, Landmark, MapPin, type LucideIcon } from 'lucide-react';

export interface NavDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const navDefs: NavDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'employees', label: 'Employees', icon: Users },
  { key: 'sepp', label: 'Smart EPP', icon: Landmark },
  { key: 'orders', label: 'Orders', icon: ShoppingBag },
  { key: 'addresses', label: 'Office addresses', icon: MapPin },
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
  employees: { title: 'Employees', sub: 'Manage staff, Smart EPP purchase limits, and access' },
  sepp: { title: 'Smart EPP requests', sub: 'Approve lease requests before they go to the leasing company' },
  orders: { title: 'Orders', sub: 'EPP orders placed by your employees' },
  addresses: { title: 'Office addresses', sub: 'Branches Smart EPP devices are delivered to' },
  profile: { title: 'Company', sub: 'Organisation profile and program' },
};
