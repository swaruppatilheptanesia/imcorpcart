import { titles } from '../nav';
import styles from '../../super-admin/shell/Topbar.module.css';

export function Topbar({ route }: { route: string }) {
  const meta = titles[route] ?? { title: '', sub: '' };
  return (
    <header className={styles.topbar}>
      <div className={styles.titles}>
        <div className={styles.title}>{meta.title}</div>
        <div className={styles.sub}>{meta.sub}</div>
      </div>
      <div className={styles.spacer} />
    </header>
  );
}
