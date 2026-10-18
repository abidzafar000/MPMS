"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, BellOff, Check, Search, Sparkles } from 'lucide-react';
import type { PmsState, Reservation } from '@/lib/pms-types';
import { paymentFollowups, type PaymentFollowup } from '@/lib/payment-followups';
import { balance, day, guestName, money, roomName, stamp, today, type FormSpec, type Mutate } from './pms-data';
import { Badge, Empty } from './pms-ui';
import './pms-operations.css';

export function PaymentAlarm({ items, onOpen }: { items: PaymentFollowup[]; onOpen: () => void }) {
  const [sound, setSound] = useState(false);
  const [soundError, setSoundError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const missed = items.filter(item => item.missed);
  const signature = missed.map(item => `${item.reservation.id}:${item.due}`).sort().join('|');
  const beep = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.connect(gain); gain.connect(context.destination);
    tone.frequency.value = 660;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(.07, context.currentTime + .03);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .35);
    tone.start(); tone.stop(context.currentTime + .4);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  }, []);
  useEffect(() => {
    if (!sound || !signature) return;
    beep();
    const timer = setInterval(beep, 60000);
    return () => clearInterval(timer);
  }, [sound, signature, beep]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  async function toggleSound() {
    if (sound) { setSound(false); return; }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      if (audio.current.state !== 'running') throw new Error();
      setSoundError(''); setSound(true);
    } catch { setSoundError('Sound is unavailable in this browser. The visible payment alert remains active.'); }
  }
  return <div className={`payment-alarm ${missed.length ? 'has-missed' : ''}`}>
    <div role={missed.length ? 'alert' : 'status'}><Bell size={17}/><span><strong>{missed.length ? `${missed.length} missed-payment ${missed.length === 1 ? 'account' : 'accounts'}` : 'No missed payments'}</strong><small>{missed.length ? 'Unpaid checkouts, corporate dues and overdue payments need follow-up.' : 'Checkout and corporate balances are settled.'}</small></span></div>
    <div className="actions"><button className="link-button" onClick={onOpen}>Review payments</button><button className="btn btn-small" type="button" aria-pressed={sound} onClick={() => void toggleSound()}>{sound ? <BellOff size={13}/> : <Bell size={13}/>} {sound ? 'Mute alarm' : 'Enable sound alarm'}</button></div>
    {sound && <p className="alarm-note">Sound repeats every minute while this portal is open and missed balances remain.</p>}
    {soundError && <p className="alarm-note" role="status">{soundError}</p>}
  </div>;
}

export function FrontDeskToday({ state: s, onBooking }: { state: PmsState; onBooking: (id: string) => void }) {
  const date = today();
  const groups = [
    { title: 'Arrivals', hint: 'Expected today', rows: s.reservations.filter(r => r.arrival === date && r.status === 'reserved') },
    { title: 'Departures', hint: 'Due today or awaiting checkout', rows: s.reservations.filter(r => r.departure <= date && r.status === 'checked_in') },
    { title: 'In-house', hint: 'Currently checked in', rows: s.reservations.filter(r => r.status === 'checked_in') },
  ];
  return <section className="frontdesk-today" aria-label="Today's front desk"><div className="section-heading"><div><h2>Today's front desk</h2><p>{day(date)} {date.slice(0, 4)} · Pakistan time</p></div></div><div className="frontdesk-columns">{groups.map(group => <section className="panel" key={group.title}>
    <header className="panel-header"><div><h3>{group.title}</h3><p>{group.hint}</p></div><span className="frontdesk-count">{group.rows.length}</span></header>
    <div className="frontdesk-list">{group.rows.length ? group.rows.map(r => <button className="frontdesk-stay" key={r.id} onClick={() => onBooking(r.id)}><span><strong>{guestName(s, r)}</strong><small>{r.reference}</small></span><span className="frontdesk-stay-room">Room {roomName(s, r)}<small>{day(r.arrival, true)} – {day(r.departure, true)}</small></span></button>) : <p className="frontdesk-empty">No {group.title.toLowerCase()} to show.</p>}</div>
  </section>)}</div></section>;
}

export function HousekeepingPanel({ state: s, mutate, busy }: { state: PmsState; mutate: Mutate; busy: boolean }) {
  const [filter, setFilter] = useState('dirty');
  const rooms = s.rooms.filter(room => !room.archived);
  const dirty = rooms.filter(room => room.status === 'dirty');
  const rows = rooms.filter(room => filter === 'all' || room.status === filter);
  return <div className="stack"><div className="notice"><Sparkles size={17}/><span>Checkout and an in-house room move place the vacated room here as Dirty. Mark it clean after inspection to make it ready again.</span></div><section className="panel"><header className="panel-header"><div><h2>Housekeeping board</h2><p>{dirty.length} need cleaning · {rooms.filter(room => room.status === 'clean').length} clean · {rooms.filter(room => room.status === 'out_of_service').length} out of service</p></div><select className="filter" aria-label="Housekeeping room filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="dirty">Needs cleaning</option><option value="clean">Clean rooms</option><option value="out_of_service">Out of service</option><option value="all">All rooms</option></select></header>
    {rows.length ? <div className="housekeeping-grid">{rows.map(room => {
      const task = s.tasks.find(task => task.roomId === room.id && task.kind === 'housekeeping' && task.status === 'open');
      const occupied = s.reservations.find(r => r.roomId === room.id && r.status === 'checked_in');
      return <article className="housekeeping-card" key={room.id}><div className="actions"><h3>Room {room.number}</h3><Badge value={room.status}/></div><p>{s.roomTypes.find(type => type.id === room.typeId)?.name} · {occupied ? 'Occupied' : 'Vacant'}</p>
        {room.status === 'dirty' && <><label className="field"><span>Assigned staff</span><select aria-label={`Housekeeping staff for room ${room.number}`} disabled={busy} value={task?.assignedTo || ''} onChange={e => void mutate('saveTask', { ...(task ? { id: task.id } : {}), roomId: room.id, kind: 'housekeeping', title: `Clean room ${room.number}`, assignedTo: e.target.value || null, status: 'open', notes: task?.notes || '' }, 'Housekeeping assignment saved')}><option value="">Unassigned</option>{s.staff.filter(person => person.active).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button className="btn btn-primary" disabled={busy} onClick={() => void mutate('setRoomStatus', { id: room.id, status: 'clean' }, `Room ${room.number} is clean and ready`)}><Check size={14}/>Mark clean</button></>}
        {room.status === 'clean' && <button className="btn" disabled={busy} onClick={() => void mutate('setRoomStatus', { id: room.id, status: 'dirty' }, `Room ${room.number} added to housekeeping`)}>Mark dirty</button>}
        {room.status === 'out_of_service' && <p className="text-small muted">Release maintenance in room settings after the room is safe to use.</p>}
        {task?.createdAt && <small className="muted">Added {stamp(task.createdAt)}</small>}
      </article>;
    })}</div> : <Empty title={filter === 'dirty' ? 'Cleaning is up to date' : 'No rooms in this view'} detail="Room readiness updates here as your team works."/>}</section></div>;
}

export function CorporatePanel({ state: s, onForm, onBooking, onInvoice, canReceive }: { state: PmsState; onForm: (form: FormSpec) => void; onBooking: (id: string) => void; onInvoice: (r: Reservation) => void; canReceive: boolean }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('unpaid');
  const all = s.reservations.filter(r => r.status === 'checked_out' && r.payer === 'company');
  const rows = all.filter(r => (status === 'all' || (status === 'unpaid' ? balance(s, r).company > 0 : balance(s, r).company <= 0)) && [r.companyName, r.reference, guestName(s, r)].join(' ').toLowerCase().includes(query.toLowerCase()));
  const total = all.reduce((sum, r) => sum + Math.max(0, balance(s, r).company), 0);
  const receipts = s.transactions.filter(t => t.payer === 'company' && all.some(r => r.id === t.reservationId));
  return <div className="stack"><section className="panel"><header className="panel-header"><div><h2>Corporate checkout accounts</h2><p>Company-paid stays appear automatically after checkout. Receipts update the same booking and missed-payment balance.</p></div><strong className="money">{money(total)} to collect</strong></header><div className="toolbar"><label className="search"><Search size={15}/><input aria-label="Search corporate accounts" value={query} onChange={e => setQuery(e.target.value)} placeholder="Company, guest or booking number…"/></label><select className="filter" aria-label="Corporate payment filter" value={status} onChange={e => setStatus(e.target.value)}><option value="unpaid">Unpaid</option><option value="settled">Settled</option><option value="all">All corporate checkouts</option></select></div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Company / guest</th><th>Booking / checkout</th><th>Company due</th><th>Guest extras due</th><th>Actions</th></tr></thead><tbody>{rows.map(r => { const b = balance(s, r); return <tr key={r.id}><td><strong className="cell-title">{r.companyName || 'Company account'}</strong><span className="cell-meta">{guestName(s, r)}</span></td><td><button className="link-button" onClick={() => onBooking(r.id)}>{r.reference}</button><span className="cell-meta">{day(r.departure, true)} · Room {roomName(s, r)}</span></td><td className="money">{money(b.company)}</td><td className="money">{money(b.guest)}</td><td><div className="actions">{canReceive && b.company > 0 && <button className="btn btn-primary btn-small" onClick={() => onForm({ kind: 'payment', id: r.id, payer: 'company' })}>Receive payment</button>}<button className="link-button" onClick={() => onInvoice(r)}>Invoice / pro-forma</button><button className="link-button" onClick={() => onBooking(r.id)}>Open account</button></div></td></tr>; })}</tbody></table></div> : <Empty title="No corporate accounts in this view" detail="Choose Company account as the booking payer, add the company name, and check the guest out."/>}</section>
      <section className="panel"><header className="panel-header"><div><h2>Corporate receipts & refunds</h2><p>Recorded against the original booking and cashier shift</p></div></header>{receipts.length ? <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Company / booking</th><th>Recorded</th><th>Method</th><th>Amount</th></tr></thead><tbody>{[...receipts].reverse().map(t => {const r = all.find(r => r.id === t.reservationId)!;return <tr key={t.id}><td>{t.receipt}<span className="cell-meta">{t.kind}</span></td><td><strong className="cell-title">{r.companyName || 'Company account'}</strong><button className="link-button" onClick={() => onBooking(r.id)}>{r.reference}</button></td><td>{stamp(t.createdAt)}</td><td>{t.method.toUpperCase()}</td><td className="money">{t.kind === 'refund' ? '−' : ''}{money(t.amountPaisa)}</td></tr>;})}</tbody></table></div> : <Empty title="No corporate receipts yet" detail="Use Receive payment on a corporate account. Open your cashier shift before recording a receipt."/>}</section>
    </div>;
}

export function MissedPaymentsPanel({ state: s, onBooking, onForm }: { state: PmsState; onBooking: (id: string) => void; onForm: (form: FormSpec) => void }) {
  const [filter, setFilter] = useState('missed'); const [query, setQuery] = useState('');
  const items = paymentFollowups(s, today());
  const rows = items.filter(item => (filter === 'all' || filter === 'missed' && item.missed || filter === 'corporate' && item.missed && item.companyDue > 0 || filter === 'checkout' && item.reservation.status === 'checked_out' || filter === 'review' && item.review) && [item.reservation.reference, guestName(s, item.reservation), item.reservation.companyName].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section className="panel"><header className="panel-header"><div><h2>Missed payments</h2><p>Unpaid checkout balances and corporate receivables remain here until settled. Each booking is counted once.</p></div><strong className="money">{money(rows.reduce((sum, item) => sum + item.due, 0))}</strong></header><div className="toolbar"><label className="search"><Search size={15}/><input aria-label="Search missed payments" placeholder="Guest, company or booking…" value={query} onChange={e => setQuery(e.target.value)}/></label><select className="filter" aria-label="Missed payment filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="missed">Missed payments</option><option value="checkout">Unpaid checkouts</option><option value="corporate">Corporate dues</option><option value="all">All outstanding</option><option value="review">Cancellation review</option></select></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Guest / company</th><th>Reason / due date</th><th>Guest due</th><th>OTA due</th><th>Company due</th><th>Actions</th></tr></thead><tbody>{rows.map(({ reservation: r, reasons, review }) => { const b = balance(s, r); return <tr key={r.id}><td><button className="link-button cell-title" onClick={() => onBooking(r.id)}>{guestName(s, r)}</button><span className="cell-meta">{r.reference}</span>{r.companyName && <span className="cell-meta">{r.companyName}</span>}</td><td>{reasons.map(reason => <span className="missed-reason" key={reason}><AlertCircle size={11}/>{reason}</span>)}{review && <span className="badge overdue">Cancellation review</span>}<span className="cell-meta">Due {day(r.dueDate, true)}</span></td><td className="money">{money(b.guest)}</td><td className="money">{money(b.ota)}</td><td className="money">{money(b.company)}</td><td><div className="actions"><button className="btn btn-small" onClick={() => onForm({ kind: 'payment', id: r.id })}>Receive payment</button><button className="link-button" onClick={() => onBooking(r.id)}>Review booking</button></div></td></tr>; })}</tbody></table></div> : <Empty title="No balances need follow-up in this view" detail="Payments automatically reduce or clear the alert on their booking."/>}</section>;
}
