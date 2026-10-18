"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Printer, Save, Search, Settings, X } from "lucide-react";
import type { Invoice, InvoiceBranding, Payer, Permission, PmsState } from "@/lib/pms-types";
import { buildInvoicePreview, invoiceBillTo, invoiceBranding, invoiceDate, invoiceMoney, savedInvoiceView, type InvoiceView } from "@/lib/invoice-display";
import { Empty, Field, Modal } from "./pms-ui";
import { guestName, type Mutate } from "./pms-data";
import "./pms-invoices.css";

type Props = { state: PmsState; permissions: Permission[]; mutate: Mutate; busy: boolean; error: string; initialReservationId?: string };

export function InvoiceCenter(props: Props) {
  return <InvoiceWorkspace key={`${props.state.property.id}:${props.initialReservationId || "new"}`} {...props}/>;
}
export default InvoiceCenter;

function InvoiceWorkspace({ state, permissions, mutate, busy, error, initialReservationId }: Props) {
  const canIssue = permissions.includes("payments");
  const canView = canIssue || permissions.includes("reports");
  const canBrand = permissions.includes("settings");
  const [query, setQuery] = useState("");
  const [registerQuery, setRegisterQuery] = useState("");
  const [reservationId, setReservationId] = useState(initialReservationId || "");
  const [kind, setKind] = useState<Invoice["kind"]>("invoice");
  const [payer, setPayer] = useState<Payer>(() => state.reservations.find(item => item.id === initialReservationId)?.payer || "guest");
  const [billTo, setBillTo] = useState(() => {
    const booking = state.reservations.find(item => item.id === initialReservationId);
    return booking ? invoiceBillTo(state, booking) : "";
  });
  const [notes, setNotes] = useState("");
  const [showBranding, setShowBranding] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [printError, setPrintError] = useState("");
  const printRoot = useRef<HTMLDivElement>(null);
  const booking = state.reservations.find(item => item.id === reservationId);
  const invoices = useMemo(() => [...(state.invoices || [])].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [state.invoices]);
  const selected = invoices.find(item => item.id === selectedId);
  const filteredBookings = state.reservations.filter(item => [item.reference, guestName(state, item), item.companyName || ""].join(" ").toLowerCase().includes(query.toLowerCase()));
  const register = invoices.filter(item => [item.number, item.bookingReference, item.billTo, item.guestName, item.kind].join(" ").toLowerCase().includes(registerQuery.toLowerCase()));
  const preview = booking && canView ? buildInvoicePreview(state, booking, kind, billTo, notes, payer) : null;

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const finish = () => { document.body.classList.remove("pms-invoice-printing"); setPrinting(null); };
    document.body.classList.add("pms-invoice-printing");
    window.addEventListener("afterprint", finish);
    const timer = window.setTimeout(async () => {
      const images = Array.from(printRoot.current?.querySelectorAll("img") || []);
      await Promise.all(images.map(image => image.decode().catch(() => undefined)));
      if (cancelled) return;
      try { window.print(); } catch { setPrintError("Printing could not open. Please try again from the saved document."); finish(); }
    }, 80);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener("afterprint", finish); document.body.classList.remove("pms-invoice-printing"); };
  }, [printing]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking || busy || !canIssue) return;
    setNotice("");
    if (await mutate("issueInvoice", { reservationId: booking.id, kind, payer, billTo: billTo.trim(), notes: notes.trim() }, kind === "proforma" ? "Pro forma saved" : "Invoice issued")) {
      setNotice(`${kind === "proforma" ? "Pro forma" : "Invoice"} saved in the register below. Open its saved document to print or save as PDF.`);
    }
  }

  if (!canView && !canBrand) return <Empty title="Invoice access is unavailable" detail="Ask the property owner to assign the appropriate payment or reporting permission."/>;

  return <div className="invoice-center">
    <section className="panel">
      <header className="panel-header"><div><h2>Invoices & pro formas</h2><p>Booking charges, issued documents and your property letterhead</p></div>{canBrand && <button className="btn btn-small" type="button" onClick={() => setShowBranding(value => !value)}><Settings size={14}/>{showBranding ? "Close branding" : "Invoice branding"}</button>}</header>
      <div className="panel-body"><p className="text-small muted">Issued documents preserve the amounts and branding at the time of issue. Later booking or payment changes do not rewrite an issued document.</p></div>
    </section>
    {canBrand && showBranding && <BrandingEditor state={state} mutate={mutate} busy={busy}/>}
    {(error || printError) && <div className="form-error" role="alert">{error || printError}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {canView && <>
      {canIssue && <div className="invoice-compose-layout">
        <section className="panel invoice-compose"><header className="panel-header"><div><h2>Prepare a document</h2><p>Preview current charges before saving an issued snapshot</p></div></header>
          <form className="panel-body invoice-form" onSubmit={issue}>
            <Field label="Find a booking"><div className="invoice-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Booking number, guest or company" aria-label="Find a booking for invoice"/></div></Field>
            <Field label="Booking"><select value={reservationId} required onChange={event => { const next = state.reservations.find(item => item.id === event.target.value); setReservationId(event.target.value); setPayer(next?.payer || "guest"); setBillTo(next ? invoiceBillTo(state, next) : ""); setNotes(""); setNotice(""); }}><option value="">Select a booking</option>{booking && !filteredBookings.some(item => item.id === booking.id) && <option value={booking.id}>{booking.reference} · {guestName(state, booking)}</option>}{filteredBookings.map(item => <option key={item.id} value={item.id}>{item.reference} · {guestName(state, item)}{item.companyName ? ` · ${item.companyName}` : ""}</option>)}</select></Field>
            {!filteredBookings.length && <p className="text-small muted">No bookings match this search.</p>}
            <Field label="Document type"><select value={kind} onChange={event => setKind(event.target.value as Invoice["kind"])}><option value="invoice">Invoice</option><option value="proforma">Pro forma</option></select></Field>
            <Field label="Bill payer account"><select value={payer} onChange={event => { const account = event.target.value as Payer; setPayer(account); setBillTo(booking ? invoiceBillTo(state, booking, account) : ""); setNotice(""); }}><option value="guest">Guest</option><option value="company">Company</option><option value="ota">OTA settlement</option></select></Field>
            <Field label="Bill to"><textarea value={billTo} onChange={event => setBillTo(event.target.value)} required maxLength={2400} rows={3} placeholder="Guest or company name and address"/></Field>
            <Field label="Document notes (optional)"><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={3} placeholder="Notes to include on this document"/></Field>
            {preview && <div className="invoice-amount-preview"><span>Current total<strong>{invoiceMoney(preview.totalPaisa)}</strong></span><span>Paid less refunds<strong>{invoiceMoney(preview.paidPaisa)}</strong></span><span>Balance<strong>{invoiceMoney(preview.balancePaisa)}</strong></span></div>}
            <p className="text-small muted">Only the selected payer's charges and receipts are included. Guest extras stay on the guest account. The server calculates and numbers the saved document; a pro forma does not record a payment.</p>
            {preview && !preview.lineItems.length && <p className="notice">This payer account has no charges on the selected booking.</p>}
            <button className="btn btn-primary" type="submit" disabled={!booking || !preview?.lineItems.length || busy}><Save size={14}/>{busy ? "Saving…" : kind === "proforma" ? "Save pro forma" : "Issue invoice"}</button>
          </form>
        </section>
        <section className="panel invoice-preview-panel"><header className="panel-header"><h2>Preview</h2><span className="mini-tag">Draft · not issued</span></header><div className="invoice-preview-scroll">{preview ? <InvoiceDocument document={preview}/> : <Empty title="Choose a booking" detail="The preview will show its actual room charges, extras and payment balance."/>}</div></section>
      </div>}
      <section className="panel"><header className="panel-header"><div><h2>Issued document register</h2><p>{invoices.length} saved {invoices.length === 1 ? "document" : "documents"}</p></div><label className="search"><Search size={15}/><input value={registerQuery} onChange={event => setRegisterQuery(event.target.value)} placeholder="Number, booking or bill to…" aria-label="Search issued invoices"/></label></header>
        {!register.length ? <Empty title={invoices.length ? "No matching documents" : "No issued documents yet"} detail={invoices.length ? "Try another document number or guest name." : "Choose a booking above and issue an invoice or pro forma."}/> : <div className="table-wrap"><table><thead><tr><th>Number / type</th><th>Booking / bill to</th><th>Issued</th><th>Total</th><th>Balance at issue</th><th>Document</th></tr></thead><tbody>{register.map(item => <tr key={item.id}><td><strong className="cell-title">{item.number}</strong><span className="cell-meta">{item.kind === "proforma" ? "Pro forma" : "Invoice"}</span></td><td><span className="cell-title">{item.bookingReference}</span><span className="cell-meta">{item.billTo.split("\n")[0]}</span></td><td>{invoiceDate(item.issuedAt)}</td><td className="money">{invoiceMoney(item.totalPaisa)}</td><td className="money">{invoiceMoney(item.balancePaisa)}</td><td><button className="link-button" type="button" onClick={() => setSelectedId(item.id)}>Open document</button></td></tr>)}</tbody></table></div>}
      </section>
    </>}
    {selected && canView && <Modal title={selected.kind === "proforma" ? "Saved pro forma" : "Issued invoice"} subtitle={selected.number} onClose={() => setSelectedId(null)} wide><div className="modal-content invoice-saved-view"><p className="notice">Saved snapshot from {invoiceDate(selected.issuedAt)}. Amounts and branding below are preserved as issued.</p><div className="invoice-preview-scroll"><InvoiceDocument document={savedInvoiceView(state, selected)}/></div></div><footer className="modal-footer"><button className="btn" type="button" onClick={() => setSelectedId(null)}>Close</button><button className="btn btn-primary" type="button" disabled={!!printing} onClick={() => { setPrintError(""); setPrinting(selected); }}><Printer size={15}/>Print / Save as PDF</button></footer></Modal>}
    {printing && typeof document !== "undefined" && createPortal(<div className={`invoice-print-root ${printing.branding.letterheadAssetId ? "invoice-print-letterhead" : ""}`} ref={printRoot}><style>{`@media print { @page { size: A4; margin: ${printing.branding.letterheadAssetId ? "42mm 14mm 28mm" : "14mm"}; } }`}</style><InvoiceDocument document={savedInvoiceView(state, printing)}/></div>, document.body)}
  </div>;
}

function InvoiceDocument({ document: invoice }: { document: InvoiceView }) {
  const branding = invoice.branding;
  return <article className={`invoice-document ${branding.letterheadDataUrl ? "has-letterhead" : ""}`} aria-label={`${invoice.draft ? "Draft " : ""}${invoice.kind === "proforma" ? "pro forma" : "invoice"} document`}>
    {branding.letterheadDataUrl && <img className="invoice-letterhead" src={branding.letterheadDataUrl} alt="Property letterhead"/>}
    <div className="invoice-document-content">
      <header className="invoice-document-header"><div className="invoice-property-brand">{branding.logoDataUrl && <img className="invoice-logo" src={branding.logoDataUrl} alt={`${branding.legalName} logo`}/>}<h2>{branding.legalName}</h2>{branding.address && <p className="invoice-preserve-lines">{branding.address}</p>}{(branding.phone || branding.email) && <p>{[branding.phone, branding.email].filter(Boolean).join(" · ")}</p>}{branding.registrationNumber && <p>Registration / reference: {branding.registrationNumber}</p>}</div><div className="invoice-document-title"><h1>{invoice.kind === "proforma" ? "PRO FORMA" : "INVOICE"}</h1><strong>{invoice.number || "Number assigned on issue"}</strong><p>{invoice.draft ? "DRAFT · NOT ISSUED" : `Issued ${invoiceDate(invoice.issuedAt)}`}</p>{invoice.kind === "proforma" && <span>Pro forma document · not a payment receipt</span>}</div></header>
      <div className="invoice-address-grid"><section><h3>Bill to</h3><p className="invoice-preserve-lines">{invoice.billTo || "Select a recipient"}</p><p>Billed account: {invoice.payer === "company" ? "Company" : invoice.payer === "ota" ? "OTA settlement" : "Guest"}</p></section><section><h3>Booking details</h3><p><strong>{invoice.bookingReference}</strong> · Room {invoice.roomNumber}</p><p>{invoiceDate(invoice.arrival)} – {invoiceDate(invoice.departure)}</p><p>Guest: {invoice.guestName}{invoice.guestPhone ? ` · ${invoice.guestPhone}` : ""}</p><p>Payment due: {invoiceDate(invoice.dueDate)}</p></section></div>
      <table className="invoice-lines"><thead><tr><th>Description</th><th>Qty</th><th>Rate (PKR)</th><th>Amount (PKR)</th></tr></thead><tbody>{invoice.lineItems.map(item => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{invoiceMoney(item.unitPaisa)}</td><td>{invoiceMoney(item.amountPaisa)}</td></tr>)}</tbody></table>
      <div className="invoice-totals"><div><span>Total charges</span><strong>{invoiceMoney(invoice.totalPaisa)}</strong></div><div><span>Paid less refunds{invoice.draft ? "" : " at issue"}</span><strong>{invoiceMoney(invoice.paidPaisa)}</strong></div><div className="invoice-balance"><span>{invoice.balancePaisa < 0 ? "Credit balance" : "Balance due"}{invoice.draft ? "" : " at issue"}</span><strong>{invoiceMoney(Math.abs(invoice.balancePaisa))}</strong></div></div>
      {invoice.notes && <section className="invoice-document-notes"><h3>Notes</h3><p className="invoice-preserve-lines">{invoice.notes}</p></section>}
      {branding.footer && <footer className="invoice-document-footer invoice-preserve-lines">{branding.footer}</footer>}
    </div>
  </article>;
}

function BrandingEditor({ state, mutate, busy }: { state: PmsState; mutate: Mutate; busy: boolean }) {
  const [branding, setBranding] = useState(() => invoiceBranding(state));
  const [uploading, setUploading] = useState("");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const change = (field: keyof InvoiceBranding, value: string) => { setBranding(current => ({ ...current, [field]: value })); setMessage(""); };
  async function upload(file: File | undefined, field: "logoDataUrl" | "letterheadDataUrl") {
    if (!file) return;
    setUploading(field); setLocalError(""); setMessage("");
    try {
      const image = await prepareBrandImage(file, field === "logoDataUrl" ? "logo" : "letterhead");
      const other = field === "logoDataUrl" ? branding.letterheadDataUrl : branding.logoDataUrl;
      if (image.length + other.length > 200_000) throw new Error("The combined logo and letterhead are too large. Remove one image or use a simpler image.");
      change(field, image);
    } catch (error) { setLocalError(error instanceof Error ? error.message : "This image could not be read."); }
    finally { setUploading(""); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError(""); setMessage("");
    if (await mutate("saveInvoiceBranding", branding, "Invoice branding saved")) setMessage("Branding saved. New documents use these settings; issued documents keep their original branding.");
  }
  return <section className="panel invoice-branding"><header className="panel-header"><div><h2>Property invoice branding</h2><p>Use your own property details, logo and optional full-page letterhead</p></div></header><div className="invoice-branding-layout"><form className="panel-body invoice-form" onSubmit={save}>
    {localError && <p className="form-error" role="alert">{localError}</p>}{message && <p className="notice" role="status">{message}</p>}
    <Field label="Property / legal name"><input value={branding.legalName} onChange={event => change("legalName", event.target.value)} required maxLength={120}/></Field>
    <Field label="Address"><textarea value={branding.address} onChange={event => change("address", event.target.value)} maxLength={2000} rows={3}/></Field>
    <div className="invoice-two-fields"><Field label="Phone"><input value={branding.phone} onChange={event => change("phone", event.target.value)} type="tel" maxLength={100}/></Field><Field label="Email"><input value={branding.email} onChange={event => change("email", event.target.value)} type="email" maxLength={254}/></Field></div>
    <Field label="Registration / reference number (optional)"><input value={branding.registrationNumber} onChange={event => change("registrationNumber", event.target.value)} maxLength={120}/></Field>
    <Field label="Document footer (optional)"><textarea value={branding.footer} onChange={event => change("footer", event.target.value)} maxLength={2000} rows={3}/></Field>
    {(["logoDataUrl", "letterheadDataUrl"] as const).map(field => <div className="invoice-image-field" key={field}><Field label={field === "logoDataUrl" ? "Header logo" : "Full-page letterhead"}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!uploading || busy} onChange={event => { void upload(event.target.files?.[0], field); event.target.value = ""; }}/></Field><p className="text-small muted">PNG, JPEG or WebP, up to 8 MB. Optimized for the document before saving.</p>{branding[field] && <button className="link-button" type="button" disabled={!!uploading || busy} onClick={() => change(field, "")}><X size={12}/> Remove {field === "logoDataUrl" ? "logo" : "letterhead"}</button>}</div>)}
    {uploading && <p role="status" className="text-small muted">Preparing image…</p>}
    <p className="text-small muted">Branding changes apply after saving and only to future issued documents. Full-page letterhead reserves space above and below the document content.</p>
    <button className="btn btn-primary" type="submit" disabled={busy || !!uploading}><Save size={14}/>{busy ? "Saving…" : "Save invoice branding"}</button>
  </form><div className="invoice-branding-preview"><span className="eyebrow">Branding preview</span>{branding.letterheadDataUrl ? <img className="invoice-letterhead-preview" src={branding.letterheadDataUrl} alt="Selected letterhead preview"/> : <div className="invoice-brand-preview-placeholder"><ImagePlus size={25}/><p>No full-page letterhead selected</p></div>}{branding.logoDataUrl && <img className="invoice-logo-preview" src={branding.logoDataUrl} alt="Selected logo preview"/>}<h3>{branding.legalName || state.property.name}</h3><p className="invoice-preserve-lines">{branding.address}</p><p>{[branding.phone, branding.email].filter(Boolean).join(" · ")}</p>{branding.footer && <p className="invoice-branding-footer-preview invoice-preserve-lines">{branding.footer}</p>}<small>Preview of your current form entries. Save to apply.</small></div></div></section>;
}

async function prepareBrandImage(file: File, kind: "logo" | "letterhead"): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const asset = new Image(); asset.onload = () => resolve(asset); asset.onerror = () => reject(new Error("This image could not be decoded. Try another PNG, JPEG or WebP file.")); asset.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error("The image dimensions are too large. Resize the image before uploading.");
    const limit = kind === "logo" ? 45_000 : 145_000;
    let scale = Math.min(1, (kind === "logo" ? 700 : 1200) / image.naturalWidth, (kind === "logo" ? 320 : 1700) / image.naturalHeight);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable in this browser.");
    for (let size = 0; size < 6; size++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.78, 0.64, 0.5]) { const result = canvas.toDataURL("image/webp", quality); if (result.length <= limit) return result; }
      scale *= 0.75;
    }
    throw new Error("The image is too detailed for document branding. Try a simpler or smaller image.");
  } finally { URL.revokeObjectURL(url); }
}
