const MAX_UINT256 = (1n << 256n) - 1n;
export function parseAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter a positive USDC amount with at most six decimal places.');
  const [whole='0', fraction=''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6,'0'));
  if (amount <= 0n || amount > MAX_UINT256) throw new Error('Enter a positive amount within the token’s supported range.');
  return amount;
}
/** Exact decimal formatting without a Number conversion. Two-place summaries round half up. */
export function money(value: bigint | null | undefined, places: 2 | 6 = 2): string {
  if (value === null || value === undefined) return '—';
  const negative = value < 0n; const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(6-places);
  const rounded = places===6 ? absolute : (absolute + scale/2n)/scale;
  const unit = 10n**BigInt(places);
  return `${negative && rounded !== 0n ? '−' : ''}${(rounded/unit).toLocaleString('en-US')}.${(rounded%unit).toString().padStart(places,'0')}`;
}
export function decimal(value: bigint): string {
  return `${value/1_000_000n}.${(value%1_000_000n).toString().padStart(6,'0')}`;
}
export function percent(bps: number | bigint | null | undefined): string {
  if (bps===null || bps===undefined) return '—';
  const n=BigInt(bps); return `${n/100n}.${(n%100n).toString().padStart(2,'0')}%`;
}
export function grossBps(gross: bigint, exposure: bigint): bigint | null { return exposure>0n ? gross*10_000n/exposure : null; }
export function delta(observed: number, required: number): string {
  const d=observed-required; return `${d<0?'−':d>0?'+':''}${Math.abs(d).toLocaleString('en-US')} bp`;
}
export function short(value: string): string { return value.length>18 ? `${value.slice(0,8)}…${value.slice(-6)}` : value; }
export function utc(seconds: bigint | number | null | undefined): string {
  if (seconds===null || seconds===undefined || seconds===0n) return '—';
  const date=new Date(Number(seconds)*1000); return Number.isNaN(date.getTime())?'—':date.toISOString().replace('T',' ').replace('.000Z',' UTC');
}
export function duration(seconds: number | bigint): string {
  const n=Math.max(0,Number(seconds));
  if(n>=86400) return `${Math.floor(n/86400)}d ${Math.floor(n%86400/3600)}h`;
  if(n>=3600) return `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`;
  if(n>=60) return `${Math.floor(n/60)}m ${Math.floor(n%60)}s`;
  return `${Math.floor(n)}s`;
}
export function freshness(observed: bigint, validUntil: bigint, maxAge: number, now: bigint) {
  const ageEnd=observed+BigInt(maxAge); const expires=ageEnd<validUntil?ageEnd:validUntil;
  if(observed>now) return {state:'FUTURE',expires,remaining:expires-now,age:0n} as const;
  const remaining=expires-now;
  return {state:remaining<0n?'STALE':remaining<=BigInt(Math.floor(maxAge/4))?'AGEING':'FRESH',expires,remaining,age:now-observed} as const;
}
export function blockNumber(value: bigint | string | number | null | undefined): string {
  if (value===null || value===undefined || value==='') return '—';
  try { return BigInt(value).toLocaleString('en-US'); } catch { return String(value); }
}
export function json(value: unknown): string {return JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v,2);}
