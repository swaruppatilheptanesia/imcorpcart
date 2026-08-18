import { useEffect, useState } from 'react';

/** Returns whether a CSS media query currently matches, updating on resize.
 *  Used sparingly — layout is CSS; this is only for JS that genuinely needs
 *  the viewport (e.g. bottom-sheet vs right-drawer behavior). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
