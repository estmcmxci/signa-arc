import type { Snapshot, Verdict } from './types';
import { EXPOSURE_REASONS, RESULT_REASONS } from './types';
import { money, percent } from './format';

export const REASONS: Record<string,{title:string;explanation:string;remedy:string;actor:string}> = {
  ELIGIBLE:{title:'Eligible assertion',explanation:'The engine accepts this evidence under the frozen policy.',remedy:'Keep the assertion current.',actor:'Issuer'},
  MISSING:{title:'Assertion missing',explanation:'No current assertion is available.',remedy:'An approved issuer must provide an assertion.',actor:'Issuer'},
  ZERO_VALUE:{title:'Exposure is zero',explanation:'A zero exposure does not establish a coverage ratio.',remedy:'The exposure issuer must assert the current obligation.',actor:'Exposure issuer'},
  ISSUER_NOT_APPROVED:{title:'Issuer is not approved',explanation:'The signer is not currently authorized for this role.',remedy:'Use an issuer authorized by the facility administrator.',actor:'Facility administrator'},
  PAIR_MISMATCH:{title:'Currency pair does not match',explanation:'The assertion’s pair differs from the frozen facility policy.',remedy:'Provide evidence for this facility’s currency pair.',actor:'Issuer'},
  NOT_YET_OBSERVED:{title:'Observation is in the future',explanation:'The observation timestamp is later than the assessment block.',remedy:'Correct the observation and submit a newly signed sequence.',actor:'Issuer'},
  EXPIRED:{title:'Assertion expired',explanation:'The assertion’s validity window has ended.',remedy:'Submit a fresh, higher-sequence assertion, then synchronize.',actor:'Issuer and keeper'},
  STALE:{title:'Assertion is too old',explanation:'The observation exceeds the policy’s maximum age.',remedy:'Submit fresh evidence. Synchronizing alone does not renew it.',actor:'Issuer and keeper'},
  REVOKED:{title:'Assertion revoked',explanation:'The assertion has been revoked.',remedy:'Resolve the revocation and provide new authorized evidence.',actor:'Issuer or administrator'},
  ISSUER_AUTHORIZATION_STALE:{title:'Authorization epoch changed',explanation:'This assertion predates the issuer’s current authorization.',remedy:'Provide a newly signed assertion under current authorization.',actor:'Issuer'},
  SAME_AS_EXPOSURE_ISSUER:{title:'Independent signer required',explanation:'Exposure and hedge assertions must come from different authorized issuers.',remedy:'Use a separately authorized hedge issuer.',actor:'Hedge issuer'},
  NOT_ACTIVE:{title:'Hedge is not active',explanation:'Cancelled, settled or disputed assertions do not count.',remedy:'Provide evidence of eligible active coverage.',actor:'Hedge issuer'},
  MATURITY_MISMATCH:{title:'Maturity does not match',explanation:'Hedge maturity plus the frozen tolerance does not cover exposure maturity.',remedy:'Provide a hedge assertion with an admissible maturity. This policy is frozen.',actor:'Hedge issuer'},
};

export function describeVerdict(v: Verdict, snapshot: Snapshot | undefined) {
  if(v.kind==='permitted') return {title:'The covenant permits this draw',rule:'Coverage and retained reserve',observed:`${money(v.amount,6)} USDC requested`,required:'Current admissible evidence and retained reserve',remedy:'The vault re-evaluates when the transaction executes.',actor:'Operator',code:'PERMITTED'};
  if(v.code==='ReserveViolation') {
    const [balance,requested,reserve]=v.args as bigint[];
    return {title:'The retained reserve holds this draw',rule:'Retained reserve',observed:`${money(balance,6)} USDC in the vault; ${money(requested,6)} requested`,required:`${money(reserve,6)} USDC must remain`,remedy:'Reduce the amount if drawable funds remain, or fund the vault before drawing.',actor:'Operator / funder',code:v.code};
  }
  if(v.code==='DrawNotAllowed') {
    const c=snapshot?.coverage; const reason=c ? (EXPOSURE_REASONS[c.exposureReason]??'UNKNOWN'):'UNKNOWN';
    const info=REASONS[reason]; const shortfall=c&&c.outstandingValue>0n ? ((c.outstandingValue*BigInt(c.requiredCoverageBps)+9999n)/10000n-c.countedEligible):null;
    return {title:'The coverage covenant holds this draw',rule:reason==='ELIGIBLE'?'Minimum counted coverage':(info?.title??'Current admissible evidence'),observed:c?`${percent(c.coverageBps)} counted coverage`:'Current evaluation unavailable',required:c?`${percent(c.requiredCoverageBps)} minimum${shortfall!==null&&shortfall>0n?`; ${money(shortfall,6)} USDC more counted cover needed`:''}`:'A current engine evaluation',remedy:reason==='ELIGIBLE'?'The hedge issuer can provide additional eligible cover. A governed waiver is a separate, bounded exception; it does not restore coverage.':(info?.remedy??'Check current evidence, then synchronize.'),actor:reason==='ELIGIBLE'?'Hedge issuer / quorum approvers':(info?.actor??'Issuer'),code:`${v.code} · ${c?(RESULT_REASONS[c.resultReason]??'UNKNOWN'):'UNKNOWN'}`};
  }
  return {title:v.kind==='authorization'?'This account does not hold the required role':v.kind==='input'?'Review the requested amount':'Evaluation is unavailable',rule:v.kind==='system'?'Connection and contract response':'Action preconditions',observed:v.args.map(String).join(' ')||v.code,required:'A valid response in the selected account and chain context',remedy:v.kind==='authorization'?'Connect the facility operator for draw and repayment.':v.kind==='input'?'Enter a positive amount with no more than six decimals.':'Retry the read. No transaction has been sent.',actor:'Operator',code:v.code};
}
