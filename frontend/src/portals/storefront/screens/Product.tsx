import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Gift, Heart, ShoppingCart, AlertTriangle, Check, Truck, Trash2, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { Button, Skeleton, EmptyState, useToast } from '@/components';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import type { StoreProduct } from '@/data/store-types';
import { useStore } from '../store-context';
import { getProductById, getRelated, deliveryEstimate } from '../data';
import { QtyStepper } from '../components/QtyStepper';
import { ProductGrid } from '../components/ProductGrid';
import s from './store-screen.module.css';
import styles from './Product.module.css';

const PINCODE_KEY = 'imc_pincode';

export function Product() {
  const { id } = useParams();
  const { data, state, error, reload } = useAsync<StoreProduct | undefined>(
    () => getProductById(id ?? ''),
    [id],
  );

  if (state === 'loading') {
    return (
      <div className={styles.grid}>
        <Skeleton h={420} radius={16} />
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton h={30} w="70%" />
          <Skeleton h={44} w="50%" />
          <Skeleton h={120} />
        </div>
        <Skeleton h={320} radius={16} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Product not found"
        body={error ?? 'This product may no longer be available.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  }
  return <Detail p={data} />;
}

function Detail({ p }: { p: StoreProduct }) {
  const navigate = useNavigate();
  const { flash } = useToast();
  const { addToCart, cart, setLineQty, removeLine, toggleWishlist, isWished, authed, checkoutEnabled } = useStore();

  const hasShades = p.shades.length > 0;
  const [shadeIdx, setShadeIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const [pincode, setPincode] = useState(() => localStorage.getItem(PINCODE_KEY) ?? '');

  // Switching colour/variant navigates to a sibling SKU; reset the gallery to
  // that product's first image so it opens on the selected colour's photo.
  useEffect(() => {
    setActiveImg(0);
    setShadeIdx(0);
  }, [p.id]);

  const shade = hasShades ? p.shades[shadeIdx] : null;
  const shadeStock = shade ? shade.stock : p.stock;
  const inStock = shadeStock > 0;
  const savings = p.mrp - p.price;
  const related = getRelated(p);
  const wished = isWished(p.id);

  const g1 = shade?.g1 ?? p.g1;
  const g2 = shade?.g2 ?? p.g2;
  const gradient = `linear-gradient(155deg, ${g1}, ${g2})`;
  const hasImages = p.images.length > 0;

  // ── Amazon-style variant family: colour + storage selectors across sibling
  //    SKUs. Selecting one navigates to that SKU (its own price/images/stock).
  const family = p.family ?? [];
  const familyColors = [...new Set(family.map((m) => m.optionColor).filter(Boolean))] as string[];
  const familyVariants = [...new Set(family.map((m) => m.optionVariant).filter(Boolean))] as string[];
  const hasFamilyColors = familyColors.length > 1;
  const hasFamilyVariants = familyVariants.length > 1;
  const colorMember = (c: string) => family.find((m) => m.optionColor === c);
  const pickSibling = (color: string | null, variant: string | null) =>
    family.find((m) => m.optionColor === color && m.optionVariant === variant) ??
    family.find((m) => m.optionColor === color) ??
    family.find((m) => m.optionVariant === variant);
  const goToSibling = (color: string | null, variant: string | null) => {
    const m = pickSibling(color, variant);
    if (m && m.id !== p.id) navigate(`/shop/product/${m.id}`);
  };

  // Share this product — native share sheet, else copy the deep-link.
  const share = async () => {
    const url = `${window.location.origin}/shop/product/${p.id}`;
    try {
      if (navigator.share) await navigator.share({ title: p.name, url });
      else {
        await navigator.clipboard.writeText(url);
        flash('Link copied');
      }
    } catch {
      /* user dismissed the share sheet — no-op */
    }
  };

  // Image carousel — step with wrap-around; touch swipe on mobile.
  const stepImg = (n: number) => {
    const len = p.images.length;
    if (len > 1) setActiveImg((i) => (i + n + len) % len);
  };
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) stepImg(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  // Cart line for this exact product + selected shade (feature 4).
  const line = useMemo(
    () => cart.find((l) => l.productId === p.id && (l.shade || '') === (shade?.name || '')),
    [cart, p.id, shade],
  );

  // Delivery estimate (feature 5) — client-side heuristic.
  const eta = /^\d{6}$/.test(pincode) ? deliveryEstimate(pincode) : null;
  useEffect(() => {
    if (/^\d{6}$/.test(pincode)) localStorage.setItem(PINCODE_KEY, pincode);
  }, [pincode]);

  const add = (buyNow = false) => {
    if (!inStock) return;
    void addToCart(p.id, shade?.name ?? '', qty);
    if (buyNow) navigate('/shop/cart');
    else flash('Added to cart');
  };

  const about = [
    p.freebie.enabled ? `Free gift included — ${p.freebie.description}` : null,
    p.variants.length ? `Available in ${p.variants.join(', ')}` : null,
    hasShades ? `${p.shades.length} colour option${p.shades.length > 1 ? 's' : ''}` : null,
    'Fulfilled & shipped by imcorpcart',
    inStock ? 'In stock — ready to ship' : 'Currently out of stock',
  ].filter(Boolean) as string[];

  return (
    <div>
      <div className={styles.grid}>
        {/* ── Gallery (Amazon-style: vertical thumb rail + large image) ── */}
        <div className={styles.galleryCol}>
          <div className={styles.galleryRow}>
            {hasImages && p.images.length > 1 && (
              <div className={styles.thumbs}>
                {p.images.map((src, i) => (
                  <button
                    key={src + i}
                    className={cn(styles.thumb, i === activeImg && styles.thumbOn)}
                    onMouseEnter={() => setActiveImg(i)}
                    onClick={() => setActiveImg(i)}
                    aria-label={`Image ${i + 1}`}
                  >
                    <img className={styles.thumbImg} src={src} alt="" />
                  </button>
                ))}
              </div>
            )}
            <div className={styles.gallery} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {hasImages ? (
                <img className={styles.mainImg} src={p.images[activeImg] ?? p.images[0]} alt={p.name} />
              ) : (
                <span className={styles.device} style={{ background: gradient }} />
              )}
              {hasImages && p.images.length > 1 && (
                <>
                  <button
                    className={cn(styles.navArrow, styles.navPrev)}
                    onClick={() => stepImg(-1)}
                    aria-label="Previous image"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className={cn(styles.navArrow, styles.navNext)}
                    onClick={() => stepImg(1)}
                    aria-label="Next image"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Center: details ── */}
        <div className={styles.center}>
          <div className={styles.brandRow}>
            <span className={styles.brand}>{p.brand}</span>
            <button className={styles.shareBtn} onClick={share} aria-label="Share product">
              <Share2 size={15} /> Share
            </button>
          </div>
          <h1 className={styles.title}>{p.name}</h1>
          <div className={styles.metaRow}>
            <span className={cn(styles.stockPill, inStock ? styles.inStock : styles.outStock)}>
              {inStock ? 'In stock' : 'Out of stock'}
            </span>
          </div>

          {p.desc && <p className={styles.desc}>{p.desc}</p>}

          {/* Variant family — colour + storage selectors switch between sibling SKUs. */}
          {hasFamilyColors && (
            <div className={styles.variantBlock}>
              <div className={styles.blockLabel}>
                Colour: <strong>{p.optionColor}</strong>
              </div>
              <div className={styles.familySwatches}>
                {familyColors.map((c) => {
                  const m = colorMember(c);
                  return (
                    <button
                      key={c}
                      className={cn(styles.familySwatch, c === p.optionColor && styles.familySwatchOn)}
                      onClick={() => goToSibling(c, p.optionVariant ?? null)}
                      aria-label={c}
                      title={c}
                    >
                      {m?.image ? (
                        <img src={m.image} alt={c} />
                      ) : (
                        <span style={{ background: `linear-gradient(155deg, ${m?.g1 ?? p.g1}, ${m?.g2 ?? p.g2})` }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {hasFamilyVariants && (
            <div className={styles.variantBlock}>
              <div className={styles.blockLabel}>Variant</div>
              <div className={styles.varChips}>
                {familyVariants.map((v) => (
                  <button
                    key={v}
                    className={cn(styles.varChip, v === p.optionVariant && styles.varChipOn)}
                    onClick={() => goToSibling(p.optionColor ?? null, v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Standalone products (no family) keep the display-only variant chips. */}
          {!hasFamilyVariants && p.variants.length > 0 && (
            <div className={styles.variantBlock}>
              <div className={styles.blockLabel}>Variant</div>
              <div className={styles.varChips}>
                {p.variants.map((v) => (
                  <span key={v} className={styles.varChip}>{v}</span>
                ))}
              </div>
            </div>
          )}

          {p.specs.length > 0 && (
            <div className={styles.specs}>
              <div className={styles.blockTitle}>Specifications</div>
              {p.specs.map((sp) => (
                <div key={sp.k} className={styles.specRow}>
                  <span className={styles.specK}>{sp.k}</span>
                  <span className={styles.specV}>{sp.v}</span>
                </div>
              ))}
            </div>
          )}

          {about.length > 0 && (
            <div className={styles.about}>
              <div className={styles.blockTitle}>About this item</div>
              <ul className={styles.bullets}>
                {about.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Buy box ── */}
        <aside className={styles.buyBox}>
          <div className={styles.priceBlock}>
            <span className={styles.price}>{inr(p.price)}</span>
            {p.mrp > p.price && <span className={styles.mrp}>{inr(p.mrp)}</span>}
            <span className={styles.priceKind}>{authed ? 'EPP price' : 'MOP'}</span>
          </div>
          {authed && savings > 0 && <div className={styles.savings}>{inr(savings)} EPP savings</div>}
          <div className={styles.priceCaption}>
            {authed ? 'Inclusive of taxes · corporate rate' : 'Market operating price · inclusive of taxes'}
          </div>

          {!authed && (
            <button className={styles.eppCta} onClick={() => navigate('/')}>
              Sign in to see your EPP price →
            </button>
          )}

          {/* Delivery estimate */}
          <div className={styles.deliveryBox}>
            <div className={styles.deliveryHead}>
              <Truck size={15} /> Delivery
            </div>
            <div className={styles.pincodeRow}>
              <input
                className={styles.pincodeInput}
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter pincode"
                inputMode="numeric"
                maxLength={6}
              />
            </div>
            {eta ? (
              <div className={styles.etaText}>
                Delivery by <strong>{eta.label}</strong>
                <span className={styles.etaDays}> · {eta.days} day{eta.days > 1 ? 's' : ''}</span>
              </div>
            ) : (
              <div className={styles.etaHint}>Enter a 6-digit pincode to see the delivery date.</div>
            )}
          </div>

          {p.freebie.enabled && (
            <div className={styles.freebie}>
              <Gift size={16} />
              <div>
                <div className={styles.freebieOverline}>Free gift</div>
                <div className={styles.freebieDesc}>{p.freebie.description}</div>
              </div>
            </div>
          )}

          {hasShades && (
            <div className={styles.shadeBlock}>
              <div className={styles.blockLabel}>
                Colour — <strong>{shade?.name}</strong>
              </div>
              <div className={styles.swatches}>
                {p.shades.map((sh, i) => (
                  <button
                    key={sh.name}
                    className={cn(styles.swatch, i === shadeIdx && styles.swatchOn)}
                    style={{ background: `linear-gradient(155deg, ${sh.g1}, ${sh.g2})` }}
                    onClick={() => {
                      setShadeIdx(i);
                      setQty(1);
                    }}
                    aria-label={sh.name}
                  />
                ))}
              </div>
              <div className={styles.shadeStock}>
                {shadeStock === 0
                  ? 'Restocking soon'
                  : shadeStock < 10
                    ? `Only ${shadeStock} left`
                    : 'Ships in 2 days'}
              </div>
            </div>
          )}

          {!authed ? (
            <Button size="lg" block icon={<ShoppingCart size={17} />} onClick={() => navigate('/')}>
              Sign in to buy
            </Button>
          ) : line ? (
            <div className={styles.inCart}>
              <div className={styles.inCartHead}>
                <Check size={15} /> In your cart
              </div>
              <div className={styles.inCartControls}>
                <QtyStepper
                  value={line.qty}
                  onChange={(v) => void setLineQty(line.itemId, v)}
                  max={Math.max(1, shadeStock)}
                />
                <button className={styles.removeBtn} onClick={() => void removeLine(line.itemId)}>
                  <Trash2 size={14} /> Remove
                </button>
              </div>
              <Button size="lg" block onClick={() => navigate('/shop/cart')}>
                Go to cart
              </Button>
              {checkoutEnabled && (
                <Button size="lg" variant="secondary" block onClick={() => navigate('/shop/checkout')}>
                  Buy now
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={styles.qtyWrap}>
                <span className={styles.qtyLabel}>Quantity</span>
                <QtyStepper value={qty} onChange={setQty} max={Math.max(1, shadeStock)} />
              </div>
              <Button size="lg" block disabled={!inStock} icon={<ShoppingCart size={17} />} onClick={() => add(false)}>
                Add to cart
              </Button>
              {checkoutEnabled && (
                <Button size="lg" variant="secondary" block disabled={!inStock} onClick={() => add(true)}>
                  Buy now
                </Button>
              )}
            </>
          )}

          <button
            className={cn(styles.wishBtn, wished && styles.wishOn)}
            onClick={() => void toggleWishlist(p.id)}
          >
            <Heart size={16} fill={wished ? 'currentColor' : 'none'} />
            {wished ? 'Wishlisted' : 'Add to wishlist'}
          </button>
        </aside>
      </div>

      {related.length > 0 && (
        <div className={styles.related}>
          <div className={s.sectionTitle} style={{ marginBottom: 16 }}>
            Related products
          </div>
          <ProductGrid items={related} />
        </div>
      )}
    </div>
  );
}
