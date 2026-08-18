import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, Field, Input, Toggle, Radio, Button, Skeleton, EmptyState, useToast } from '@/components';
import { getPaymentConfig, updatePaymentConfig, type PaymentConfig } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import s from './screen.module.css';
import styles from './Payments.module.css';

const METHOD_LABELS: Record<string, { label: string; note: string }> = {
  UPI: { label: 'UPI', note: 'Google Pay, PhonePe, Paytm' },
  NET_BANKING: { label: 'Net Banking', note: 'All major banks' },
  CREDIT_CARD: { label: 'Credit Card', note: 'Visa, Mastercard, Amex, RuPay' },
  DEBIT_CARD: { label: 'Debit Card', note: 'Visa, Mastercard, RuPay' },
};

export function Payments() {
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(() => getPaymentConfig(), []);

  if (state === 'loading') {
    return (
      <div className={s.narrow} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={220} />
        <Skeleton h={200} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load payment config"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  }
  return <PaymentsForm config={data} flash={flash} onSaved={reload} />;
}

function PaymentsForm({ config, flash, onSaved }: { config: PaymentConfig; flash: (m: string) => void; onSaved: () => void }) {
  const [surcharges, setSurcharges] = useState<Record<string, string>>(
    Object.fromEntries(config.methods.map((m) => [m.method, String(m.surchargePercent)])),
  );
  const [gst, setGst] = useState(config.methods.some((m) => m.gstOnSurchargePercent > 0));
  const [gateway, setGateway] = useState(config.gateways.find((g) => g.active)?.provider ?? 'RAZORPAY');
  const [apiKey, setApiKey] = useState('');
  const [webhook, setWebhook] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSurcharges(Object.fromEntries(config.methods.map((m) => [m.method, String(m.surchargePercent)])));
  }, [config]);

  const save = async () => {
    setSaving(true);
    try {
      await updatePaymentConfig({
        methods: config.methods.map((m) => ({
          method: m.method,
          surchargePercent: Number(surcharges[m.method] ?? m.surchargePercent) || 0,
          gstOnSurchargePercent: gst ? 18 : 0,
        })),
        gateways: [
          {
            provider: gateway,
            active: true,
            keyRef: apiKey.trim() || undefined,
            webhookRef: webhook.trim() || undefined,
          },
        ],
      });
      flash('Payment settings saved');
      setApiKey('');
      setWebhook('');
      onSaved();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={s.narrow}>
      <Card pad="lg" className={styles.card}>
        <div className={s.sectionTitle}>Surcharge per payment method</div>
        <div className={styles.methods}>
          {config.methods.map((m) => (
            <div key={m.method} className={styles.method}>
              <div>
                <div className={styles.methodLabel}>{METHOD_LABELS[m.method]?.label ?? m.method}</div>
                <div className={styles.methodNote}>{METHOD_LABELS[m.method]?.note ?? ''}</div>
              </div>
              <div className={styles.methodInput}>
                <Input
                  value={surcharges[m.method] ?? ''}
                  onChange={(e) => setSurcharges((s2) => ({ ...s2, [m.method]: e.target.value }))}
                  prefix="%"
                  inputSize="sm"
                />
              </div>
            </div>
          ))}
        </div>
        <div className={styles.gstRow}>
          <div>
            <div className={styles.methodLabel}>Charge GST on surcharge</div>
            <div className={styles.methodNote}>Adds 18% GST on the payment surcharge.</div>
          </div>
          <Toggle on={gst} onClick={() => setGst(!gst)} />
        </div>
      </Card>

      <Card pad="lg" className={styles.card}>
        <div className={s.sectionTitle}>Payment gateway</div>
        <div className={styles.gateways}>
          {config.gateways.length === 0 && (
            <div className={styles.methodNote}>No gateways configured yet — pick one and save keys below.</div>
          )}
          {(['RAZORPAY', 'PAYU'] as const).map((provider) => {
            const g = config.gateways.find((x) => x.provider === provider);
            return (
              <div
                key={provider}
                role="radio"
                aria-checked={gateway === provider}
                tabIndex={0}
                className={`${styles.gateway} ${gateway === provider ? styles.gatewayOn : ''}`}
                onClick={() => setGateway(provider)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setGateway(provider)}
              >
                <Radio checked={gateway === provider} />
                <div>
                  <div className={styles.methodLabel}>{provider === 'RAZORPAY' ? 'Razorpay' : 'PayU'}</div>
                  <div className={styles.methodNote}>
                    {g?.hasKey ? 'Key configured' : 'No key set'}
                    {provider === 'RAZORPAY' ? ' · Primary' : ' · Backup gateway'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.keys}>
          <Field label="API key" hint="Write-only — never shown back">
            <Input placeholder="rzp_live_••••••••••••" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <Field label="Webhook secret">
            <Input placeholder="whsec_••••••••••••" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onSaved} disabled={saving}>
          Reset
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
