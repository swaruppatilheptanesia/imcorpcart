import logoUrl from '@/assets/Logo_IlaMarketing.png';

// The imcorpcart brand mark. Rendered wherever the brand appears (portal
// sidebars, storefront nav/footer, login/register, mobile header). The source
// PNG is a self-contained circular mark, so no wrapper styling is needed.
export function Logo({
  size = 30,
  className,
  alt = 'imcorpcart',
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{ objectFit: 'contain', display: 'block', flex: '0 0 auto', borderRadius: '50%' }}
    />
  );
}

export { logoUrl };
