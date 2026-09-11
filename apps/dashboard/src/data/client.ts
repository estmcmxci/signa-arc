import { BaseError, ContractFunctionRevertedError, createPublicClient, erc20Abi, http, isAddressEqual, type Abi, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import vaultAbiJson from './abi/CovenantVault.json';
import engineAbiJson from './abi/CoverageEngine.json';
import registryAbiJson from './abi/CredentialRegistry.json';
import facilityAbiJson from './abi/FacilityRegistry.json';
import { loadManifest } from '../manifest';
import type { Action, BlockContext, Coverage, Exposure, Hedge, Policy, Snapshot, Verdict } from './types';

export const vaultAbi = vaultAbiJson as Abi;
export const engineAbi = engineAbiJson as Abi;
export const registryAbi = registryAbiJson as Abi;
export const facilityAbi = facilityAbiJson as Abi;
const errorAbi=[...vaultAbi,...engineAbi,...registryAbi,...facilityAbi].filter(a=>a.type==='error');
export const fullVaultAbi=[...vaultAbi.filter(a=>a.type!=='error'),...errorAbi] as Abi;
export const manifestState=loadManifest();
export const manifest=manifestState.status==='ready'?manifestState.manifest:null;
export const rpc=createPublicClient({chain:arcTestnet,transport:http(manifest?.rpcUrl,{timeout:12_000,retryCount:1}),batch:{multicall:true}});
export const explorer=manifest?.explorer??arcTestnet.blockExplorers.default.url;
export const configured=manifestState.status==='ready'&&manifestState.source==='deployed';
export const contextKey=manifest?`${manifest.chainId}:${manifest.facility.id}:${manifest.contracts.covenantVault.address}`:'missing';

export async function blockContext(): Promise<BlockContext> {
  const b=await rpc.getBlock(); if(!b.hash||b.number===null)throw new Error('The RPC did not return a mined block.');
  return {number:b.number,hash:b.hash,timestamp:b.timestamp};
}
let validated=false;
export async function validateDeployment() {
  if(!manifest||!configured)throw new Error('A deployed Arc manifest is required. Fixture addresses never enable live actions.');
  if(await rpc.getChainId()!==arcTestnet.id)throw new Error('The RPC is serving a different chain.');
  if(validated)return;
  const v=manifest.contracts.covenantVault.address;
  const [facility,registry,engine,token,decimals]=await Promise.all([
    rpc.readContract({address:v,abi:vaultAbi,functionName:'facilityId'}),
    rpc.readContract({address:v,abi:vaultAbi,functionName:'facilityRegistry'}),
    rpc.readContract({address:v,abi:vaultAbi,functionName:'coverageEngine'}),
    rpc.readContract({address:v,abi:vaultAbi,functionName:'settlementAsset'}),
    rpc.readContract({address:manifest.settlementAsset.address,abi:erc20Abi,functionName:'decimals'}),
  ]);
  if(facility!==manifest.facility.id||!isAddressEqual(registry as Address,manifest.contracts.facilityRegistry.address)||!isAddressEqual(engine as Address,manifest.contracts.coverageEngine.address)||!isAddressEqual(token as Address,manifest.settlementAsset.address)||decimals!==6)throw new Error('The deployed vault does not match the configured facility or six-decimal settlement asset.');
  validated=true;
}

export async function readSnapshot(): Promise<Snapshot> {
  await validateDeployment(); const m=manifest!; const block=await blockContext();
  const c=m.contracts;const v=c.covenantVault.address;const id=m.facility.id;
  const calls=[
    {address:c.facilityRegistry.address,abi:facilityAbi,functionName:'getFacility',args:[id]},
    {address:c.credentialRegistry.address,abi:registryAbi,functionName:'currentExposure',args:[id]},
    {address:c.coverageEngine.address,abi:engineAbi,functionName:'evaluate',args:[id]},
    ...['covenantState','principal','cureDeadline','availableToDraw','activeWaiver','waiverEndsAt','waiverReasonCommitment','stateBeforeWaiver'].map(functionName=>({address:v,abi:vaultAbi,functionName})),
    {address:m.settlementAsset.address,abi:erc20Abi,functionName:'balanceOf',args:[v]},
    {address:c.credentialRegistry.address,abi:registryAbi,functionName:'hedgeTradeIds',args:[id]},
  ];
  const results=await rpc.multicall({contracts:calls,blockNumber:block.number,allowFailure:true});
  const issues:string[]=[];
  function value<T>(i:number):T|null {const item=results[i];if(item?.status==='success')return item.result as T;issues.push(calls[i]?.functionName??'Unknown read');return null;}
  const snapshot:Snapshot={block,receivedAt:Date.now(),mode:'live',policy:value<Policy>(0),exposure:value<Exposure>(1),coverage:value<Coverage>(2),state:value<number>(3),principal:value<bigint>(4),cureDeadline:value<bigint>(5),available:value<bigint>(6),activeWaiver:value<boolean>(7),waiverEndsAt:value<bigint>(8),waiverReason:value<Hex>(9),stateBeforeWaiver:value<number>(10),balance:value<bigint>(11),hedges:null,issues};
  const ids=value<Hex[]>(12);
  if(ids){
    const hedgeCalls=ids.flatMap(tradeId=>[
      {address:c.credentialRegistry.address,abi:registryAbi,functionName:'currentHedge',args:[id,tradeId]},
      {address:c.coverageEngine.address,abi:engineAbi,functionName:'hedgeEligibility',args:[id,tradeId]},
    ]);
    const hs=hedgeCalls.length?await rpc.multicall({contracts:hedgeCalls,blockNumber:block.number,allowFailure:true}):[];
    snapshot.hedges=[];
    ids.forEach((_,i)=>{const stored=hs[2*i],eligibility=hs[2*i+1];
      if(stored?.status!=='success'){issues.push(`Hedge ${i+1} assertion`);return;}
      const pair=eligibility?.status==='success'?eligibility.result as [number,bigint]:null;
      if(!pair)issues.push(`Hedge ${i+1} eligibility`);
      snapshot.hedges!.push({...stored.result as Hedge,eligibilityReason:pair?.[0]??null,adjustedNotional:pair?.[1]??null});
    });
  }
  return snapshot;
}

export function classifyError(error:unknown): Pick<Verdict,'kind'|'code'|'args'> {
  if(error instanceof BaseError){const e=error.walk(e=>e instanceof ContractFunctionRevertedError);
    if(e instanceof ContractFunctionRevertedError){
      const code=e.data?.errorName;
      if(code){
        const kind=code==='DrawNotAllowed'||code==='ReserveViolation'?'held':code.startsWith('Not')?'authorization':code==='InvalidAmount'||code==='InvalidWaiver'?'input':'system';
        return {kind,code,args:e.data?.args??[]};
      }
      return {kind:'system',code:e.signature?'ABI_MISMATCH':'UNDECODED_REVERT',args:[e.signature??e.reason??'The contract response could not be decoded.']};
    }
  }
  return {kind:'system',code:'RPC_UNAVAILABLE',args:['The contract could not be evaluated. Retry the read.']};
}

export async function simulate(action:Action,amount:bigint,sender:Address,block?:BlockContext):Promise<Verdict>{
  await validateDeployment();const m=manifest!;const at=block??await blockContext();
  const base={amount,action,sender,block:at};
  try {
    const args=action==='draw'||action==='repay'?[amount]:action==='approve'?[m.contracts.covenantVault.address,amount]:[];
    const {request}=await rpc.simulateContract({address:action==='approve'?m.settlementAsset.address:m.contracts.covenantVault.address,abi:action==='approve'?erc20Abi:fullVaultAbi,functionName:action,args,account:sender,blockNumber:at.number});
    return {...base,kind:'permitted',code:'PERMITTED',args:[],request};
  }catch(error){return {...base,...classifyError(error)};}
}

/** This vault's amount-dependent check is solely the reserve check. Confirm, don't infer, the boundary. */
export async function maximumDraw(snapshot:Snapshot,sender:Address):Promise<{amount:bigint;verdict:Verdict}> {
  const upper=snapshot.available;
  if(upper===null)throw new Error('Drawable liquidity is unavailable.');
  const candidate=upper>0n?upper:1n;
  const verdict=await simulate('draw',candidate,sender,snapshot.block);
  if(verdict.kind==='system'||verdict.kind==='authorization'||verdict.kind==='input')throw new Error('A maximum cannot be established from this evaluation.');
  return {amount:verdict.kind==='permitted'?candidate:0n,verdict};
}
