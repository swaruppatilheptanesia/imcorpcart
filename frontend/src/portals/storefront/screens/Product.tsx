import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Gift, Heart, ShoppingCart, AlertTriangle, Check, Truck, Trash2, ChevronLeft, ChevronRight, Share2, X } from 'lucide-react';
import { Button, Skeleton, EmptyState, useToast, Field, Input } from '@/components';
import { cn } from '@/lib/cn';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useStore } from '../store-context';
import { getProductById, getRelated, type ProductDetail } from '../data';
import { submitReview, getDeliveryEstimate, type DeliveryEstimate } from '@/data/shop-api';
import { QtyStepper } from '../components/QtyStepper';
import { ProductGrid } from '../components/ProductGrid';
import { RatingStars, StarInput } from '../components/RatingStars';
import s from './store-screen.module.css';
import styles from './Product.module.css';

const PINCODE_KEY = 'imc_pincode';
const fmtEtaDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
// Amazon-style: cap the thumbnail rail; extra images go behind a "+N / View more"
// tile that opens the full-view lightbox.
const MAX_THUMBS = 5;

export function Product() {
  const { id } = useParams();
  const { data, state, error, reload } = useAsync<ProductDetail | undefined>(
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

function Detail({ p }: { p: ProductDetail }) {
  const navigate = useNavigate();
  const { flash } = useToast();
  const { addToCart, cart, setLineQty, removeLine, toggleWishlist, isWished, authed, checkoutEnabled } = useStore();

  const hasShades = p.shades.length > 0;
  const [shadeIdx, setShadeIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [pincode, setPincode] = useState(() => localStorage.getItem(PINCODE_KEY) ?? '');

  // Switching colour/variant navigates to a sibling SKU; reset the gallery to
  // that product's first image so it opens on the selected colour's photo.
  useEffect(() => {
    setActiveImg(0);
    setShadeIdx(0);
    setLightbox(false);
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

  // Full-view lightbox: lock page scroll + wire keyboard (Esc / arrows) while open.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false);
      else if (e.key === 'ArrowLeft') stepImg(-1);
      else if (e.key === 'ArrowRight') stepImg(1);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, p.images.length]);
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

  // Delivery estimate — real Blue Dart TAT lookup, debounced on a valid pincode.
  const [eta, setEta] = useState<DeliveryEstimate | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  useEffect(() => {
    if (!/^\d{6}$/.test(pincode)) {
      setEta(null);
      return;
    }
    localStorage.setItem(PINCODE_KEY, pincode);
    let cancelled = false;
    setEtaLoading(true);
    const t = setTimeout(() => {
      getDeliveryEstimate(pincode)
        .then((r) => !cancelled && setEta(r))
        .catch(() => !cancelled && setEta(null))
        .finally(() => !cancelled && setEtaLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
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
                {p.images.slice(0, MAX_THUMBS).map((src, i) => {
                  // Last visible slot when there are more images → "+N / View more"
                  // tile that opens the full-view lightbox instead of selecting.
                  const isMore = i === MAX_THUMBS - 1 && p.images.length > MAX_THUMBS;
                  return (
                    <button
                      key={src + i}
                      className={cn(styles.thumb, !isMore && i === activeImg && styles.thumbOn)}
                      onMouseEnter={() => !isMore && setActiveImg(i)}
                      onClick={() => (isMore ? setLightbox(true) : setActiveImg(i))}
                      aria-label={isMore ? 'View all images' : `Image ${i + 1}`}
                    >
                      <img className={styles.thumbImg} src={src} alt="" />
                      {isMore && (
                        <span className={styles.thumbMore}>
                          <strong>+{p.images.length - MAX_THUMBS}</strong>
                          <span>View more</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className={styles.gallery} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {hasImages ? (
                <img
                  className={styles.mainImg}
                  src={p.images[activeImg] ?? p.images[0]}
                  alt={p.name}
                  onClick={() => setLightbox(true)}
                />
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
            {p.reviews > 0 && (
              <a href="#reviews" className={styles.ratingLink}>
                <RatingStars rating={p.rating} reviews={p.reviews} />
              </a>
            )}
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

          {(p.specs.length > 0 || p.hsnCode || p.gstPercent != null) && (
            <div className={styles.specs}>
              <div className={styles.blockTitle}>Specifications</div>
              {p.specs.map((sp) => (
                <div key={sp.k} className={styles.specRow}>
                  <span className={styles.specK}>{sp.k}</span>
                  <span className={styles.specV}>{sp.v}</span>
                </div>
              ))}
              {p.hsnCode && (
                <div className={styles.specRow}>
                  <span className={styles.specK}>HSN Code</span>
                  <span className={styles.specV}>{p.hsnCode}</span>
                </div>
              )}
              {p.gstPercent != null && (
                <div className={styles.specRow}>
                  <span className={styles.specK}>GST</span>
                  <span className={styles.specV}>{p.gstPercent}%</span>
                </div>
              )}
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

          {p.warrantyText && (
            <div className={styles.policy}>
              <div className={styles.blockTitle}>Warranty</div>
              <p className={styles.policyText}>{p.warrantyText}</p>
            </div>
          )}

          {p.termsText && (
            <div className={styles.policy}>
              <div className={styles.blockTitle}>Terms &amp; Conditions</div>
              <p className={styles.policyText}>{p.termsText}</p>
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
          {p.cashback > 0 && (
            <div className={styles.cashback}>Earn {inr(p.cashback)} cashback to your wallet</div>
          )}
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
            {etaLoading ? (
              <div className={styles.etaHint}>Checking delivery…</div>
            ) : eta && eta.serviceable && eta.etaDate ? (
              <div className={styles.etaText}>
                Get it by <strong>{fmtEtaDate(eta.etaDate)}</strong>
                <span className={styles.etaDays}>
                  {' '}· {eta.tatDays} day{(eta.tatDays ?? 1) > 1 ? 's' : ''}
                  {eta.courier ? ` · ${eta.courier}` : ''}
                </span>
                {eta.edl && (
                  <div className={styles.etaHint}>Extended delivery area — may take a little longer.</div>
                )}
              </div>
            ) : eta && !eta.serviceable ? (
              <div className={styles.etaHint}>Sorry, not serviceable to this pincode.</div>
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

      <ReviewsSection p={p} authed={authed} />

      {related.length > 0 && (
        <div className={styles.related}>
          <div className={s.sectionTitle} style={{ marginBottom: 16 }}>
            Related products
          </div>
          <ProductGrid items={related} />
        </div>
      )}

      {/* Full-view image lightbox (Amazon-style) */}
      {lightbox && hasImages && (
        <div className={styles.lightbox} onClick={() => setLightbox(false)} role="dialog" aria-modal="true">
          <button className={styles.lightboxClose} onClick={() => setLightbox(false)} aria-label="Close">
            <X size={22} />
          </button>
          <img
            className={styles.lightboxImg}
            src={p.images[activeImg] ?? p.images[0]}
            alt={p.name}
            onClick={(e) => e.stopPropagation()}
          />
          {p.images.length > 1 && (
            <>
              <button
                className={cn(styles.lightboxNav, styles.lbPrev)}
                onClick={(e) => { e.stopPropagation(); stepImg(-1); }}
                aria-label="Previous image"
              >
                <ChevronLeft size={26} />
              </button>
              <button
                className={cn(styles.lightboxNav, styles.lbNext)}
                onClick={(e) => { e.stopPropagation(); stepImg(1); }}
                aria-label="Next image"
              >
                <ChevronRight size={26} />
              </button>
              <div className={styles.lightboxThumbs} onClick={(e) => e.stopPropagation()}>
                {p.images.map((src, i) => (
                  <button
                    key={src + i}
                    className={cn(styles.lbThumb, i === activeImg && styles.lbThumbOn)}
                    onClick={() => setActiveImg(i)}
                    aria-label={`Image ${i + 1}`}
                  >
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

function ReviewsSection({ p, authed }: { p: ProductDetail; authed: boolean }) {
  const navigate = useNavigate();
  const { flash } = useToast();
  const reviews = p.reviewList;
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (rating < 1 || !body.trim()) {
      setErr('Please pick a star rating and write a short review.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await submitReview(p.id, { rating, title: title.trim() || undefined, body: body.trim() });
      setDone(true);
      flash('Review submitted — pending approval');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit your review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="reviews" className={styles.reviews}>
      <div className={s.sectionTitle} style={{ marginBottom: 16 }}>
        Ratings &amp; reviews
      </div>

      <div className={styles.reviewsGrid}>
        {/* Summary + list */}
        <div>
          {p.reviews > 0 ? (
            <>
              <div className={styles.reviewSummary}>
                <span className={styles.reviewAvg}>{p.rating.toFixed(1)}</span>
                <div>
                  <RatingStars rating={p.rating} size={18} />
                  <div className={styles.reviewCount}>
                    {p.reviews.toLocaleString('en-IN')} verified review{p.reviews > 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div className={styles.reviewList}>
                {reviews.map((r) => (
                  <div key={r.id} className={styles.reviewItem}>
                    <RatingStars rating={r.rating} />
                    {r.title && <div className={styles.reviewTitle}>{r.title}</div>}
                    <p className={styles.reviewBody}>{r.body}</p>
                    <div className={styles.reviewAuthor}>{r.author}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.reviewEmpty}>No reviews yet. Be the first to review this product.</p>
          )}
        </div>

        {/* Write a review */}
        <aside className={styles.reviewForm}>
          {!authed ? (
            <>
              <div className={styles.blockTitle}>Share your experience</div>
              <p className={styles.reviewEmpty}>Sign in to write a review.</p>
              <Button block onClick={() => navigate('/')}>
                Sign in to review
              </Button>
            </>
          ) : done ? (
            <div className={styles.reviewThanks}>
              <Check size={18} />
              <div>
                <strong>Thanks for your review!</strong>
                <div className={styles.reviewEmpty}>
                  It will appear here once our team verifies it.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.blockTitle}>Write a review</div>
              <div className={styles.reviewField}>
                <span className={styles.reviewFieldLabel}>Your rating</span>
                <StarInput value={rating} onChange={setRating} />
              </div>
              <Field label="Title (optional)">
                <Input
                  placeholder="Sum it up in a line"
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Your review">
                <textarea
                  className={styles.reviewTextarea}
                  placeholder="What did you like or dislike?"
                  value={body}
                  maxLength={2000}
                  rows={4}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              {err && <div className={styles.reviewError}>{err}</div>}
              <Button block disabled={busy} onClick={submit}>
                {busy ? 'Submitting…' : 'Submit review'}
              </Button>
              <p className={styles.reviewNote}>Reviews are verified by our team before they appear.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
