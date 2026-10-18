"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PmsState, Reservation } from "@/lib/pms-types";
import { getCalendarBarLayout } from "@/lib/calendar-layout";
import { getBookingRateSummary } from "@/lib/booking-display";
import { addDays, day, guestName, isBlocking, money, roomName, today, type FormSpec } from "./pms-data";
import { Badge, Empty } from "./pms-ui";

type CalendarView = "auto" | "3" | "7" | "list";
const displayedStatuses = new Set(["reserved", "checked_in", "checked_out"]);

export default function PmsCalendar({ state: s, start, onStartChange, canBook, canSeeMoney, onBooking, onNewBooking, onManageBooking, children }: {
  state: PmsState;
  start: string;
  onStartChange: (date: string) => void;
  canBook: boolean;
  canSeeMoney: boolean;
  onBooking: (id: string) => void;
  onNewBooking: (form: FormSpec) => void;
  onManageBooking: (form: FormSpec) => void;
  children?: ReactNode;
}) {
  const [view, setView] = useState<CalendarView>("auto");
  const [managedId, setManagedId] = useState("");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const days = view === "3" || (view === "auto" && narrow) ? 3 : 7;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const currentDate = today();
  const rooms = s.rooms.filter(room => !room.archived);
  const manageable = s.reservations.filter(r => isBlocking(r));
  const managed = manageable.find(r => r.id === managedId);
  const metadata = (r: Reservation) => {
    const rate = getBookingRateSummary(r);
    return `${rate.nights} ${rate.nights === 1 ? "night" : "nights"}${canSeeMoney ? ` · ${money(rate.nightlyPaisa)}${rate.isAverage ? " avg" : ""}/night` : ""}`;
  };
  const compactMetadata = (r: Reservation) => {
    const rate = getBookingRateSummary(r);
    return `${rate.nights}n${canSeeMoney ? ` · ${money(rate.nightlyPaisa).replace("Rs ", "Rs")}${rate.isAverage ? " avg" : ""}/n` : ""}`;
  };
  const label = (r: Reservation) => `${guestName(s, r)}, ${r.reference}, room ${roomName(s, r)}, check-in ${day(r.arrival)} ${r.arrival.slice(0, 4)}, checkout ${day(r.departure)} ${r.departure.slice(0, 4)}, ${metadata(r)}, ${r.status.replaceAll("_", " ")}, ${r.source}`;

  return <section className="panel calendar-panel">
    <header className="panel-header calendar-toolbar">
      <div><h2>{day(start, true)} – {day(addDays(start, days - 1), true)} {start.slice(0, 4)}</h2><p>Select a free room-night to book</p></div>
      <div className="actions calendar-controls">
        <select className="filter calendar-view-toggle" aria-label="Calendar view" value={view} onChange={e => setView(e.target.value as CalendarView)}>
          <option value="auto">Auto fit</option><option value="3">3 days</option><option value="7">7 days</option><option value="list">Stay list</option>
        </select>
        <div className="actions calendar-date-controls">
          <button className="btn btn-icon" aria-label={`Previous ${days} days`} onClick={() => onStartChange(addDays(start, -days))}><ChevronLeft size={16}/></button>
          <button className="btn btn-small" onClick={() => onStartChange(currentDate)}>Today</button>
          <button className="btn btn-icon" aria-label={`Next ${days} days`} onClick={() => onStartChange(addDays(start, days))}><ChevronRight size={16}/></button>
        </div>
        <input className="filter" type="date" aria-label="Calendar start date" value={start} onChange={e => { if (e.target.value) onStartChange(e.target.value); }}/>
      </div>
    </header>
    {canBook && <div className="calendar-management"><label className="field"><span>Manage a booking</span><select aria-label="Calendar booking to manage" value={managed?.id || ''} onChange={e => setManagedId(e.target.value)}><option value="">Select a guest / booking</option>{manageable.map(r => <option key={r.id} value={r.id}>{guestName(s, r)} · {r.reference} · Room {roomName(s, r)}</option>)}</select></label><div className="actions"><button className="btn btn-small" disabled={!managed} onClick={() => managed && onManageBooking({ kind: 'moveBooking', id: managed.id })}>Move room</button><button className="btn btn-small" disabled={!managed} onClick={() => managed && onManageBooking({ kind: 'extendStay', id: managed.id })}>Extend stay</button></div></div>}
    <div className="calendar" hidden={view === "list"} style={{ "--cal-days": days } as CSSProperties} tabIndex={0} role="region" aria-label="Room booking calendar">
      <div className="calendar-inner">
        <div className="cal-head"><div className="cal-room-head">Room / readiness</div>{dates.map(date => <div className={`cal-day ${date === currentDate ? "today" : ""}`} key={date}>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"))}<strong>{date.slice(-2)}</strong></div>)}</div>
        {rooms.map(room => <div className="cal-row" key={room.id}>
          <div className="cal-room"><strong>Room {room.number}</strong><small>{s.roomTypes.find(type => type.id === room.typeId)?.name} · {room.status === "dirty" ? "Needs cleaning" : room.status === "out_of_service" ? "Out of service" : "Clean"}</small></div>
          {dates.map(date => <button key={date} className={`cal-slot ${date === currentDate ? "today" : ""} ${room.status === "out_of_service" ? "blocked" : ""}`} aria-label={`Reserve room ${room.number} on ${day(date)}`} disabled={room.status === "out_of_service" || !canBook || s.reservations.some(r => r.roomId === room.id && isBlocking(r) && r.arrival <= date && r.departure > date)} onClick={() => onNewBooking({ kind: "booking", roomId: room.id, arrival: date })}/>)}
          {s.reservations.filter(r => r.roomId === room.id && displayedStatuses.has(r.status)).map(r => {
            const layout = getCalendarBarLayout(r.arrival, r.departure, start, days);
            if (!layout) return null;
            return <button key={r.id} className={`cal-booking ${r.status}`} style={{ left: `calc(var(--cal-room-width) + (100% - var(--cal-room-width)) * ${layout.start / days} + 2px)`, width: `calc((100% - var(--cal-room-width)) * ${(layout.end - layout.start) / days} - 4px)` }} onClick={() => onBooking(r.id)} aria-label={label(r)} title={label(r)}><strong>{guestName(s, r)}</strong><small className="calendar-booking-meta">{compactMetadata(r)}</small></button>;
          })}
        </div>)}
      </div>
    </div>
    <div className="calendar-mobile" hidden={view !== "list"}>
      {dates.map(date => {
        const stays = s.reservations.filter(r => displayedStatuses.has(r.status) && r.arrival <= date && r.departure >= date);
        return <section key={date} className="calendar-agenda-day">
          <div className="list-item"><strong>{day(date, true)}</strong>{canBook && <button className="link-button" onClick={() => onNewBooking({ kind: "booking", arrival: date })}>+ Book</button>}</div>
          {stays.length ? stays.map(r => <div className="list-item calendar-agenda-stay" key={r.id}><div><button className="link-button" onClick={() => onBooking(r.id)}>{guestName(s, r)}</button><p>{r.reference} · Room {roomName(s, r)}</p><p>{metadata(r)}</p><p>{r.arrival === date ? "Arrives today" : r.departure === date ? "Checkout today" : "Staying"} · {r.source}</p></div><Badge value={r.status}/></div>) : <p className="calendar-agenda-empty">No stays on this date.</p>}
        </section>;
      })}
    </div>
    {!rooms.length && <Empty title="No rooms yet" detail="Add room types and rooms under settings before booking."/>}
    <footer className="calendar-footer"><div className="legend"><span><i className="legend-dot reserved"/>Reserved</span><span><i className="legend-dot"/>Checked in</span><span><i className="legend-dot maintenance"/>Checked out / unavailable</span></div><span>n = night · Rates per night use confirmed room charges; avg = varying nightly prices. Checkout day can take the next booking.</span></footer>
    {children}
  </section>;
}
