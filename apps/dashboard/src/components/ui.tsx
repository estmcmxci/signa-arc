import { useState, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Dialog } from '@base-ui/react/dialog';
import { short } from '../data/format';

export function Badge({state,children}:{state:string;children?:ReactNode}){
  const tone=state==='COMPLIANT'||state==='PERMITTED'||state==='FRESH'||state==='confirmed'?'ok':state==='BREACH'||state==='STALE'?'breach':state==='WAIVED'?'waiver':state==='READ FAILED'?'error':state==='CURE'||state==='HELD'||state==='AGEING'||state==='reverted'?'hold':'neutral';
  const glyph={ok:'●',hold:'▣',breach:'⬡',waiver:'⊘',error:'■',neutral:'○'}[tone];
  return <span className={`badge ${tone}`} role="status"><span aria-hidden="true">{glyph}</span>{children??state}</span>;
}
export function Help({label,children}:{label:string;children:ReactNode}){return <Tooltip.Root><Tooltip.Trigger className="help" aria-label={`About ${label}`}>{label}<span aria-hidden="true"> ⓘ</span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner sideOffset={8}><Tooltip.Popup className="tooltip">{children}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;}
export function Copy({value,label='identifier',full=false}:{value:string;label?:string;full?:boolean}){
  const [message,setMessage]=useState('');const [failed,setFailed]=useState(false);
  return <span className="copy-group"><span className="mono copy-value">{full?value:short(value)}</span><button type="button" className="copy-button" aria-label={`Copy ${label}`} onClick={async()=>{try{await navigator.clipboard.writeText(value);setFailed(false);setMessage(`${label} copied`);}catch{setFailed(true);setMessage(`Copy did not complete. Select the ${label} manually.`);}}}><span aria-hidden="true">{message&&!failed?'✓':'⧉'}</span></button><span role={failed?'alert':'status'} className={failed?'copy-message':'sr-only'}>{message}</span></span>;
}
export function Modal({open,onOpenChange,title,children}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;children:ReactNode}){return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="dialog"><div className="dialog-head"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close dialog">×</Dialog.Close></div><Dialog.Description className="sr-only">Review the information below. Escape closes this dialog.</Dialog.Description>{children}</Dialog.Popup></Dialog.Portal></Dialog.Root>;}
export function Panel({title,kicker,children,id,aside}:{title:string;kicker?:string;children:ReactNode;id?:string;aside?:ReactNode}){return <section className="panel" id={id}><header className="panel-heading"><div>{kicker&&<p className="eyebrow">{kicker}</p>}<h2>{title}</h2></div>{aside}</header>{children}</section>;}
