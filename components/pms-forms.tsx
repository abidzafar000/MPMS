"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Info, Save, Plus } from "lucide-react";
import { PERMISSIONS, type PmsState, type PmsAction, type Permission, type PmsResponse } from "@/lib/pms-types";
import { Field, Modal } from "./pms-ui";
import { today, addDays, day, nights, money, quote, balance, cashExpected, cashKinds, isBlocking, roomName, type FormSpec, type Mutate } from "./pms-data";

const titles:Record<FormSpec["kind"],string>={booking:"New reservation",editBooking:"Update stay",extendStay:"Extend stay",moveBooking:"Move room",deleteRoom:"Remove room",deleteRoomType:"Remove room type",guest:"Guest details",payment:"Record a payment",refund:"Record a refund",extra:"Add an extra charge",price:"Change agreed booking price",status:"Change booking status",staff:"Staff account",assignment:"Assign a shift",room:"Room details",roomType:"Room type",rate:"Rate plan",dateRate:"Change date-range pricing",openShift:"Open cashier shift",closeShift:"Close cashier shift",cash:"Record cash movement",settings:"Property settings",wubook:"WuBook configuration",restore:"Restore property backup",property:"Create another property"};
const asPaisa=(value:string)=>Math.round(Number(value)*100);
const localDateTime=(value:string)=>new Date(Date.parse(value)+5*3600000).toISOString().slice(0,16);
const bookingSources=[{value:"Direct",label:"Guest direct"},{value:"Walk-in",label:"Walk-in"},{value:"WhatsApp",label:"WhatsApp"},{value:"Phone call",label:"Phone call"},{value:"Website",label:"Website"},{value:"Booking.com",label:"Booking.com"},{value:"Agoda",label:"Agoda"},{value:"Expedia",label:"Expedia"},{value:"Airbnb",label:"Airbnb"},{value:"Travel agent",label:"Travel agent"},{value:"Company",label:"Company"},{value:"Other",label:"Other"}];

export default function PmsForm({spec,response,mutate,onClose,error,busy}:{spec:FormSpec;response:PmsResponse;mutate:Mutate;onClose:()=>void;error:string;busy:boolean}) {
  const s=response.state!;
  const visibleRoomTypes=s.roomTypes.filter(type=>!type.archived);
  const visibleTypeIds=new Set(visibleRoomTypes.map(type=>type.id));
  const visibleRooms=s.rooms.filter(room=>!room.archived&&visibleTypeIds.has(room.typeId));
  const visiblePlans=s.ratePlans.filter(plan=>visibleTypeIds.has(plan.typeId));
  const booking=s.reservations.find(r=>r.id===spec.id);
  const guest=s.guests.find(g=>g.id===(spec.kind==="guest"?spec.id:booking?.guestId));
  const staff=s.staff.find(x=>x.id===spec.id);
  const assignment=s.shiftAssignments.find(x=>x.id===spec.id);
  const room=s.rooms.find(x=>x.id===spec.id);
  const roomType=s.roomTypes.find(x=>x.id===spec.id);
  const plan=s.ratePlans.find(x=>x.id===spec.id);
  const shift=s.shifts.find(x=>x.id===spec.id);
  const payment=s.transactions.find(x=>x.id===spec.id); const refundable=payment?payment.amountPaisa-s.transactions.filter(t=>t.kind==="refund"&&t.paymentId===payment.id).reduce((a,t)=>a+t.amountPaisa,0):0;
  const [roomId,setRoomId]=useState(spec.kind==="moveBooking"?(spec.roomId||booking?.roomId||""):(booking?.roomId||spec.roomId||""));
  const initialTypeId=booking?.roomTypeId||visibleRooms.find(r=>r.id===spec.roomId)?.typeId||plan?.typeId||"";
  const [typeId,setTypeId]=useState(visibleTypeIds.has(initialTypeId)?initialTypeId:visibleRoomTypes[0]?.id||"");
  const [arrival,setArrival]=useState(booking?.arrival||spec.arrival||today());
  const [departure,setDeparture]=useState(spec.kind==="extendStay"&&booking?addDays(booking.departure,1):booking?.departure||addDays(spec.arrival||today(),1));
  const [planId,setPlanId]=useState(booking?.ratePlanId||""); const [dueDate,setDueDate]=useState(booking?.dueDate||booking?.departure||addDays(spec.arrival||today(),1));
  const [existingGuest,setExistingGuest]=useState("");
  const [payer,setPayer]=useState<string>(spec.payer||booking?.payer||"guest");
  const [additionalAmount,setAdditionalAmount]=useState("");
  const [companyName,setCompanyName]=useState(booking?.companyName||"");
  const [companyAddress,setCompanyAddress]=useState(booking?.companyAddress||"");
  const [role,setRole]=useState(staff?.role||"reception");
  const [count,setCount]=useState("");
  const [backup,setBackup]=useState<PmsState|null>(null);
  const [fileError,setFileError]=useState("");
  const currentBalance=booking?balance(s,booking):null;
  const rates=visiblePlans.filter(p=>p.typeId===typeId&&p.active);
  const moveChoices=visibleRooms.map(candidate=>{
    const conflict=booking&&s.reservations.some(other=>other.id!==booking.id&&other.roomId===candidate.id&&isBlocking(other)&&other.arrival<booking.departure&&other.departure>booking.arrival);
    const reason=candidate.id===booking?.roomId?"Current room":candidate.status==="out_of_service"?"Out of service":conflict?"Booked during this stay":booking?.status==="checked_in"&&candidate.status!=="clean"?"Needs cleaning":"";
    return {room:candidate,typeName:s.roomTypes.find(type=>type.id===candidate.typeId)?.name||"Room",reason};
  });
  const selectedMove=moveChoices.find(choice=>choice.room.id===roomId);
  const extraNights=booking&&departure>booking.departure?nights(booking.departure,departure):0;
  const additionalPaisa=additionalAmount.trim()!==""&&Number.isFinite(Number(additionalAmount))&&Number(additionalAmount)>=0?asPaisa(additionalAmount):null;
  const blockingRoomBookings=s.reservations.filter(reservation=>isBlocking(reservation)&&(spec.kind==="deleteRoom"?reservation.roomId===spec.id:reservation.roomTypeId===spec.id));
  const remainingTypeRooms=visibleRooms.filter(candidate=>candidate.typeId===spec.id);
  const remainingTypePlans=visiblePlans.filter(candidate=>candidate.typeId===spec.id&&candidate.active);
  const submitBlocked=spec.kind==="editBooking"?(!booking||!isBlocking(booking)):spec.kind==="moveBooking"?(!booking||!isBlocking(booking)||!selectedMove||!!selectedMove.reason):spec.kind==="extendStay"?(!booking||!isBlocking(booking)||departure<=booking.departure||additionalPaisa===null):spec.kind==="deleteRoom"?(!room||!!room.archived||blockingRoomBookings.length>0):spec.kind==="deleteRoomType"?(!roomType||!!roomType.archived||blockingRoomBookings.length>0||remainingTypeRooms.length>0||remainingTypePlans.length>0):false;
  const member=s.staff.find(x=>x.userId===response.user.userId||x.email.toLowerCase()===response.user.email.toLowerCase());
  const activeShift=s.shifts.find(x=>x.staffId===member?.id&&!x.closedAt);
  const footer=(label="Save changes")=><footer className="modal-footer"><button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={`btn ${spec.kind==="deleteRoom"||spec.kind==="deleteRoomType"?"btn-danger":"btn-primary"}`} type="submit" disabled={busy||submitBlocked||(spec.kind==="restore"&&!backup)}>{busy?<span className="spinner" style={{width:13,height:13}}/>:<Save size={14}/>} {busy?"Saving…":label}</button></footer>;
  const note=(text:string,warning=false)=><div className={`notice ${warning?"warning":""}`}><Info size={16}/><span>{text}</span></div>;
  const amount=(label:string,name:string,defaultPaisa=0,required=true)=> <Field label={label}><input name={name} type="number" min={required ? 0.01 : 0} step="0.01" defaultValue={defaultPaisa?defaultPaisa/100:undefined} placeholder="0.00" required={required}/></Field>;
  const notes=(label="Notes",value="",required=false)=> <Field label={label} full><textarea name="notes" defaultValue={value} required={required} maxLength={2000} placeholder={required?"Explain this action":"Optional notes"}/></Field>;
  const roomTypes=<>{visibleRoomTypes.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</>;
  const methods=<><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="ota">OTA remittance</option></>;
  const activeStaff=s.staff.filter(x=>x.active);
  const notify=async(action:PmsAction,payload:unknown,message?:string)=>{if(await mutate(action,payload,message))onClose()};

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);const v=(key:string)=>String(f.get(key)||"");
    const id=spec.id;const notes=v("notes");
    switch(spec.kind){
      case "booking":return notify("createReservation",{...(existingGuest?{guestId:existingGuest}:{guest:{name:v("guestName"),phone:v("phone"),document:v("document"),notes:""}}),...(roomId?{roomId}:{roomTypeId:typeId}),arrival,departure,...(planId?{ratePlanId:planId}:{roomTotalPaisa:asPaisa(v("roomTotal"))}),source:v("source"),sourceReference:v("sourceReference"),payer,...(payer==="company"?{companyName,companyAddress}:{}),dueDate:v("dueDate")||departure,notes},"Reservation created");
      case "editBooking":{
        if(booking&&departure>booking.departure){setFileError("Use Extend stay to add nights and confirm the additional room charge.");return}
        return notify("updateReservation",{id,roomId:roomId||null,roomTypeId:typeId,arrival,departure,dueDate:v("dueDate"),notes,...(booking?.payer==="company"?{companyName,companyAddress}:{})},"Stay updated; agreed price preserved");
      }
      case "extendStay":{
        if(!booking||!isBlocking(booking)||departure<=booking.departure||additionalPaisa===null){setFileError("Choose a later checkout date and enter the agreed additional room charge, including 0 for a complimentary extension.");return}
        return notify("extendReservation",{id,departure,additionalPaisa,reason:v("reason")},"Stay extended; additional agreed charge added");
      }
      case "moveBooking":{
        if(!booking||!selectedMove||selectedMove.reason){setFileError("Choose a different room available for the full stay.");return}
        return notify("updateReservation",{id,roomId},"Room moved; agreed charges and payments preserved");
      }
      case "deleteRoom":return notify("deleteRoom",{id},"Room removed from booking options; history retained");
      case "deleteRoomType":return notify("deleteRoomType",{id},"Room type removed; history retained");
      case "guest":return notify("saveGuest",{...(id?{id}:{}),name:v("name"),phone:v("phone"),document:v("document"),notes},"Guest details saved");
      case "payment":return notify("recordPayment",{reservationId:id,amountPaisa:asPaisa(v("amount")),method:v("method"),payer,notes},"Payment saved and receipt issued");
      case "refund":return notify("recordRefund",{paymentId:id,amountPaisa:asPaisa(v("amount")),method:v("method"),notes},"Refund recorded");
      case "extra":return notify("addExtra",{id,description:v("description"),amountPaisa:asPaisa(v("amount"))},"Extra charge added");
      case "price":return notify("setReservationPrice",{id,amountPaisa:asPaisa(v("amount")),reason:v("reason")},"Price change saved in history");
      case "status":return notify("setReservationStatus",{id,status:spec.status||v("status"),reason:v("reason")},"Booking status updated");
      case "staff":return notify("saveStaff",{...(id?{id}:{}),name:v("name"),email:v("email"),role,active:f.get("active")==="on",permissions:f.getAll("permissions")},"Staff access saved");
      case "assignment":return notify("saveShiftAssignment",{...(id?{id}:{}),staffId:v("staffId"),startAt:new Date(v("startAt")+":00+05:00").toISOString(),endAt:new Date(v("endAt")+":00+05:00").toISOString(),notes},"Shift assignment saved");
      case "room":return notify("saveRoom",{...(id?{id}:{}),number:v("number"),typeId:v("typeId"),status:v("status"),notes},"Room saved");
      case "roomType":return notify("saveRoomType",{...(id?{id}:{}),name:v("name")},"Room type saved");
      case "rate":return notify("saveRatePlan",{...(id?{id}:{}),name:v("name"),typeId:v("typeId"),basePaisa:asPaisa(v("base")),weekendPaisa:v("weekend")?asPaisa(v("weekend")):null,weekendDays:f.getAll("weekendDays").map(Number),overrides:plan?.overrides||{},active:f.get("active")==="on"},"Rate plan saved; confirmed bookings unchanged");
      case "dateRate":{const selected=s.ratePlans.find(p=>p.id===v("ratePlanId"));if(!selected)return;const overrides={...selected.overrides};const start=v("from"),end=v("to");if(end<start){setFileError("End date must be on or after start date.");return}if((Date.parse(end)-Date.parse(start))/86400000>365){setFileError("Choose a date range of up to 366 days.");return}for(let d=start;d<=end;d=addDays(d,1)){if(f.get("clear")==="on")delete overrides[d];else overrides[d]=asPaisa(v("amount"))}return notify("saveRatePlan",{...selected,overrides},"Date-range pricing saved; confirmed bookings unchanged")}
      case "openShift":return notify("openShift",{openingPaisa:asPaisa(v("opening")),notes},"Cashier shift opened");
      case "closeShift":return notify("closeShift",{shiftId:id,countedPaisa:asPaisa(v("counted")),notes},"Shift closed; count and handover saved");
      case "cash":return notify("cashMovement",{kind:v("kind"),amountPaisa:asPaisa(v("amount")),notes},"Cash movement recorded");
      case "settings":return notify("saveSettings",{name:v("name"),city:v("city"),checkin:v("checkin"),checkout:v("checkout")},"Property settings saved");
      case "wubook":return notify("saveWubook",{product:v("product"),propertyCode:v("propertyCode"),roomMappings:visibleRoomTypes.map(x=>({localId:x.id,remoteId:v("room:"+x.id)})).filter(x=>x.remoteId),rateMappings:visiblePlans.map(x=>({localId:x.id,remoteId:v("rate:"+x.id)})).filter(x=>x.remoteId),note:notes},"Mapping saved. Live synchronization remains disconnected.");
      case "restore":return notify("restoreBackup",{backup,reason:v("reason")},"Backup restored");
      case "property":return notify("createProperty",{name:v("name"),city:v("city"),seedDemo:f.get("seedDemo")==="on"},"Property created");
    }
  }

  let fields:ReactNode;
  switch(spec.kind){
    case "booking":case "editBooking":fields=<>
      {spec.kind==="editBooking"&&note(`The agreed room charge stays ${money(booking?.roomTotalPaisa||0)} when correcting this stay. Use Extend stay to add nights and agree an additional charge.`)}
      {spec.kind==="booking"&&<>
        <p className="form-section">Guest information</p>
        <div className="form-grid">
          <Field label="Guest" full><select value={existingGuest} onChange={e=>setExistingGuest(e.target.value)}><option value="">New guest</option>{s.guests.map(g=><option key={g.id} value={g.id}>{g.name} · {g.phone||"No phone"}</option>)}</select></Field>
          {!existingGuest&&<><Field label="Full name"><input name="guestName" placeholder="Guest name" maxLength={120} required/></Field><Field label="Phone number"><input name="phone" type="tel" placeholder="03xx xxxxxxx"/></Field><Field label="CNIC / passport (optional)" full><input name="document" placeholder="Document reference"/></Field></>}
        </div>
      </>}
      <p className="form-section">Stay details</p>
      <div className="form-grid">
        <Field label="Room type"><select value={typeId} onChange={e=>{setTypeId(e.target.value);setRoomId("");setPlanId("")}} required>{roomTypes}</select></Field>
        <Field label="Room assignment"><select value={roomId} onChange={e=>setRoomId(e.target.value)}><option value="">Assign later</option>{visibleRooms.filter(candidate=>candidate.typeId===typeId&&(candidate.status!=="out_of_service"||candidate.id===booking?.roomId)).map(candidate=><option key={candidate.id} value={candidate.id}>Room {candidate.number} · {candidate.status.replaceAll("_"," ")}</option>)}</select></Field>
        <Field label="Arrival"><input type="date" value={arrival} max={spec.kind==="editBooking"&&booking?addDays(booking.departure,-1):undefined} onChange={e=>setArrival(e.target.value)} required/></Field>
        <Field label="Departure" hint={spec.kind==="editBooking"?"For a later checkout, use Extend stay.":undefined}><input type="date" value={departure} min={arrival?addDays(arrival,1):undefined} max={spec.kind==="editBooking"?booking?.departure:undefined} onChange={e=>{if(dueDate===departure)setDueDate(e.target.value);setDeparture(e.target.value)}} required/></Field>
        <Field label="Payment due date"><input name="dueDate" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/></Field>
        {spec.kind==="booking"&&<Field label="Responsible room payer"><select value={payer} onChange={e=>setPayer(e.target.value)}><option value="guest">Guest</option><option value="ota">OTA settlement</option><option value="company">Company account</option></select></Field>}
        {payer==="company"&&<><Field label="Company name" full><input name="companyName" value={companyName} onChange={e=>setCompanyName(e.target.value)} required maxLength={120} placeholder="Company responsible for room charges"/></Field><Field label="Company billing address (optional)" full><textarea name="companyAddress" value={companyAddress} onChange={e=>setCompanyAddress(e.target.value)} maxLength={2000}/></Field></>}
        {spec.kind==="booking"&&<>
          <Field label="Booking source"><select name="source" defaultValue="Direct" required>{bookingSources.map(source=><option key={source.value} value={source.value}>{source.label}</option>)}</select></Field>
          <Field label="Source / OTA reference (optional)"><input name="sourceReference" placeholder="External booking number, if available"/></Field>
          <Field label="Rate plan"><select value={planId} onChange={e=>setPlanId(e.target.value)}><option value="">Agreed amount / OTA price</option>{rates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field>
          {!planId&&<Field label="Agreed room total (PKR)"><input name="roomTotal" type="number" min="0" step="0.01" required placeholder="0.00"/></Field>}
        </>}
        {notes("Booking notes",booking?.notes)}
      </div>
      {spec.kind==="booking"&&planId&&<div className="form-price"><span>Room total · {arrival&&departure&&departure>arrival?nights(arrival,departure):0} nights<br/><small className="muted">Prices saved with this booking</small></span><strong>{money(arrival&&departure&&departure>arrival?quote(s,planId,arrival,departure):0)}</strong></div>}
      {spec.kind==="booking"&&<p className="text-small muted">A booking number is generated when you save. The booking details will open so you can copy it for the guest.</p>}
    </>;break;
    case "extendStay":fields=booking&&isBlocking(booking)?<>
      {note("Choose the new checkout date and enter the additional room charge agreed for the extra nights. Existing nightly charges and receipts are retained.")}
      <div className="form-grid">
        <Field label="Current checkout"><input readOnly value={day(booking.departure,true)+" "+booking.departure.slice(0,4)}/></Field>
        <Field label="New checkout"><input type="date" value={departure} min={addDays(booking.departure,1)} max={addDays(booking.arrival,366)} onChange={e=>setDeparture(e.target.value)} required/></Field>
        <Field label="Additional agreed room charge (PKR)" hint="This amount covers only the added nights. Enter 0 for a complimentary extension." full><input name="additionalAmount" type="number" min="0" max="1000000000" step="0.01" value={additionalAmount} onChange={e=>setAdditionalAmount(e.target.value)} required placeholder="Enter the agreed additional amount"/></Field>
        <Field label="Extension note (optional)" full><textarea name="reason" maxLength={2000} placeholder="Agreement or handover note"/></Field>
      </div>
      <div style={{marginTop:18}} aria-live="polite">
        <div className="summary-line"><span>Existing room charge</span><strong>{money(booking.roomTotalPaisa)}</strong></div>
        <div className="summary-line"><span>Additional {extraNights} {extraNights===1?"night":"nights"}</span><strong>{additionalPaisa===null?"Enter amount":money(additionalPaisa)}</strong></div>
        <div className="summary-line total"><span>New agreed room total</span><strong>{additionalPaisa===null?"—":money(booking.roomTotalPaisa+additionalPaisa)}</strong></div>
      </div>
      <p className="text-small muted">Availability is checked for the longer stay when you save. This adds room charges without recording a payment.</p>
    </>:note("Only an active reservation can be moved or extended.",true);break;
    case "moveBooking":fields=booking&&isBlocking(booking)?<>
      {note(`Move this booking to a different room for the full stay, ${day(booking.arrival,true)} to ${day(booking.departure,true)}. Agreed charges and existing payments are preserved.${booking.status==="checked_in"?" A checked-in guest needs a clean destination room; the vacated room will need cleaning.":""}`)}
      <div className="form-grid">
        <Field label="Current room" full><input value={roomName(s,booking)} readOnly/></Field>
        <Field label="Destination room" hint="All active room types are shown. Conflicts and unavailable rooms cannot be selected." full><select value={roomId} onChange={e=>setRoomId(e.target.value)} required><option value="">Choose another room</option>{moveChoices.map(choice=><option key={choice.room.id} value={choice.room.id} disabled={!!choice.reason}>Room {choice.room.number} · {choice.typeName} · {choice.reason||"Available for this stay"}</option>)}</select></Field>
      </div>
      {moveChoices.every(choice=>!!choice.reason)&&note("No other eligible room is currently available for this entire stay.",true)}
      <p className="text-small muted" style={{marginTop:16}}>The latest room availability is checked again when you save.</p>
    </>:note("Only an active reservation can be moved or extended.",true);break;
    case "deleteRoom":case "deleteRoomType":fields=<>
      {note(`Remove ${spec.kind==="deleteRoom"?"room "+(room?.number||""):"room type "+(roomType?.name||"")} from active booking options? This is a recoverable archive. Past bookings, charges, payments and activity remain linked to their original records.`,true)}
      {blockingRoomBookings.length>0&&note(`${blockingRoomBookings.length} active bookings still use this ${spec.kind==="deleteRoom"?"room":"type"}. Move or resolve those bookings first.`,true)}
      {spec.kind==="deleteRoomType"&&remainingTypeRooms.length>0&&note(`Remove this type's ${remainingTypeRooms.length} active rooms first. Rooms are not removed automatically.`,true)}
      {spec.kind==="deleteRoomType"&&remainingTypePlans.length>0&&note(`Deactivate this type's ${remainingTypePlans.length} active rate plans before removing the type.`,true)}
      <label className="checkbox"><input type="checkbox" required/>I understand this removes the {spec.kind==="deleteRoom"?"room":"room type"} from active use and keeps its history.</label>
    </>;break;
    case "guest":fields=<div className="form-grid"><Field label="Guest name"><input name="name" defaultValue={guest?.name} required maxLength={120}/></Field><Field label="Phone"><input name="phone" type="tel" defaultValue={guest?.phone}/></Field><Field label="CNIC / passport (optional)" full><input name="document" defaultValue={guest?.document}/></Field>{notes("Guest notes",guest?.notes)}</div>;break;
    case "payment":fields=<>{note(activeShift?"The receipt is attributed to your open cashier shift. OTA remittances are recorded separately from reception cash.":"Open your cashier shift before recording this payment.",!activeShift)}<div className="form-grid">{amount("Amount received (PKR)","amount",currentBalance?.[payer==="guest"?"guest":payer==="ota"?"ota":"company"]||0)}<Field label="Payment method"><select name="method" defaultValue={payer==="ota"?"ota":"cash"}>{methods}</select></Field><Field label="Payer" full><select value={payer} onChange={e=>setPayer(e.target.value)}><option value="guest">Guest · {money(currentBalance?.guest||0)} due</option><option value="ota">OTA · {money(currentBalance?.ota||0)} due</option><option value="company">Company · {money(currentBalance?.company||0)} due</option></select></Field>{notes("Reference / notes")}</div></>;break;
    case "refund":fields=<>{note(`Original receipt: ${payment?.receipt}. The original payment stays in the history.`,true)}<div className="form-grid">{amount("Refund amount (PKR)","amount",refundable)}<Field label="Refund method"><select name="method" defaultValue={payment?.method}><option value={payment?.method}>{payment?.method?.toUpperCase()} · original method</option></select></Field>{notes("Refund reason", "",true)}</div></>;break;
    case "extra":fields=<div className="form-grid"><Field label="Description" full><input name="description" placeholder="Laundry, extra bed, room service…" maxLength={120} required/></Field>{amount("Charge (PKR)","amount")}</div>;break;
    case "price":fields=<>{note("This updates only this booking's agreed room charge. The previous amount, your identity and the reason remain in history.",true)}<div className="form-grid">{<Field label="New agreed room total (PKR)"><input name="amount" type="number" min="0" step="0.01" required defaultValue={(booking?.roomTotalPaisa||0)/100}/></Field>}<Field label="Reason" full><textarea name="reason" required maxLength={120} placeholder="Why is the agreed amount changing?"/></Field></div></>;break;
    case "status":fields=<>{spec.status==="checked_in"&&note("Check-in requires an assigned, clean room. Use Move room to assign an eligible room first.")}{spec.status==="checked_out"&&note("Checkout marks the room as needing cleaning. Outstanding guest, OTA or company amounts remain due after checkout and stay visible in Missed payments.")}{spec.status==="checked_out"&&currentBalance&&currentBalance.due>0&&(response.permissions.includes("payments")||response.permissions.includes("reports"))&&note(`This checkout has ${money(currentBalance.due)} outstanding. The unpaid balance is retained for follow-up.`,true)}{["cancelled","no_show"].includes(spec.status||"")&&note("Booking and payment history remain. Process any required refund separately.",true)}<div className="form-grid"><Field label="New status" full><select name="status" defaultValue={spec.status||booking?.status} disabled={!!spec.status}>{["reserved","checked_in","checked_out","cancelled","no_show"].map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></Field><Field label="Reason / note" full><textarea name="reason" required={["cancelled","no_show"].includes(spec.status||"")} placeholder="Handover or change reason"/></Field></div></>;break;
    case "staff":fields=<>{note("Access is matched to this email when the person signs in with ChatGPT. Adding an account does not send an invitation email.")}<div className="form-grid"><Field label="Full name"><input name="name" defaultValue={staff?.name} required maxLength={120}/></Field><Field label="Sign-in email"><input name="email" type="email" defaultValue={staff?.email} required/></Field><Field label="Role"><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="reception">Reception</option><option value="manager">Manager</option></select></Field><Field label="Account status"><label className="checkbox"><input name="active" type="checkbox" defaultChecked={staff?.active??true}/>Active account</label></Field></div><p className="form-section">Allowed actions</p><div className="permission-grid">{PERMISSIONS.filter(p=>p!=="export").map(p=><label className="checkbox" key={p}><input type="checkbox" name="permissions" value={p} defaultChecked={(staff?.permissions||(role==="manager"?PERMISSIONS.filter(p=>!["staff","restore"].includes(p)):["bookings","guests","payments","rooms","shifts"] as Permission[])).includes(p)}/>{p.charAt(0).toUpperCase()+p.slice(1)}</label>)}</div></>;break;
    case "assignment":fields=<div className="form-grid"><Field label="Staff member" full><select name="staffId" defaultValue={assignment?.staffId||spec.id} required>{activeStaff.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Starts (Pakistan time)"><input name="startAt" type="datetime-local" defaultValue={assignment?localDateTime(assignment.startAt):today()+"T09:00"} required/></Field><Field label="Ends (Pakistan time)"><input name="endAt" type="datetime-local" defaultValue={assignment?localDateTime(assignment.endAt):today()+"T17:00"} required/></Field>{notes("Assignment notes",assignment?.notes)}</div>;break;
    case "room":fields=<div className="form-grid"><Field label="Room number"><input name="number" defaultValue={room?.number} maxLength={120} required/></Field><Field label="Room type"><select name="typeId" defaultValue={room?.typeId||visibleRoomTypes[0]?.id} required>{roomTypes}</select></Field><Field label="Readiness" full><select name="status" defaultValue={room?.status||"clean"}><option value="clean">Clean / ready</option><option value="dirty">Needs cleaning</option><option value="out_of_service">Out of service</option></select></Field>{notes("Room notes",room?.notes)}</div>;break;
    case "roomType":fields=<Field label="Room type name"><input name="name" defaultValue={roomType?.name} placeholder="Standard, Deluxe, Family…" required maxLength={120}/></Field>;break;
    case "rate":fields=<>{note("New bookings use the current plan. Editing it never changes existing confirmed booking amounts.")}<div className="form-grid"><Field label="Plan name"><input name="name" defaultValue={plan?.name} maxLength={120} required placeholder="Standard flexible"/></Field><Field label="Room type"><select name="typeId" defaultValue={plan?.typeId||visibleRoomTypes[0]?.id} required>{roomTypes}</select></Field>{amount("Base price per night (PKR)","base",plan?.basePaisa)}{amount("Weekend price (PKR, optional)","weekend",plan?.weekendPaisa||0,false)}<Field label="Plan status" full><label className="checkbox"><input type="checkbox" name="active" defaultChecked={plan?.active??true}/>Available for new bookings</label></Field></div><p className="form-section">Weekend days</p><div className="actions">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><label className="checkbox" key={d}><input type="checkbox" name="weekendDays" value={i} defaultChecked={(plan?.weekendDays||[5,6]).includes(i)}/>{d}</label>)}</div></>;break;
    case "dateRate":fields=<>{note("Date overrides take precedence over weekend and base prices. Existing booking prices stay unchanged. Saving here does not publish rates to WuBook.")}<div className="form-grid"><Field label="Rate plan" full><select name="ratePlanId" defaultValue={spec.id} required>{visiblePlans.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="From (inclusive)"><input type="date" name="from" defaultValue={today()} required/></Field><Field label="To (inclusive)"><input type="date" name="to" defaultValue={addDays(today(),6)} required/></Field>{amount("Price per night (PKR)","amount",plan?.basePaisa,false)}<Field label="Reset to plan prices"><label className="checkbox"><input type="checkbox" name="clear"/>Remove overrides in this range</label></Field></div></>;break;
    case "openShift":fields=<>{note("Count the cash already in your drawer. Collections made during this shift are tracked separately.")}<div className="form-grid">{<Field label="Opening counted cash (PKR)"><input name="opening" type="number" min="0" step="0.01" required defaultValue="0"/></Field>}{notes("Opening / handover notes")}</div></>;break;
    case "closeShift":fields=<>{note("Count cash before closing. Record safe transfers or withdrawals separately before the count; they must not be deducted twice.")}<div className="shift-total"><span>Expected drawer cash</span><strong>{money(shift?cashExpected(s,shift):0)}</strong></div><div className="form-grid"><Field label="Physically counted cash (PKR)"><input name="counted" type="number" min="0" step="0.01" value={count} onChange={e=>setCount(e.target.value)} required placeholder="0.00"/></Field><Field label="Difference"><input readOnly value={count?money(asPaisa(count)-(shift?cashExpected(s,shift):0)):"Enter cash count"}/></Field>{notes("Variance explanation / handover","",!!count&&asPaisa(count)!==cashExpected(s,shift!))}</div></>;break;
    case "cash":fields=<>{note("This movement affects your open cashier drawer. The reason and your name stay in its history.")}<div className="form-grid"><Field label="Movement type"><select name="kind">{Object.entries(cashKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>{amount("Cash amount (PKR)","amount")}{notes("Reason / received by", "",true)}</div></>;break;
    case "settings":fields=<div className="form-grid"><Field label="Property name"><input name="name" defaultValue={s.property.name} maxLength={120} required/></Field><Field label="City"><input name="city" defaultValue={s.property.city}/></Field><Field label="Standard check-in"><input name="checkin" type="time" defaultValue={s.property.checkin} required/></Field><Field label="Standard checkout"><input name="checkout" type="time" defaultValue={s.property.checkout} required/></Field></div>;break;
    case "wubook":fields=<>{note("Configuration only. Bookings, availability and prices are not synchronized. Live access and price ownership must be verified before connecting.",true)}<div className="form-grid"><Field label="WuBook product"><select name="product" defaultValue={s.wubook.product}><option value="unknown">Not yet confirmed</option><option value="woodoo">WooDoo / channel manager</option><option value="zak">ZaK</option></select></Field><Field label="WuBook property code"><input name="propertyCode" defaultValue={s.wubook.propertyCode}/></Field></div><p className="form-section">Room-type mapping</p><div className="form-grid">{visibleRoomTypes.map(t=><Field key={t.id} label={t.name+" · external ID"}><input name={"room:"+t.id} defaultValue={s.wubook.roomMappings.find(x=>x.localId===t.id)?.remoteId} placeholder="Remote room-type ID"/></Field>)}</div><p className="form-section">Rate-plan mapping</p><div className="form-grid">{visiblePlans.map(p=><Field key={p.id} label={p.name+" · external ID"}><input name={"rate:"+p.id} defaultValue={s.wubook.rateMappings.find(x=>x.localId===p.id)?.remoteId} placeholder="Remote plan ID"/></Field>)}{notes("Connection / price ownership notes",s.wubook.note)}</div></>;break;
    case "restore":fields=<>{note("Restore replaces this property's operational records. Current staff memberships and audit history are protected. Use a previously saved backup and explain the reason for restoring it.",true)}<div className="form-grid"><Field label="Mehmaan JSON backup" full><input type="file" accept="application/json,.json" required onChange={async e=>{setBackup(null);setFileError("");try{const file=e.target.files?.[0];if(!file)return;if(file.size>10_000_000)throw new Error("Backup is too large (10 MB maximum).");const parsed=JSON.parse(await file.text());const b=parsed.state||parsed;if(b.schemaVersion!==1||!b.property)throw new Error("Choose a valid Mehmaan property backup.");setBackup(b)}catch(e){setFileError(e instanceof Error?e.message:"Could not read backup")}}}/></Field><Field label="Restore reason" full><textarea name="reason" required maxLength={120}/></Field></div></>;break;
    case "property":fields=<div className="form-grid"><Field label="Property name"><input name="name" required maxLength={120} placeholder="Your hotel or guesthouse"/></Field><Field label="City"><input name="city" placeholder="Lahore"/></Field><Field label="Starting data" full><label className="checkbox"><input name="seedDemo" type="checkbox"/>Include a clearly synthetic sample hotel</label></Field></div>;break;
  }
  return <Modal title={titles[spec.kind]} subtitle={booking?booking.reference:undefined} onClose={busy?()=>{}:onClose}><form onSubmit={submit}><div className="modal-content">{(error||fileError)&&<div role="alert" className="form-error">{error||fileError}</div>}{fields}</div>{footer(spec.kind==="booking"?"Create reservation":spec.kind==="extendStay"?"Extend stay":spec.kind==="moveBooking"?"Move room":spec.kind==="deleteRoom"?"Remove room":spec.kind==="deleteRoomType"?"Remove room type":spec.kind==="closeShift"?"Close shift":spec.kind==="restore"?"Restore backup":"Save changes")}</form></Modal>;
}
