"use client";
import { useEffect, useId, useRef, isValidElement, type ReactNode } from "react";
import { X, Inbox } from "lucide-react";

export function Modal({title,subtitle,children,onClose,wide=false}: {title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);const id=useId();
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>{dialog?.close()}},[]);
  return <dialog ref={ref} aria-labelledby={id} className={`modal ${wide?"wide":""}`} onCancel={(e)=>{e.preventDefault();onClose()}}><header className="modal-header"><div><h2 id={id}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close dialog"><X size={17}/></button></header>{children}</dialog>;
}
export function Field({label,children,hint,full=false}: {label:string;children:ReactNode;hint?:string;full?:boolean}) {return <div className={`field ${full?"full":""}`}>{isValidElement(children)&&children.type==="label"?<><span style={{fontSize:11,fontWeight:600,color:"#52656b"}}>{label}</span>{children}</>:<label><span>{label}</span>{children}</label>}{hint&&<small>{hint}</small>}</div>}
export function Badge({value}: {value:string}) {return <span className={`badge ${value}`}>{value.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}</span>}
export function Empty({title,detail,children}: {title:string;detail:string;children?:ReactNode}) {return <div className="empty"><Inbox size={26} style={{margin:"auto",opacity:.45}}/><h3>{title}</h3><p>{detail}</p>{children&&<div className="actions">{children}</div>}</div>}
export function Avatar({name}: {name:string}) {return <span className="avatar" aria-hidden="true">{name.split(" ").filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"M"}</span>}
