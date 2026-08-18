import { useState } from 'react';
import { Mail, Phone, Clock, Send } from 'lucide-react';
import { Card, Field, Input, Button, useToast } from '@/components';
import styles from './Contact.module.css';

const CHANNELS = [
  { icon: Mail, label: 'Email', value: 'sales@imcorpcart.com', href: 'mailto:sales@imcorpcart.com' },
  { icon: Phone, label: 'Phone', value: '+91 91203 91203', href: 'tel:+919120391203' },
  { icon: Clock, label: 'Hours', value: 'Mon–Sat, 9am – 7pm IST', href: undefined },
];

export function Contact() {
  const { flash } = useToast();
  const [f, setF] = useState({ name: '', email: '', message: '' });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const valid = f.name.trim() && /^\S+@\S+\.\S+$/.test(f.email) && f.message.trim().length > 4;

  const submit = () => {
    if (!valid) return;
    setF({ name: '', email: '', message: '' });
    flash("Thanks — we'll be in touch shortly.");
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>Contact us</h1>
        <p className={styles.sub}>Questions about an order, delivery, or your EPP access? Reach out — we're happy to help.</p>
      </div>

      <div className={styles.grid}>
        <Card pad="lg" className={styles.channels}>
          {CHANNELS.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className={styles.channel}>
                <span className={styles.channelIcon}>
                  <Icon size={17} />
                </span>
                <div>
                  <div className={styles.channelLabel}>{c.label}</div>
                  {c.href ? (
                    <a href={c.href} className={styles.channelValue}>{c.value}</a>
                  ) : (
                    <div className={styles.channelValue}>{c.value}</div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        <Card pad="lg" className={styles.form}>
          <div className={styles.formTitle}>Send a message</div>
          <Field label="Your name">
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Full name" />
          </Field>
          <Field label="Email">
            <Input value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" inputMode="email" />
          </Field>
          <Field label="Message">
            <textarea
              className={styles.textarea}
              value={f.message}
              onChange={(e) => set({ message: e.target.value })}
              placeholder="How can we help?"
              rows={5}
            />
          </Field>
          <Button icon={<Send size={16} />} disabled={!valid} onClick={submit}>
            Send message
          </Button>
        </Card>
      </div>
    </div>
  );
}
