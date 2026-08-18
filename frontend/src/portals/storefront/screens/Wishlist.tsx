import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { EmptyState } from '@/components';
import { useStore } from '../store-context';
import { ProductGrid } from '../components/ProductGrid';
import styles from './Wishlist.module.css';

export function Wishlist() {
  const navigate = useNavigate();
  const { wishlist } = useStore();
  const items = wishlist;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Heart size={24} />}
        title="Your wishlist is empty"
        body="Tap the heart on any product to save it here for later."
        action={{ label: 'Browse store', onClick: () => navigate('/shop/home') }}
      />
    );
  }

  return (
    <div>
      <div className={styles.title}>Your wishlist</div>
      <ProductGrid items={items} />
    </div>
  );
}
