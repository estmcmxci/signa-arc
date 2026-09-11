import { erc20Abi, isAddressEqual, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
import { arcTestnet } from 'viem/chains';
import { fullVaultAbi, manifest, readSnapshot, rpc, simulate } from './client';
import type { Action, LedgerRow, Snapshot, Verdict } from './types';
import { snapshotSummary } from './ledger';

export type Sender={address:Address;getAddress:()=>Promise<Address>;getChainId:()=>Promise<number>;send:(request:unknown)=>Promise<Hex>};
export type TxServices={snapshot:typeof readSnapshot;simulate:typeof simulate;allowance:(sender:Address)=>Promise<bigint>;wait:(hash:Hex,onReplaced:(hash:Hex,cancelled:boolean)=>void)=>Promise<TransactionReceipt>;receipt:(row:LedgerRow,receipt:TransactionReceipt)=>Promise<LedgerRow>};
export const services:TxServices={
  snapshot:readSnapshot,simulate,
  allowance:sender=>rpc.readContract({address:manifest!.settlementAsset.address,abi:erc20Abi,functionName:'allowance',args:[sender,manifest!.contracts.covenantVault.address]}),
  wait:(hash,onReplaced)=>rpc.waitForTransactionReceipt({hash,timeout:60_000,confirmations:1,onReplaced:r=>onReplaced(r.transaction.hash,r.reason==='cancelled')}),
  receipt:async(row,receipt)=>{
    const updated:LedgerRow={...row,hash:receipt.transactionHash,status:row.status==='cancelled'?'cancelled':receipt.status==='success'?'confirmed':'reverted',block:receipt.blockNumber.toString(),gasUsed:receipt.gasUsed.toString(),feeNative:(receipt.gasUsed*receipt.effectiveGasPrice).toString()};
    try{const block=await rpc.getBlock({blockNumber:receipt.blockNumber});updated.blockTimestamp=new Date(Number(block.timestamp)*1000).toISOString();}catch{/* receipt status remains known */}
    try{const tx=await rpc.getTransaction({hash:receipt.transactionHash});updated.nonce=tx.nonce;updated.input=tx.input;updated.target=tx.to??undefined;}catch{/* hash is sufficient for later reconciliation */}
    updated.events=parseEventLogs({abi:fullVaultAbi,logs:receipt.logs,strict:false}).map(log=>({event:log.eventName,args:log.args}));
    // Receipt-block reads are labelled and never borrowed from a later snapshot.
    try{
      const m=manifest!;const [balance,principal]=await Promise.all([
        rpc.readContract({address:m.settlementAsset.address,abi:erc20Abi,functionName:'balanceOf',args:[m.contracts.covenantVault.address],blockNumber:receipt.blockNumber}),
        rpc.readContract({address:m.contracts.covenantVault.address,abi:fullVaultAbi,functionName:'principal',blockNumber:receipt.blockNumber}),
      ]);updated.after={balance:balance.toString(),principal:String(principal)};
    }catch{/* missing post-state is displayed as unavailable */}
    if(updated.status==='reverted')updated.message='Included in a block; gas was spent and this transaction’s state changes were rolled back. The receipt alone does not establish the revert reason.';
    return updated;
  },
};
export class HeldAction extends Error{constructor(public verdict:Verdict){super(verdict.code);}}
export async function executeAction(action:Exclude<Action,'approve'>,amount:bigint,sender:Sender,record:(row:LedgerRow)=>void,deps:TxServices=services):Promise<LedgerRow[]> {
  const m=manifest;if(!m)throw new Error('No manifest.');const finished:LedgerRow[]=[];
  async function identity(){
    if(await sender.getChainId()!==arcTestnet.id)throw new Error('Switch the wallet to Arc Testnet before signing.');
    if(!isAddressEqual(await sender.getAddress(),sender.address))throw new Error('The wallet account changed. Review the action again.');
    if((action==='draw'||action==='repay')&&!isAddressEqual(sender.address,m!.roles.operator))throw new Error('Connect the facility operator for this action.');
  }
  async function sendOne(step:Action,context:Snapshot){
    await identity();const verdict=await deps.simulate(step,amount,sender.address);
    if(verdict.kind!=='permitted')throw new HeldAction(verdict);
    await identity();
    let row:LedgerRow={id:crypto.randomUUID(),source:'local',kind:'transaction',action:step,amount:amount.toString(),status:'awaiting',timestamp:new Date().toISOString(),actor:sender.address,target:step==='approve'?m!.settlementAsset.address:m!.contracts.covenantVault.address,chainId:5042002,facilityId:m!.facility.id,before:snapshotSummary(context)};
    record(row);
    try{
      const hash=await sender.send(verdict.request);row={...row,hash,status:'pending'};record(row);
      try {
        const receipt=await deps.wait(hash,(replacement,cancelled)=>{row={...row,originalHash:hash,hash:replacement,status:cancelled?'cancelled':'pending'};record(row);});
        row=await deps.receipt(row,receipt);record(row);finished.push(row);
        if(row.status!=='confirmed')throw new Error('The operation did not confirm successfully. Review its receipt before another action.');
      }catch(error){
        if(row.status==='pending'){row={...row,status:'unknown',message:'Confirmation is unresolved. Check the transaction; do not resend automatically.'};record(row);}
        throw error;
      }
    }catch(error){
      if(!row.hash){const code=(error as {code?:number;cause?:{code?:number}})?.code??(error as {cause?:{code?:number}})?.cause?.code;row={...row,status:code===4001?'declined':'unknown',message:code===4001?'The wallet request was declined. No transaction was submitted.':'The wallet did not return a transaction hash. Check wallet activity before retrying.'};record(row);}
      throw error;
    }
  }
  await identity();let snapshot=await deps.snapshot();
  if(action==='repay'){
    if(snapshot.principal===null||amount<=0n||amount>snapshot.principal)throw new Error('Repayment must be positive and no greater than confirmed principal.');
    if(await deps.allowance(sender.address)<amount){await sendOne('approve',snapshot);snapshot=await deps.snapshot();}
  }
  await sendOne(action,snapshot);return finished;
}

export async function recoverRow(row:LedgerRow):Promise<LedgerRow>{
  if(!row.hash||row.chainId!==5042002||row.facilityId!==manifest?.facility.id)return row;
  try{return await services.receipt(row,await rpc.getTransactionReceipt({hash:row.hash}));}
  catch{return {...row,status:'unknown',message:'No receipt is available yet. The transaction may still be pending; inspect wallet activity and the explorer.'};}
}
