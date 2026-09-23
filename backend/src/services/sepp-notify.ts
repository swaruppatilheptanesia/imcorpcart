import { NotificationChannel, NotificationEvent, NotificationStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { toNumber } from '../models/serializers';
import { sendSeppEmail, appBaseUrl, type SeppEmailData } from './mailer.service';
import type { SeppQuote } from './sepp-calc';

// ─────────────────────────────────────────────────────────────────────────────
// Smart EPP lifecycle notifications. Every stage change emails the party whose
// turn it is (HR → leasing → employee) and leaves a Notification row per
// recipient as the audit trail (SENT / SKIPPED when the mailer is off / FAILED).
// Always fire-and-forget: `void notifySepp(...)` after the state change commits —
// a mail problem must never roll back an approval.
// ─────────────────────────────────────────────────────────────────────────────

export type SeppNotifyEvent = 'SUBMITTED' | 'HR_APPROVED' | 'ORDERED' | 'REJECTED' | 'CANCELLED' | 'INSTALLMENT_PAID';

const EVENT_ENUM: Record<SeppNotifyEvent, NotificationEvent> = {
  SUBMITTED: NotificationEvent.SMART_EPP_SUBMITTED,
  HR_APPROVED: NotificationEvent.SMART_EPP_HR_APPROVED,
  ORDERED: NotificationEvent.SMART_EPP_APPROVED,
  REJECTED: NotificationEvent.SMART_EPP_REJECTED,
  CANCELLED: NotificationEvent.SMART_EPP_REJECTED,
  INSTALLMENT_PAID: NotificationEvent.CREDIT_RELEASED,
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

interface Recipient { userId: string | null; email: string; name?: string | null }

async function deliver(recipient: Recipient, event: SeppNotifyEvent, data: SeppEmailData, payload: Prisma.InputJsonValue) {
  const { result, error } = await sendSeppEmail(recipient.email, data);
  if (!recipient.userId) return; // no platform user to attach the row to (e.g. leasing contact email only)
  const status = result === 'sent' ? NotificationStatus.SENT : result === 'skipped' ? NotificationStatus.SKIPPED : NotificationStatus.FAILED;
  await prisma.notification
    .create({
      data: {
        recipientId: recipient.userId,
        event: EVENT_ENUM[event],
        channel: NotificationChannel.EMAIL,
        status,
        payload: { ...(payload as object), to: recipient.email, heading: data.heading },
        sentAt: result === 'sent' ? new Date() : null,
        error: error ?? null,
      },
    })
    .catch(() => undefined);
}

export async function notifySepp(requestId: string, event: SeppNotifyEvent, extra: { installmentNo?: number; restored?: number } = {}) {
  try {
    const r = await prisma.smartEppRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requestNo: true,
        status: true,
        quote: true,
        totalAmount: true,
        advanceAmount: true,
        advanceRefundedAt: true,
        employee: { select: { user: { select: { id: true, email: true, fullName: true } } } },
        company: {
          select: {
            name: true,
            adminUser: { select: { id: true, email: true, fullName: true } },
            employees: { where: { deletedAt: null, user: { role: 'COMPANY_HR', status: 'ACTIVE' } }, select: { user: { select: { id: true, email: true, fullName: true } } } },
            leasingCompany: { select: { name: true, contactEmail: true, user: { select: { id: true, email: true, fullName: true } } } },
          },
        },
        items: { select: { quantity: true, product: { select: { name: true } } } },
        approvals: { select: { stage: true, status: true, comments: true } },
        orders: { select: { orderNo: true } },
        leaseTerms: { select: { tenureMonths: true, emiAmount: true } },
      },
    });
    if (!r) return;

    const q = r.quote as SeppQuote | null;
    const base = appBaseUrl();
    const devices = r.items.map((i) => (i.quantity > 1 ? `${i.product.name} × ${i.quantity}` : i.product.name)).join(', ');
    const emi = q ? rupees(q.monthlyRental) : r.leaseTerms ? rupees(toNumber(r.leaseTerms.emiAmount)) : '—';
    const tenure = q?.tenureMonths ?? r.leaseTerms?.tenureMonths ?? 12;
    const employee = r.employee.user;
    const facts: [string, string][] = [
      ['Request', r.requestNo],
      ['Employee', `${employee.fullName} (${r.company.name})`],
      ['Devices', devices],
      ['Asset cost', rupees(toNumber(r.totalAmount))],
      ['Monthly rental', `${emi} × ${tenure} months`],
    ];
    const payload = { requestId: r.id, requestNo: r.requestNo, status: r.status, event };

    const hrRecipients: Recipient[] = [
      ...(r.company.adminUser ? [{ userId: r.company.adminUser.id, email: r.company.adminUser.email, name: r.company.adminUser.fullName }] : []),
      ...r.company.employees.map((e) => ({ userId: e.user.id, email: e.user.email, name: e.user.fullName })),
    ].filter((x, i, arr) => arr.findIndex((y) => y.email === x.email) === i);
    const lc = r.company.leasingCompany;
    const leasingRecipient: Recipient | null = lc?.user
      ? { userId: lc.user.id, email: lc.user.email, name: lc.user.fullName }
      : lc?.contactEmail
        ? { userId: null, email: lc.contactEmail }
        : null;
    const employeeRecipient: Recipient = { userId: employee.id, email: employee.email, name: employee.fullName };

    const jobs: Promise<void>[] = [];
    switch (event) {
      case 'SUBMITTED':
        for (const hr of hrRecipients) {
          jobs.push(
            deliver(hr, event, {
              heading: 'A Smart EPP request needs your approval',
              intro: `${employee.fullName} has requested a device on Smart EPP. As HR, you review it first; once approved it goes to ${lc?.name ?? 'the leasing company'}.`,
              lines: facts,
              cta: { label: 'Review in the company portal', url: `${base}/company/sepp` },
            }, payload),
          );
        }
        break;

      case 'HR_APPROVED':
        if (leasingRecipient) {
          jobs.push(
            deliver(leasingRecipient, event, {
              heading: 'HR approved — a lease request awaits your decision',
              intro: `${r.company.name}'s HR has approved ${employee.fullName}'s Smart EPP request. Approving it in your portal writes the lease schedule and places the order.`,
              lines: [...facts, ['HR comment', r.approvals.find((a) => a.stage === 'HR')?.comments || '—']],
              cta: { label: 'Open in the leasing portal', url: `${base}/leasing/requests?open=${r.id}` },
            }, payload),
          );
        }
        jobs.push(
          deliver(employeeRecipient, event, {
            heading: 'HR approved your Smart EPP request',
            intro: `Good news — your HR has approved ${r.requestNo}. It is now with ${lc?.name ?? 'the leasing company'} for the final decision.`,
            lines: facts.filter(([k]) => k !== 'Employee'),
            cta: { label: 'Track your request', url: `${base}/shop/sepp/requests/${r.requestNo}` },
          }, payload),
        );
        break;

      case 'ORDERED':
        jobs.push(
          deliver(employeeRecipient, event, {
            heading: 'Your Smart EPP request is approved — order placed',
            intro: `${lc?.name ?? 'The leasing company'} has approved ${r.requestNo}. Your order has been placed and will be delivered to your office branch. ${emi} will be deducted from your salary each month for ${tenure} months.`,
            lines: [
              ...facts.filter(([k]) => k !== 'Employee'),
              ['Order' + (r.orders.length > 1 ? 's' : ''), r.orders.map((o) => o.orderNo).join(', ') || '—'],
            ],
            cta: { label: 'View your order', url: `${base}/shop/orders` },
          }, payload),
        );
        for (const hr of hrRecipients) {
          jobs.push(
            deliver(hr, event, {
              heading: `Lease approved for ${employee.fullName}`,
              intro: `${lc?.name ?? 'The leasing company'} approved ${r.requestNo}. Please set up the monthly payroll deduction; mark each installment paid in the company portal to restore the employee's purchase limit.`,
              lines: facts,
              cta: { label: 'Open in the company portal', url: `${base}/company/sepp` },
            }, payload),
          );
        }
        break;

      case 'REJECTED': {
        const rej = r.approvals.find((a) => a.status === 'REJECTED');
        const by = rej?.stage === 'LEASING' ? lc?.name ?? 'the leasing company' : 'your HR';
        jobs.push(
          deliver(employeeRecipient, event, {
            heading: 'Your Smart EPP request was not approved',
            intro: `${r.requestNo} was declined by ${by}. Your purchase limit has been released${toNumber(r.advanceAmount) > 0 ? ' and the advance you paid is being refunded to the original payment method' : ''}.`,
            lines: [...facts.filter(([k]) => k !== 'Employee'), ['Reason', rej?.comments || 'No reason given']],
            cta: { label: 'View request', url: `${base}/shop/sepp/requests/${r.requestNo}` },
          }, payload),
        );
        if (rej?.stage === 'LEASING') {
          for (const hr of hrRecipients) {
            jobs.push(
              deliver(hr, event, {
                heading: `Lease declined for ${employee.fullName}`,
                intro: `${lc?.name ?? 'The leasing company'} declined ${r.requestNo}. No payroll deduction is needed.`,
                lines: [...facts, ['Reason', rej?.comments || '—']],
                cta: { label: 'Open in the company portal', url: `${base}/company/sepp` },
              }, payload),
            );
          }
        }
        break;
      }

      case 'CANCELLED':
        for (const hr of hrRecipients) {
          jobs.push(
            deliver(hr, event, {
              heading: `${employee.fullName} withdrew a Smart EPP request`,
              intro: `${r.requestNo} was cancelled by the employee before approval. Nothing further is needed.`,
              lines: facts,
            }, payload),
          );
        }
        break;

      case 'INSTALLMENT_PAID':
        jobs.push(
          deliver(employeeRecipient, event, {
            heading: `EMI #${extra.installmentNo ?? '?'} recorded — limit restored`,
            intro: `Your HR recorded installment #${extra.installmentNo ?? '?'} of ${tenure} for ${r.requestNo}. ${extra.restored ? rupees(extra.restored) : 'That instalment'} of your Smart EPP purchase limit is available again.`,
            lines: facts.filter(([k]) => k !== 'Employee'),
            cta: { label: 'View your limit', url: `${base}/shop/profile` },
          }, { ...payload, installmentNo: extra.installmentNo ?? null, restored: extra.restored ?? null }),
        );
        break;
    }
    await Promise.all(jobs);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sepp-notify] failed', requestId, event, e instanceof Error ? e.message : e);
  }
}
