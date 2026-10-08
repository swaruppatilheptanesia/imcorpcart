/** Storefront product search: matching + relevance scoring.
 *
 *  This replaces a single `"${name} ${brand}".includes(query)`, which required
 *  the shopper to type a verbatim substring of the title. That failed four ways:
 *  spacing had to match exactly ("Fold8" missed "Samsung Galaxy Z Fold 8"), word
 *  order mattered and crossed the name/brand join ("apple iphone" could never
 *  match name "iPhone 15" + brand "Apple"), a compound had to be written closed
 *  up ("air pods" missed "AirPods"), and the query was never trimmed.
 *
 *  The fix is to tokenise BOTH sides the same way and require every query token
 *  to appear somewhere, in any order.
 */

import type { StoreProduct } from '@/data/store-types';

// Split on letter↔digit boundaries so "Fold8" and "Fold 8" yield the same
// tokens. Product names mix both conventions — Samsung writes "S26" attached
// but "Fold 8" separated, and one iCare name contains "17T / 17T Pro … 17TPro".
const ALNUM_BOUNDARY = /(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/;

// Everything that is not a letter or digit separates words. That covers the
// separators these names actually use: | · – — / & + - " ° ( ) , and decimals.
const NON_ALNUM = /[^a-z0-9]+/;

/** Lowercase a string and split it into comparable tokens. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const word of s.toLowerCase().split(NON_ALNUM)) {
    if (!word) continue;
    for (const part of word.split(ALNUM_BOUNDARY)) if (part) out.push(part);
  }
  return out;
}

// A query token shorter than this only matches at the START of a word. Without
// the floor, "n" matches a letter buried in almost every product (345 of 618
// today) and "se" matches "ca-se"/"slee-ve" — the old `includes()` behaviour.
const MIN_INFIX = 3;

interface ProductIndex {
  name: string[];
  /** Adjacent name tokens concatenated, for title-only scoring. */
  nameJoined: Set<string>;
  /** name + brand + category labels — the full haystack. */
  all: string[];
  /** Concatenations of adjacent tokens, so "fold"+"8" is also findable as "fold8". */
  joined: Set<string>;
  /** The name's tokens joined by spaces, for contiguous-phrase scoring. */
  namePhrase: string;
}

function adjacentJoins(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) out.add(tokens[i] + tokens[i + 1]);
  return out;
}

function buildIndex(p: StoreProduct, categoryText: string): ProductIndex {
  const name = tokenize(p.name ?? '');
  // ~470 catalog rows are gift cards whose brand IS the name ("Croma"/"Croma").
  // Indexing both would score them twice and float them above real products.
  const sameBrand = (p.brand ?? '').trim().toLowerCase() === (p.name ?? '').trim().toLowerCase();
  const brand = sameBrand ? [] : tokenize(p.brand ?? '');
  const all = [...name, ...brand, ...tokenize(categoryText)];
  return {
    name,
    nameJoined: adjacentJoins(name),
    all,
    joined: adjacentJoins(all),
    namePhrase: name.join(' '),
  };
}

// ─── Index cache ─────────────────────────────────────────────────────────────
// Search re-runs on every keystroke with no debounce, so tokenising a product
// must never happen inside the keystroke path. Keyed by the product object: the
// catalog array is replaced wholesale when the auth mode flips, and a WeakMap
// lets the stale entries go with it.

let INDEX = new WeakMap<StoreProduct, ProductIndex>();

/** Drop the cache. Called when the catalog is replaced. */
export function resetSearchIndex(): void {
  INDEX = new WeakMap<StoreProduct, ProductIndex>();
}

// `categoryText` is a thunk so the caller's label lookup only runs on a cache
// miss, not for all ~618 products on every keystroke.
function indexFor(p: StoreProduct, categoryText: () => string): ProductIndex {
  let hit = INDEX.get(p);
  if (!hit) {
    hit = buildIndex(p, categoryText());
    INDEX.set(p, hit);
  }
  return hit;
}

// ─── Matching ────────────────────────────────────────────────────────────────

function tokenHit(needle: string, tokens: string[], joined: Set<string>): boolean {
  for (const t of tokens) if (t.startsWith(needle)) return true;
  for (const j of joined) if (j.startsWith(needle)) return true;
  if (needle.length < MIN_INFIX) return false;
  for (const t of tokens) if (t.includes(needle)) return true;
  for (const j of joined) if (j.includes(needle)) return true;
  return false;
}

function hits(ix: ProductIndex, q: string[]): boolean {
  if (q.every((t) => tokenHit(t, ix.all, ix.joined))) return true;
  // The mirror of the adjacent-join rule: the shopper split a word the catalog
  // writes closed up ("air pods" → "airpods").
  const glued = q.join('');
  return ix.all.some((t) => t.startsWith(glued));
}

/** Does this product match the query? Order-independent; every token must hit. */
export function matchesSearch(p: StoreProduct, query: string, categoryText: () => string): boolean {
  const q = tokenize(query);
  if (!q.length) return true;
  return hits(indexFor(p, categoryText), q);
}

// ─── Relevance ───────────────────────────────────────────────────────────────

/** Higher is a better match; 0 means no match. `q` is pre-tokenised by the
 *  caller so sorting a result set doesn't re-tokenise the query per comparison. */
export function scoreFor(p: StoreProduct, q: string[], categoryText: () => string): number {
  if (!q.length) return 0;
  const ix = indexFor(p, categoryText);
  if (!hits(ix, q)) return 0;

  let score = 1;
  // Everything the shopper typed is in the title, not merely in the brand or
  // the category shelf.
  if (q.every((t) => tokenHit(t, ix.name, ix.nameJoined))) score += 100;
  // …and in the order they typed it.
  if (ix.namePhrase.includes(q.join(' '))) score += 50;
  // …at the front of the title, where the product's identity lives.
  if (ix.name.slice(0, 3).includes(q[0])) score += 20;
  // Whole-word hits beat prefix hits.
  for (const t of q) if (ix.name.includes(t)) score += 10;
  return score;
}
