import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Logo } from '@/components';
import { SHOW_BACK, routeTitles } from '../nav';
import styles from './MobileHeader.module.css';

export function MobileHeader({ route }: { route: string }) {
  const navigate = useNavigate();
  const showBack = SHOW_BACK.has(route);
  const title = routeTitles[route] ?? 'imcorpcart';

  return (
    <header className={styles.header}>
      {showBack ? (
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      ) : (
        <Logo size={26} />
      )}
      <div className={styles.title}>{title}</div>
    </header>
  );
}
