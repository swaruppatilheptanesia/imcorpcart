import type { Product } from '../types';

/** 22 products (p1–p8 phones · a1–a8 accessories · b1–b6 bags) — from catalog(). */
const rawProducts: Omit<Product, 'dateAdded'>[] = [
  { id: 'p1', name: 'iPhone 15 Pro · 256GB', brand: 'Apple', vendor: 'imcorpcart', sku: 'IMC-AP-1509', group: 'phones', cat: 'flagship', price: 124900, stock: 48, status: 'active', g1: '#4a7fc0', g2: '#123a72' },
  { id: 'p2', name: 'Galaxy S24 Ultra · 512GB', brand: 'Samsung', vendor: 'TechnoReseller', sku: 'TR-SS-2401', group: 'phones', cat: 'flagship', price: 129999, stock: 32, status: 'active', g1: '#2b2f36', g2: '#0b0d10' },
  { id: 'p3', name: 'OnePlus 12 · 256GB', brand: 'OnePlus', vendor: 'imcorpcart', sku: 'IMC-OP-1200', group: 'phones', cat: 'flagship', price: 64999, stock: 60, status: 'active', g1: '#1f6f52', g2: '#0a2f22' },
  { id: 'p4', name: 'Pixel 8 Pro · 128GB', brand: 'Google', vendor: 'imcorpcart', sku: 'IMC-GP-0812', group: 'phones', cat: 'flagship', price: 84999, stock: 24, status: 'active', g1: '#7a8fae', g2: '#3a465c' },
  { id: 'p5', name: 'Galaxy A55 5G · 128GB', brand: 'Samsung', vendor: 'TechnoReseller', sku: 'TR-SS-5501', group: 'phones', cat: 'mid', price: 39999, stock: 90, status: 'active', g1: '#c8a24a', g2: '#7a5f1e' },
  { id: 'p6', name: 'Nothing Phone (2a)', brand: 'Nothing', vendor: 'MobileHub', sku: 'MH-NT-2A00', group: 'phones', cat: 'mid', price: 27999, stock: 75, status: 'active', g1: '#e6e8ec', g2: '#b6bcc6' },
  { id: 'p7', name: 'Vivo X100 Pro', brand: 'Vivo', vendor: 'TechnoReseller', sku: 'TR-VV-1000', group: 'phones', cat: 'flagship', price: 89999, stock: 0, status: 'inactive', g1: '#3a2f5a', g2: '#171029' },
  { id: 'p8', name: 'Redmi Note 13 Pro', brand: 'Xiaomi', vendor: 'MobileHub', sku: 'MH-XM-1300', group: 'phones', cat: 'budget', price: 24999, stock: 140, status: 'draft', g1: '#4a5670', g2: '#1e2536' },

  { id: 'a1', name: 'AirPods Pro (2nd gen)', brand: 'Apple', vendor: 'imcorpcart', sku: 'IMC-AP-2200', group: 'accessories', cat: 'audio', price: 24900, stock: 210, status: 'active', g1: '#f2f3f5', g2: '#c6cad2' },
  { id: 'a2', name: 'Galaxy Buds3 Pro', brand: 'Samsung', vendor: 'TechnoReseller', sku: 'TR-SS-BD03', group: 'accessories', cat: 'audio', price: 18999, stock: 130, status: 'active', g1: '#7d8794', g2: '#3d434c' },
  { id: 'a3', name: '65W GaN USB-C Charger', brand: 'Anker', vendor: 'GadgetPro', sku: 'GP-AN-0065', group: 'accessories', cat: 'power', price: 3499, stock: 120, status: 'active', g1: '#f2f3f5', g2: '#c6cad2' },
  { id: 'a4', name: '25W Super Fast Charger', brand: 'Samsung', vendor: 'TechnoReseller', sku: 'TR-SS-2500', group: 'accessories', cat: 'power', price: 1799, stock: 300, status: 'active', g1: '#e9eb0', g2: '#cfd3da' },
  { id: 'a5', name: '10000mAh Power Bank', brand: 'Anker', vendor: 'GadgetPro', sku: 'GP-AN-1000', group: 'accessories', cat: 'power', price: 2499, stock: 180, status: 'active', g1: '#2b2f36', g2: '#0b0d10' },
  { id: 'a6', name: 'Galaxy S24 Ultra Case', brand: 'Spigen', vendor: 'TechnoReseller', sku: 'TR-SP-2401', group: 'accessories', cat: 'cases', price: 1299, stock: 260, status: 'active', g1: '#3a3f47', g2: '#16191d' },
  { id: 'a7', name: 'Tempered Glass (2 pack)', brand: 'Nillkin', vendor: 'GadgetPro', sku: 'GP-NL-0002', group: 'accessories', cat: 'cases', price: 599, stock: 500, status: 'active', g1: '#dfe3ea', g2: '#b3b9c4' },
  { id: 'a8', name: 'USB-C to Lightning Cable', brand: 'Apple', vendor: 'imcorpcart', sku: 'IMC-AP-0100', group: 'accessories', cat: 'power', price: 1900, stock: 0, status: 'draft', g1: '#eceef1', g2: '#c9ced6' },

  { id: 'b1', name: 'Everyday Backpack 20L', brand: 'Peak Design', vendor: 'UrbanCarry', sku: 'UC-PD-0020', group: 'bags', cat: 'backpacks', price: 18999, stock: 64, status: 'active', g1: '#6a5240', g2: '#332417' },
  { id: 'b2', name: 'Slim Laptop Sleeve 14"', brand: 'tomtoc', vendor: 'UrbanCarry', sku: 'UC-TT-1400', group: 'bags', cat: 'sleeves', price: 2499, stock: 150, status: 'active', g1: '#3a3f47', g2: '#16191d' },
  { id: 'b3', name: 'Executive Briefcase', brand: 'Nappa Dori', vendor: 'UrbanCarry', sku: 'UC-ND-0001', group: 'bags', cat: 'briefcases', price: 12999, stock: 40, status: 'active', g1: '#5a3d2b', g2: '#2a1a10' },
  { id: 'b4', name: 'Commuter Backpack 25L', brand: 'Wildcraft', vendor: 'UrbanCarry', sku: 'UC-WC-0025', group: 'bags', cat: 'backpacks', price: 4999, stock: 110, status: 'active', g1: '#2f3a44', g2: '#121a22' },
  { id: 'b5', name: 'Leather Portfolio Case', brand: 'Nappa Dori', vendor: 'UrbanCarry', sku: 'UC-ND-0002', group: 'bags', cat: 'briefcases', price: 6999, stock: 55, status: 'draft', g1: '#7a5a3a', g2: '#3a2817' },
  { id: 'b6', name: 'Canvas Messenger Bag', brand: 'Baggit', vendor: 'UrbanCarry', sku: 'UC-BG-0003', group: 'bags', cat: 'briefcases', price: 3499, stock: 0, status: 'inactive', g1: '#4a4636', g2: '#22201a' },
];

/** Demo fixtures carry no real created-at date. */
export const products: Product[] = rawProducts.map((p) => ({ ...p, dateAdded: '—' }));

export const TOTAL_PRODUCTS = 34; // catalog reports "of 34" in the footer

export const catLabels: Record<string, string> = {
  flagship: 'Flagship phone',
  mid: 'Mid-range phone',
  budget: 'Budget phone',
  audio: 'Audio',
  power: 'Power & charging',
  cases: 'Cases & protection',
  backpacks: 'Backpack',
  briefcases: 'Briefcase',
  sleeves: 'Laptop sleeve',
};

export const groupLabels: Record<string, string> = {
  phones: 'Phones',
  accessories: 'Accessories',
  bags: 'Bags',
};

export const vendorColors: Record<string, string> = {
  imcorpcart: 'var(--v-imcorpcart)',
  TechnoReseller: 'var(--v-techno)',
  MobileHub: 'var(--v-mobilehub)',
  GadgetPro: 'var(--v-gadgetpro)',
  UrbanCarry: 'var(--v-urbancarry)',
};

/* Product-edit fixtures (default target p1). */
export const editShades = [
  { name: 'Natural Titanium', g1: '#c8c2b6', g2: '#8a8378', stock: 12 },
  { name: 'Blue Titanium', g1: '#4a7fc0', g2: '#123a72', stock: 20 },
  { name: 'White Titanium', g1: '#eef0f2', g2: '#c9ccd2', stock: 8 },
  { name: 'Black Titanium', g1: '#3a3f47', g2: '#111417', stock: 0 },
];

export const editVariants = [
  { cfg: '256GB', price: '124900', stock: '48' },
  { cfg: '512GB', price: '144900', stock: '22' },
];

export const editSpecs = [
  { k: 'Display', v: '6.1" Super Retina XDR' },
  { k: 'Chip', v: 'A17 Pro' },
  { k: 'Camera', v: '48MP main · 3× telephoto' },
  { k: 'Battery', v: 'Up to 23h video' },
];

export const visChips = ['Nexus Systems', 'Acme Corp', '+ 22 more'];

export const freebiePresets = [
  'Silicone case + tempered glass',
  '80W fast charger',
  'Wireless earbuds',
  'Screen guard (2 pack)',
  'Tech-organiser pouch',
];
