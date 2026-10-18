import type { PmsState } from './pms-types';

/** Each reservation appears once, even when several follow-up reasons apply. */
export function paymentFollowups(state: PmsState, today: string) {
  return state.reservations.flatMap(reservation => {
    const transactions = state.transactions.filter(t => t.reservationId === reservation.id);
    const net = (payer?: string) => transactions.filter(t => !payer || t.payer === payer)
      .reduce((sum, t) => sum + (t.kind === 'payment' ? t.amountPaisa : t.kind === 'refund' ? -t.amountPaisa : 0), 0);
    const extras = reservation.extras.reduce((sum, extra) => sum + extra.amountPaisa, 0);
    const companyDue = (reservation.payer === 'company' ? reservation.roomTotalPaisa : 0) - net('company');
    const guestDue = extras + (reservation.payer === 'guest' ? reservation.roomTotalPaisa : 0) - net('guest');
    const otaDue = (reservation.payer === 'ota' ? reservation.roomTotalPaisa : 0) - net('ota');
    // A credit belonging to one payer must not hide another payer's unpaid charges.
    const due = Math.max(0, companyDue) + Math.max(0, guestDue) + Math.max(0, otaDue);
    if (due <= 0) return [];
    const review = ['cancelled', 'no_show'].includes(reservation.status);
    const reasons: string[] = [];
    if (!review) {
      if (reservation.status === 'checked_out') reasons.push('Unpaid checkout');
      if (companyDue > 0) reasons.push('Corporate amount pending');
      if (reservation.dueDate < today) reasons.push('Past payment due date');
    }
    return [{ reservation, due, companyDue, reasons, missed: reasons.length > 0, review }];
  });
}
export type PaymentFollowup = ReturnType<typeof paymentFollowups>[number];
