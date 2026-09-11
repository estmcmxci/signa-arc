import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  isAddressEqual,
  numberToHex,
  parseAbi,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import { decimal } from '../data/format';
import type { Coverage, Exposure, Hedge, Policy } from '../data/types';
import { fixtureFacility, label } from './fixtures';

// An in-memory Arc Testnet node for the /test-ui/ chain fixture and the browser tests
// (FRONTEND-PLAN stage 1, output/FRONTEND-CONTRACT.md). It answers the JSON-RPC calls
// the desk's live data path makes, at the deployment's addresses, from the fabricated
// records in ./fixtures.ts, and applies CovenantVault's rules to transactions.
// Transactions reach it only from the fixture wallet: they carry no signature and never
// leave this object. Block and transaction hashes decode to "FIXTURE-…".

export const ARC_CHAIN_ID = 5_042_002;
export const SLOW_RPC_MS = 1_000;
const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11');
const GENESIS = 1_000n;
const BASE_FEE = 20_000_000_000n;
const TIP = 1_000_000_000n;
const GAS_USED = 84_000n;
const GAS_LIMIT = 300_000n;
const OPERATOR_FUNDS = 10_000_000n;
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
const EMPTY_BLOOM = `0x${'0'.repeat(512)}` as Hex;
const OTHER_RECIPIENT = getAddress(label('FIXTURE-OTHER-RECIPIENT', 20));
const COMPLIANT = 1;
const CURE = 2;
const BREACH = 3;
const WAIVED = 4;

/** The contract surface the desk reads and sends. test/chain.test.ts checks it against the generated ABIs. */
export const CHAIN_ABI: Abi = parseAbi([
  'struct Policy { bytes32 facilityId; bytes3 settlementCurrency; bytes3 exposureCurrency; uint16 minCoverageBps; uint32 credentialMaxAge; uint32 maturityTolerance; uint16 defaultHaircutBps; uint128 reserveAmount; uint32 curePeriod; uint32 maxWaiverDuration; uint8 maxActiveHedges; address settlementAsset; address admin; address operator; bool frozen; }',
  'struct Coverage { bool assessed; bool compliant; uint128 outstandingValue; uint256 grossEligible; uint256 countedEligible; uint16 coverageBps; uint16 requiredCoverageBps; uint8 eligibleHedgeCount; uint8 totalHedgeCount; uint8 exposureReason; uint8 resultReason; }',
  'struct ExposureCredential { bytes32 facilityId; bytes3 exposureCurrency; bytes3 settlementCurrency; uint128 outstandingValue; uint64 exposureMaturity; uint64 observedAt; uint64 validUntil; uint64 sequence; bytes32 sourceCommitment; }',
  'struct StoredExposure { ExposureCredential credential; address issuer; bytes32 digest; uint64 acceptedAt; uint64 issuerEpoch; }',
  'struct HedgeCredential { bytes32 facilityId; bytes32 tradeIdCommitment; bytes3 baseCurrency; bytes3 quoteCurrency; uint128 remainingNotional; uint64 maturity; uint8 status; uint64 observedAt; uint64 validUntil; uint64 sequence; bytes32 sourceCommitment; }',
  'struct StoredHedge { HedgeCredential credential; address issuer; bytes32 digest; uint64 acceptedAt; uint64 issuerEpoch; }',
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function getFacility(bytes32 facilityId) view returns (Policy)',
  'function currentExposure(bytes32 facilityId) view returns (StoredExposure)',
  'function hedgeTradeIds(bytes32 facilityId) view returns (bytes32[])',
  'function currentHedge(bytes32 facilityId, bytes32 tradeIdCommitment) view returns (StoredHedge)',
  'function evaluate(bytes32 facilityId) view returns (Coverage)',
  'function hedgeEligibility(bytes32 facilityId, bytes32 tradeIdCommitment) view returns (uint8, uint256)',
  'function facilityId() view returns (bytes32)',
  'function facilityRegistry() view returns (address)',
  'function coverageEngine() view returns (address)',
  'function settlementAsset() view returns (address)',
  'function covenantState() view returns (uint8)',
  'function principal() view returns (uint256)',
  'function cureDeadline() view returns (uint64)',
  'function availableToDraw() view returns (uint256)',
  'function activeWaiver() view returns (bool)',
  'function waiverEndsAt() view returns (uint64)',
  'function waiverReasonCommitment() view returns (bytes32)',
  'function stateBeforeWaiver() view returns (uint8)',
  'function draw(uint256 amount)',
  'function repay(uint256 amount)',
  'function syncCovenant() returns (Coverage result, uint8 state)',
  'function restoreCompliance() returns (Coverage result)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'event CovenantSynchronized(bytes32 indexed facilityId, uint8 indexed previousState, uint8 indexed newState, uint16 coverageBps, uint16 requiredCoverageBps, uint128 outstandingValue, uint256 grossEligible, uint256 countedEligible, uint8 reason, uint64 cureDeadline)',
  'event Drawn(bytes32 indexed facilityId, address indexed operator, uint256 amount, uint256 principal)',
  'event Repaid(bytes32 indexed facilityId, address indexed operator, uint256 amount, uint256 principal)',
  'event Approval(address indexed owner, address indexed spender, uint256 amount)',
  'event Transfer(address indexed from, address indexed to, uint256 amount)',
  'error DrawNotAllowed(uint8 state)',
  'error ReserveViolation(uint256 balance, uint256 requested, uint256 reserve)',
  'error NotOperator(address caller)',
  'error InvalidAmount()',
  'error TokenTransferFailed()',
] as readonly string[]);

export type ChainAddresses = {
  facilityId: Hex;
  vault: Address;
  facilityRegistry: Address;
  credentialRegistry: Address;
  coverageEngine: Address;
  settlementAsset: Address;
  operator: Address;
  admin: Address;
};

/** The manifest fields the node answers for. A validated manifest and the raw deployment JSON both fit. */
export type ManifestAddresses = {
  facility: { id: string };
  contracts: Record<'covenantVault' | 'facilityRegistry' | 'credentialRegistry' | 'coverageEngine', { address: string }>;
  settlementAsset: { address: string };
  roles: { operator: string; facilityAdmin: string };
};

export function chainAddresses(m: ManifestAddresses): ChainAddresses {
  return {
    facilityId: m.facility.id as Hex,
    vault: getAddress(m.contracts.covenantVault.address),
    facilityRegistry: getAddress(m.contracts.facilityRegistry.address),
    credentialRegistry: getAddress(m.contracts.credentialRegistry.address),
    coverageEngine: getAddress(m.contracts.coverageEngine.address),
    settlementAsset: getAddress(m.settlementAsset.address),
    operator: getAddress(m.roles.operator),
    admin: getAddress(m.roles.facilityAdmin),
  };
}

/** Labelled stand-ins, for the snapshot fixture when no deployment manifest is configured. */
export function fixtureAddresses(): ChainAddresses {
  const address = (text: string) => getAddress(label(text, 20));
  return {
    facilityId: label('FIXTURE-FACILITY', 32),
    vault: address('FIXTURE-VAULT'),
    facilityRegistry: address('FIXTURE-FACILITIES'),
    credentialRegistry: address('FIXTURE-CREDENTIALS'),
    coverageEngine: address('FIXTURE-ENGINE'),
    settlementAsset: address('FIXTURE-USDC'),
    operator: address('FIXTURE-OPERATOR'),
    admin: address('FIXTURE-QUORUM-ADMIN'),
  };
}

export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data: Hex | null = null) {
    super(message);
  }
}

export type ReplacementReason = 'repriced' | 'cancelled' | 'replaced';
export type ChainTransaction = {
  hash: Hex;
  name: string;
  from: Address;
  to: Address | null;
  input: Hex;
  value: bigint;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  block: bigint | null;
  blockHash: Hex | null;
  index: number | null;
};
type ChainLog = { address: Address; topics: Hex[]; data: Hex };
type ChainReceipt = { tx: ChainTransaction; status: 'success' | 'reverted'; logs: ChainLog[] };
type ChainBlock = { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint; transactions: ChainTransaction[] };
type Ledger = {
  covenantState: number;
  principal: bigint;
  cureDeadline: bigint;
  waiverEndsAt: bigint;
  waiverReason: Hex;
  stateBeforeWaiver: number;
  balances: Map<string, bigint>;
  allowances: Map<string, bigint>;
};
type Outcome = { ok: true; data: Hex; logs: ChainLog[] } | { ok: false; data: Hex };
type Call3 = { target: Address; allowFailure: boolean; callData: Hex };

const REVERTED: Outcome = { ok: false, data: '0x' };
const copy = (s: Ledger): Ledger => ({ ...s, balances: new Map(s.balances), allowances: new Map(s.allowances) });
const allowanceKey = (owner: unknown, spender: unknown) => `${String(owner).toLowerCase()}:${String(spender).toLowerCase()}`;
const waiverActive = (s: Ledger, now: bigint) => s.covenantState === WAIVED && now <= s.waiverEndsAt;
const stored = ({ credential, issuer, digest, acceptedAt, issuerEpoch }: Exposure | Hedge) => ({ credential, issuer, digest, acceptedAt, issuerEpoch });
/** Decodes to "FIXTURE-…" and still ends in a distinct counter, so shortened hashes stay distinguishable. */
const fixtureHash = (name: string, count: number): Hex => `${label(name, 32).slice(0, -6)}${count.toString(16).padStart(6, '0')}` as Hex;

export class FixtureChain {
  readonly addresses: ChainAddresses;
  /** How the page's transport treats this node: 'fail' refuses every request, 'slow' delays each. */
  readonly transport: 'ok' | 'fail' | 'slow';
  /** Makes the next mined transaction revert, as when state changes between simulation and inclusion. */
  revertNext = false;
  private readonly policy: Policy;
  private readonly exposure: Exposure;
  private readonly coverage: Coverage | null;
  private readonly hedges: Hedge[];
  private readonly failing: ReadonlySet<string>;
  private readonly blocks: ChainBlock[] = [];
  private readonly ledgers = new Map<bigint, Ledger>();
  private readonly transactions = new Map<Hex, ChainTransaction>();
  private readonly receipts = new Map<Hex, ChainReceipt>();
  private readonly nonces = new Map<string, number>();
  private readonly observed = new Set<Hex>();
  private readonly watchers = new Map<Hex, (() => void)[]>();
  private readonly subscribers = new Set<(message: string) => void>();
  private pool: ChainTransaction[] = [];
  private count = 0;

  constructor(readonly state: string, addresses: ChainAddresses, private readonly clock: () => number = Date.now) {
    const records = fixtureFacility(state, clock());
    this.addresses = addresses;
    this.transport = state === 'rpc-error' ? 'fail' : state === 'slow' ? 'slow' : 'ok';
    this.failing = new Set(state === 'partial' ? ['evaluate', 'availableToDraw'] : []);
    this.policy = { ...records.policy!, facilityId: addresses.facilityId, settlementAsset: addresses.settlementAsset, admin: addresses.admin, operator: addresses.operator };
    this.exposure = records.exposure!;
    this.coverage = state === 'partial' ? null : records.coverage;
    this.hedges = records.hedges ?? [];
    this.blocks.push({ number: GENESIS, hash: fixtureHash('FIXTURE-BLOCK', Number(GENESIS)), parentHash: ZERO_HASH, timestamp: BigInt(Math.floor(clock() / 1000)), transactions: [] });
    this.ledgers.set(GENESIS, {
      covenantState: records.state ?? 0,
      principal: records.principal ?? 0n,
      cureDeadline: records.cureDeadline ?? 0n,
      waiverEndsAt: records.waiverEndsAt ?? 0n,
      waiverReason: records.waiverReason ?? ZERO_HASH,
      stateBeforeWaiver: records.stateBeforeWaiver ?? 0,
      balances: new Map([[addresses.vault.toLowerCase(), records.balance ?? 0n], [addresses.operator.toLowerCase(), OPERATOR_FUNDS]]),
      allowances: new Map(),
    });
  }

  get head(): ChainBlock {
    return this.blocks[this.blocks.length - 1]!;
  }

  get pending(): readonly ChainTransaction[] {
    return this.pool;
  }

  subscribe(listener: (message: string) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  nonceOf(account: string): number {
    return this.nonces.get(account.toLowerCase()) ?? 0;
  }

  /** Accepts an unsigned request from the fixture wallet into the pending pool. */
  submit(request: { from: Address; to: Address | null; input: Hex; value: bigint; gas?: bigint }): Hex {
    const nonce = this.nonceOf(request.from);
    this.nonces.set(request.from.toLowerCase(), nonce + 1);
    const t = this.transaction({ from: getAddress(request.from), to: request.to && getAddress(request.to), input: request.input, value: request.value, nonce, gas: request.gas ?? GAS_LIMIT, maxFeePerGas: BASE_FEE + TIP });
    this.pool.push(t);
    this.notify(`${t.name} pending: ${this.describe(t.to, t.input)}`);
    return t.hash;
  }

  /** Mines every pending transaction into a new block. Nothing is mined unless asked. */
  mine(): ChainBlock {
    const parent = this.head;
    const number = parent.number + 1n;
    const now = BigInt(Math.floor(this.clock() / 1000));
    const block: ChainBlock = { number, hash: fixtureHash('FIXTURE-BLOCK', Number(number)), parentHash: parent.hash, timestamp: now > parent.timestamp ? now : parent.timestamp + 1n, transactions: [] };
    let ledger = copy(this.ledgerAt(parent.number));
    const outcomes: string[] = [];
    for (const t of this.pool.splice(0)) {
      const trial = copy(ledger);
      const forced = this.revertNext;
      this.revertNext = false;
      const out = forced ? REVERTED : this.execute(trial, t.from, t.to, t.input, block.timestamp);
      if (out.ok) ledger = trial;
      Object.assign(t, { block: number, blockHash: block.hash, index: block.transactions.length });
      block.transactions.push(t);
      this.receipts.set(t.hash, { tx: t, status: out.ok ? 'success' : 'reverted', logs: out.ok ? out.logs : [] });
      outcomes.push(`${t.name} ${out.ok ? 'succeeded' : 'reverted'}`);
    }
    this.blocks.push(block);
    this.ledgers.set(number, ledger);
    this.notify(`Block ${number} mined${outcomes.length ? `: ${outcomes.join(', ')}` : ', empty'}`);
    return block;
  }

  /** The wallet replaces a pending transaction, and the replacement is mined at once. */
  async replace(hash: Hex, reason: ReplacementReason): Promise<Hex> {
    await this.whenObserved(hash);
    const original = this.pool.find((t) => t.hash === hash);
    if (!original) throw new Error('Only a pending transaction can be replaced.');
    this.pool = this.pool.filter((t) => t !== original);
    this.transactions.delete(hash);
    const change = reason === 'cancelled' ? { to: original.from, value: 0n, input: '0x' as Hex } : reason === 'replaced' ? { to: OTHER_RECIPIENT, value: 1n, input: '0x' as Hex } : {};
    const t = this.transaction({ from: original.from, to: original.to, input: original.input, value: original.value, nonce: original.nonce, gas: original.gas, ...change, maxFeePerGas: original.maxFeePerGas * 2n });
    this.pool.push(t);
    this.notify(`${original.name} ${reason === 'repriced' ? 'sped up' : reason} by ${t.name}`);
    this.mine();
    return t.hash;
  }

  /** Resolves once a client has fetched the transaction. viem needs it to recognise a replacement. */
  whenObserved(hash: Hex): Promise<void> {
    if (this.observed.has(hash)) return Promise.resolve();
    return new Promise((resolve) => this.watchers.set(hash, [...(this.watchers.get(hash) ?? []), resolve]));
  }

  describe(to: Address | null, input: Hex): string {
    if (!to) return 'a contract creation';
    try {
      const { functionName, args = [] } = decodeFunctionData({ abi: CHAIN_ABI, data: input });
      if (functionName === 'draw' || functionName === 'repay') return `${functionName} ${decimal(args[0] as bigint)} USDC`;
      if (functionName === 'approve') return `approve ${decimal(args[1] as bigint)} USDC${isAddressEqual(args[0] as Address, this.addresses.vault) ? ' for the covenant vault' : ''}`;
      return `${functionName}()`;
    } catch {
      return input === '0x' ? `a plain transfer to ${to}` : `a call to ${to}`;
    }
  }

  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const p: readonly unknown[] = Array.isArray(params) ? params : [];
    switch (method) {
      case 'eth_chainId':
        return numberToHex(ARC_CHAIN_ID);
      case 'net_version':
        return String(ARC_CHAIN_ID);
      case 'eth_blockNumber':
        return numberToHex(this.head.number);
      case 'eth_gasPrice':
        return numberToHex(BASE_FEE + TIP);
      case 'eth_maxPriorityFeePerGas':
        return numberToHex(TIP);
      case 'eth_getBalance':
        return numberToHex(10n ** 19n);
      case 'eth_getCode':
        return this.contractAt(getAddress(String(p[0]))) ? '0x01' : '0x';
      case 'eth_getTransactionCount':
        return numberToHex(this.nonceOf(String(p[0])));
      case 'eth_getBlockByNumber': {
        const block = this.blockAt(p[0]);
        return block ? rpcBlock(block, p[1] === true) : null;
      }
      case 'eth_getBlockByHash': {
        const block = this.blocks.find((b) => b.hash === p[0]);
        return block ? rpcBlock(block, p[1] === true) : null;
      }
      case 'eth_getTransactionByHash': {
        const t = this.transactions.get(p[0] as Hex);
        if (t) this.observe(t.hash);
        return t ? rpcTransaction(t) : null;
      }
      case 'eth_getTransactionReceipt': {
        const receipt = this.receipts.get(p[0] as Hex);
        return receipt ? rpcReceipt(receipt) : null;
      }
      case 'eth_call':
      case 'eth_estimateGas': {
        const call = (p[0] ?? {}) as { from?: string; to?: string | null; data?: Hex; input?: Hex };
        const block = this.blockAt(p[1] ?? 'latest');
        if (!block) throw new RpcError(-32000, 'header not found');
        const out = this.execute(copy(this.ledgerAt(block.number)), call.from ? getAddress(call.from) : ZERO_ADDRESS, call.to ? getAddress(call.to) : null, call.data ?? call.input ?? '0x', block.timestamp);
        if (!out.ok) throw new RpcError(3, 'execution reverted', out.data);
        return method === 'eth_call' ? out.data : numberToHex(GAS_USED);
      }
    }
    throw new RpcError(-32601, `The fixture node does not implement ${method}.`);
  }

  private transaction(fields: Omit<ChainTransaction, 'hash' | 'name' | 'block' | 'blockHash' | 'index'>): ChainTransaction {
    const name = `FIXTURE-TX-${++this.count}`;
    const t: ChainTransaction = { hash: fixtureHash(name, this.count), name, ...fields, block: null, blockHash: null, index: null };
    this.transactions.set(t.hash, t);
    return t;
  }

  private notify(message: string): void {
    for (const listener of this.subscribers) listener(message);
  }

  private observe(hash: Hex): void {
    if (this.observed.has(hash)) return;
    this.observed.add(hash);
    for (const resolve of this.watchers.get(hash) ?? []) resolve();
    this.watchers.delete(hash);
  }

  private blockAt(tag: unknown): ChainBlock | undefined {
    if (tag === undefined || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized') return this.head;
    if (tag === 'earliest') return this.blocks[0];
    if (typeof tag !== 'string' || !/^0x[0-9a-f]+$/i.test(tag)) return undefined;
    const index = BigInt(tag) - GENESIS;
    return index < 0n ? undefined : this.blocks[Number(index)];
  }

  private ledgerAt(number: bigint): Ledger {
    return this.ledgers.get(number)!;
  }

  private contractAt(address: Address): 'vault' | 'facilities' | 'credentials' | 'engine' | 'usdc' | 'multicall' | null {
    const a = this.addresses;
    const is = (b: Address) => isAddressEqual(address, b);
    return is(a.vault) ? 'vault' : is(a.facilityRegistry) ? 'facilities' : is(a.credentialRegistry) ? 'credentials' : is(a.coverageEngine) ? 'engine' : is(a.settlementAsset) ? 'usdc' : is(MULTICALL3) ? 'multicall' : null;
  }

  private execute(s: Ledger, from: Address, to: Address | null, input: Hex, now: bigint): Outcome {
    if (!to) return REVERTED;
    const where = this.contractAt(to);
    if (!where) return { ok: true, data: '0x', logs: [] };
    let functionName: string;
    let args: readonly unknown[];
    try {
      ({ functionName, args = [] } = decodeFunctionData({ abi: CHAIN_ABI, data: input }));
    } catch {
      return REVERTED;
    }
    const a = this.addresses;
    const forFacility = (id: unknown) => typeof id === 'string' && id.toLowerCase() === a.facilityId.toLowerCase();
    const funds = this.balanceOf(s, a.vault);
    const reserve = this.policy.reserveAmount;
    switch (`${where}.${functionName}`) {
      case 'vault.facilityId':
        return this.returns(functionName, a.facilityId);
      case 'vault.facilityRegistry':
      case 'engine.facilityRegistry':
        return this.returns(functionName, a.facilityRegistry);
      case 'vault.coverageEngine':
        return this.returns(functionName, a.coverageEngine);
      case 'vault.settlementAsset':
        return this.returns(functionName, a.settlementAsset);
      case 'vault.covenantState':
        return this.returns(functionName, s.covenantState);
      case 'vault.principal':
        return this.returns(functionName, s.principal);
      case 'vault.cureDeadline':
        return this.returns(functionName, s.cureDeadline);
      case 'vault.availableToDraw':
        return this.failing.has(functionName) ? REVERTED : this.returns(functionName, funds > reserve ? funds - reserve : 0n);
      case 'vault.activeWaiver':
        return this.returns(functionName, waiverActive(s, now));
      case 'vault.waiverEndsAt':
        return this.returns(functionName, s.waiverEndsAt);
      case 'vault.waiverReasonCommitment':
        return this.returns(functionName, s.waiverReason);
      case 'vault.stateBeforeWaiver':
        return this.returns(functionName, s.stateBeforeWaiver);
      case 'vault.draw':
        return this.draw(s, from, args[0] as bigint, now);
      case 'vault.repay':
        return this.repay(s, from, args[0] as bigint);
      case 'vault.syncCovenant': {
        const previous = s.covenantState;
        if (!this.sync(s, now)) return REVERTED;
        return this.returns(functionName, [this.coverage, s.covenantState], [this.synced(previous, s)]);
      }
      case 'vault.restoreCompliance': {
        const previous = s.covenantState;
        if (!this.sync(s, now)) return REVERTED;
        if (!this.coverage!.compliant) return this.reverts('DrawNotAllowed', [s.covenantState]);
        return this.returns(functionName, this.coverage, [this.synced(previous, s)]);
      }
      case 'facilities.getFacility':
        return forFacility(args[0]) ? this.returns(functionName, this.policy) : REVERTED;
      case 'credentials.currentExposure':
        return forFacility(args[0]) ? this.returns(functionName, stored(this.exposure)) : REVERTED;
      case 'credentials.hedgeTradeIds':
        return forFacility(args[0]) ? this.returns(functionName, this.hedges.map((h) => h.credential.tradeIdCommitment)) : REVERTED;
      case 'credentials.currentHedge':
      case 'engine.hedgeEligibility': {
        const hedge = forFacility(args[0]) ? this.hedges.find((h) => h.credential.tradeIdCommitment === args[1]) : undefined;
        if (!hedge) return REVERTED;
        return functionName === 'currentHedge' ? this.returns(functionName, stored(hedge)) : this.returns(functionName, [hedge.eligibilityReason ?? 1, hedge.adjustedNotional ?? 0n]);
      }
      case 'engine.evaluate':
        return forFacility(args[0]) && this.coverage && !this.failing.has(functionName) ? this.returns(functionName, this.coverage) : REVERTED;
      case 'usdc.decimals':
        return this.returns(functionName, 6);
      case 'usdc.balanceOf':
        return this.returns(functionName, this.balanceOf(s, args[0] as Address));
      case 'usdc.allowance':
        return this.returns(functionName, s.allowances.get(allowanceKey(args[0], args[1])) ?? 0n);
      case 'usdc.approve': {
        const [spender, amount] = args as [Address, bigint];
        s.allowances.set(allowanceKey(from, spender), amount);
        return this.returns(functionName, true, [this.log(a.settlementAsset, 'Approval', { owner: from, spender, amount })]);
      }
      case 'multicall.aggregate3': {
        const results = (args[0] as readonly Call3[]).map((call) => {
          const out = this.execute(s, MULTICALL3, getAddress(call.target), call.callData, now);
          return { success: out.ok, returnData: out.data, required: !call.allowFailure };
        });
        if (results.some((r) => !r.success && r.required)) return REVERTED;
        return this.returns(functionName, results.map(({ success, returnData }) => ({ success, returnData })));
      }
    }
    return REVERTED;
  }

  /** CovenantVault._syncCovenant: an active waiver holds the state; otherwise evaluate and move. */
  private sync(s: Ledger, now: bigint): boolean {
    const coverage = this.coverage;
    if (!coverage) return false;
    if (waiverActive(s, now)) return true;
    let base = s.covenantState;
    if (base === WAIVED) {
      base = s.stateBeforeWaiver;
      s.waiverEndsAt = 0n;
      s.waiverReason = ZERO_HASH;
    }
    if (coverage.compliant) {
      s.covenantState = COMPLIANT;
      s.cureDeadline = 0n;
    } else if (base === BREACH || (base === CURE && s.cureDeadline !== 0n && now > s.cureDeadline)) {
      s.covenantState = BREACH;
    } else {
      if (base !== CURE || s.cureDeadline === 0n) s.cureDeadline = now + BigInt(this.policy.curePeriod);
      s.covenantState = CURE;
    }
    return true;
  }

  private draw(s: Ledger, from: Address, amount: bigint, now: bigint): Outcome {
    const a = this.addresses;
    if (!isAddressEqual(from, a.operator)) return this.reverts('NotOperator', [from]);
    if (amount === 0n) return this.reverts('InvalidAmount');
    const previous = s.covenantState;
    if (!this.sync(s, now)) return REVERTED;
    const funds = this.balanceOf(s, a.vault);
    const reserve = this.policy.reserveAmount;
    if (s.covenantState !== COMPLIANT && s.covenantState !== WAIVED) return this.reverts('DrawNotAllowed', [s.covenantState]);
    if (amount > funds || funds - amount < reserve) return this.reverts('ReserveViolation', [funds, amount, reserve]);
    s.principal += amount;
    this.move(s, a.vault, a.operator, amount);
    return {
      ok: true,
      data: '0x',
      logs: [
        this.synced(previous, s),
        this.log(a.settlementAsset, 'Transfer', { from: a.vault, to: a.operator, amount }),
        this.log(a.vault, 'Drawn', { facilityId: a.facilityId, operator: a.operator, amount, principal: s.principal }),
      ],
    };
  }

  private repay(s: Ledger, from: Address, amount: bigint): Outcome {
    const a = this.addresses;
    if (!isAddressEqual(from, a.operator)) return this.reverts('NotOperator', [from]);
    if (amount === 0n || amount > s.principal) return this.reverts('InvalidAmount');
    const key = allowanceKey(from, a.vault);
    const allowed = s.allowances.get(key) ?? 0n;
    if (allowed < amount || this.balanceOf(s, from) < amount) return this.reverts('TokenTransferFailed');
    s.allowances.set(key, allowed - amount);
    this.move(s, from, a.vault, amount);
    s.principal -= amount;
    return {
      ok: true,
      data: '0x',
      logs: [
        this.log(a.settlementAsset, 'Transfer', { from, to: a.vault, amount }),
        this.log(a.vault, 'Repaid', { facilityId: a.facilityId, operator: from, amount, principal: s.principal }),
      ],
    };
  }

  private synced(previous: number, s: Ledger): ChainLog {
    const c = this.coverage!;
    return this.log(this.addresses.vault, 'CovenantSynchronized', {
      facilityId: this.addresses.facilityId,
      previousState: previous,
      newState: s.covenantState,
      coverageBps: c.coverageBps,
      requiredCoverageBps: c.requiredCoverageBps,
      outstandingValue: c.outstandingValue,
      grossEligible: c.grossEligible,
      countedEligible: c.countedEligible,
      reason: c.resultReason,
      cureDeadline: s.cureDeadline,
    });
  }

  private balanceOf(s: Ledger, account: Address): bigint {
    return s.balances.get(account.toLowerCase()) ?? 0n;
  }

  private move(s: Ledger, from: Address, to: Address, amount: bigint): void {
    s.balances.set(from.toLowerCase(), this.balanceOf(s, from) - amount);
    s.balances.set(to.toLowerCase(), this.balanceOf(s, to) + amount);
  }

  private returns(functionName: string, result: unknown, logs: ChainLog[] = []): Outcome {
    return { ok: true, data: encodeFunctionResult({ abi: CHAIN_ABI, functionName, result }), logs };
  }

  private reverts(errorName: string, args: readonly unknown[] = []): Outcome {
    return { ok: false, data: encodeErrorResult({ abi: CHAIN_ABI, errorName, args }) };
  }

  private log(address: Address, eventName: string, args: Record<string, unknown>): ChainLog {
    const event = CHAIN_ABI.find((item): item is AbiEvent => item.type === 'event' && item.name === eventName)!;
    const body = event.inputs.filter((input) => !input.indexed);
    return {
      address,
      topics: encodeEventTopics({ abi: [event], eventName, args } as Parameters<typeof encodeEventTopics>[0]) as Hex[],
      data: body.length ? encodeAbiParameters(body, body.map((input) => args[input.name ?? ''])) : '0x',
    };
  }
}

type RpcCall = { id?: number | string | null; method: string; params?: unknown };

/** Answers a JSON-RPC request body, single or batched, as the HTTP endpoint would. */
export async function answer(chain: FixtureChain, body: string): Promise<string> {
  const reply = async ({ id = null, method, params }: RpcCall) => {
    try {
      return { jsonrpc: '2.0', id, result: (await chain.request({ method, params })) ?? null };
    } catch (e) {
      const error = e instanceof RpcError ? e : new RpcError(-32603, e instanceof Error ? e.message : String(e));
      return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) } };
    }
  };
  const parsed = JSON.parse(body) as RpcCall | RpcCall[];
  return JSON.stringify(Array.isArray(parsed) ? await Promise.all(parsed.map(reply)) : await reply(parsed));
}

function rpcTransaction(t: ChainTransaction) {
  return {
    hash: t.hash,
    from: t.from,
    to: t.to,
    input: t.input,
    value: numberToHex(t.value),
    nonce: numberToHex(t.nonce),
    gas: numberToHex(t.gas),
    gasPrice: numberToHex(t.maxFeePerGas),
    maxFeePerGas: numberToHex(t.maxFeePerGas),
    maxPriorityFeePerGas: numberToHex(TIP),
    type: '0x2',
    chainId: numberToHex(ARC_CHAIN_ID),
    accessList: [],
    v: '0x0',
    r: '0x0',
    s: '0x0',
    yParity: '0x0',
    blockNumber: t.block === null ? null : numberToHex(t.block),
    blockHash: t.blockHash,
    transactionIndex: t.index === null ? null : numberToHex(t.index),
  };
}

function rpcReceipt({ tx, status, logs }: ChainReceipt) {
  const placed = { blockHash: tx.blockHash, blockNumber: numberToHex(tx.block ?? 0n), transactionHash: tx.hash, transactionIndex: numberToHex(tx.index ?? 0) };
  return {
    ...placed,
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: numberToHex(GAS_USED),
    gasUsed: numberToHex(GAS_USED),
    effectiveGasPrice: numberToHex(BASE_FEE + TIP),
    contractAddress: null,
    status: status === 'success' ? '0x1' : '0x0',
    type: '0x2',
    logsBloom: EMPTY_BLOOM,
    logs: logs.map((log, i) => ({ ...log, ...placed, logIndex: numberToHex(i), removed: false })),
  };
}

function rpcBlock(b: ChainBlock, full: boolean) {
  return {
    number: numberToHex(b.number),
    hash: b.hash,
    parentHash: b.parentHash,
    timestamp: numberToHex(b.timestamp),
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    totalDifficulty: '0x0',
    gasLimit: numberToHex(30_000_000n),
    gasUsed: numberToHex(GAS_USED * BigInt(b.transactions.length)),
    baseFeePerGas: numberToHex(BASE_FEE),
    miner: ZERO_ADDRESS,
    extraData: '0x',
    mixHash: ZERO_HASH,
    sha3Uncles: ZERO_HASH,
    stateRoot: ZERO_HASH,
    receiptsRoot: ZERO_HASH,
    transactionsRoot: ZERO_HASH,
    logsBloom: EMPTY_BLOOM,
    size: '0x0',
    uncles: [],
    transactions: full ? b.transactions.map(rpcTransaction) : b.transactions.map((t) => t.hash),
  };
}
