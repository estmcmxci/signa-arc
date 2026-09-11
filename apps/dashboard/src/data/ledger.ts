import acceptance from '../../../../scenarios/output/arc-facility-evidence.json';
import waiver from '../../../../packages/privy-waiver/evidence/arc-waiver-evidence.json';
import type { Hex } from 'viem';
import type { LedgerRow, Snapshot } from './types';
import { json } from './format';

export const recordedRows:LedgerRow[]=acceptance.steps.map(step=>{
  const s=step as unknown as Record<string,unknown>;
  const vault=s.vault as {balanceBefore:string;balanceAfter:string;principalBefore:string;principalAfter:string}|undefined;
  const row:LedgerRow={id:`recorded:${s.transactionHash}`,source:'recorded',kind:'transaction',action:String(s.action),status:s.actualStatus==='0x1'?'confirmed':'reverted',timestamp:acceptance.generatedAt,hash:String(s.transactionHash) as Hex,block:String(s.blockNumber),actor:String(s.sender),chainId:5042002,facilityId:acceptance.deployment.facilityId,events:s.events as unknown[]};
  if(typeof s.coverageBps==='number')row.coverageBps=s.coverageBps;
  if(typeof s.reasonCode==='string')row.code=s.actualStatus==='0x0'?'DrawNotAllowed(CURE)':s.reasonCode;
  if(typeof s.calldata==='string')row.input=s.calldata;
  if(typeof s.gasUsed==='string')row.gasUsed=s.gasUsed;
  const amount=String(s.action).match(/(?:draw|repay|deposit) (\d+)/)?.[1];if(amount)row.amount=amount;
  if(vault){row.before={balance:vault.balanceBefore,principal:vault.principalBefore};row.after={balance:vault.balanceAfter,principal:vault.principalAfter};}
  return row;
});
recordedRows.push({id:'recorded:waiver',source:'recorded',kind:'transaction',action:'createWaiver',status:'confirmed',timestamp:waiver.generatedAt,blockTimestamp:waiver.broadcast.blockTimestamp,hash:waiver.broadcast.transactionHash as Hex,block:waiver.broadcast.blockNumber,actor:waiver.broadcast.sender,target:waiver.broadcast.to,chainId:5042002,facilityId:acceptance.deployment.facilityId,coverageBps:waiver.readBack.coverage.coverageBps,code:'QUORUM_2_OF_2',events:waiver.events,gasUsed:waiver.broadcast.gasUsed});
export const recordedAt=acceptance.generatedAt;
export const waiverProof={hash:waiver.broadcast.transactionHash,at:waiver.broadcast.blockTimestamp,reason:waiver.proposal.reasonCommitment};
export const JOURNAL_KEY='signa:operations:v1';
export function loadJournal(storage:Pick<Storage,'getItem'>):LedgerRow[]{
  try {const rows:unknown=JSON.parse(storage.getItem(JOURNAL_KEY)??'[]');if(!Array.isArray(rows))return [];
    return rows.filter((r):r is LedgerRow=>r&&typeof r==='object'&&r.source==='local'&&typeof r.id==='string'&&typeof r.action==='string'&&typeof r.timestamp==='string'&&r.chainId===5042002&&typeof r.facilityId==='string'&&['simulation','transaction'].includes(r.kind)&&['held','confirmed','pending','reverted','cancelled','awaiting','declined','unknown'].includes(r.status)&&(!r.hash||/^0x[0-9a-fA-F]{64}$/.test(r.hash))).slice(-500);
  }catch{return [];}
}
export function saveJournal(storage:Pick<Storage,'setItem'>,rows:LedgerRow[]):void{storage.setItem(JOURNAL_KEY,json(rows.slice(-500)));}
export function snapshotSummary(snapshot:Snapshot|undefined):NonNullable<LedgerRow['before']>{
  const result:NonNullable<LedgerRow['before']>={};
  if(snapshot?.balance!==null&&snapshot?.balance!==undefined)result.balance=snapshot.balance.toString();
  if(snapshot?.principal!==null&&snapshot?.principal!==undefined)result.principal=snapshot.principal.toString();
  if(snapshot?.coverage)result.coverageBps=snapshot.coverage.coverageBps;
  if(snapshot?.state!==null&&snapshot?.state!==undefined)result.state=snapshot.state;
  return result;
}
export function downloadLedger(rows:LedgerRow[],format:'json'|'csv'){
  const fields=['timestamp','source','kind','action','status','amount','coverageBps','code','actor','block','hash'] as const;
  const cell=(v:unknown)=>`"${String(v??'').replace(/^[=+@-]/,"'").replaceAll('"','""')}"`;
  const content=format==='json'?json(rows):[fields.join(','),...rows.map(row=>fields.map(field=>cell(row[field])).join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download=`signa-decisions.${format}`;a.click();URL.revokeObjectURL(url);
}
