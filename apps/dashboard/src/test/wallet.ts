import { getAddress, isAddressEqual, numberToHex, type Address, type Hex } from 'viem';
import { ARC_CHAIN_ID, RpcError, type FixtureChain } from './chain';
import { label } from './fixtures';

// The injected EIP-1193 wallet for the /test-ui/ chain fixture and the browser tests
// (FRONTEND-PLAN stage 1, output/FRONTEND-CONTRACT.md). It holds no key and signs
// nothing: an approved eth_sendTransaction hands the unsigned request to the in-page
// FixtureChain, and every signing method is refused. Each request that needs consent
// waits for approve() or decline(), as a wallet window would.

export const OTHER_ACCOUNT = getAddress(label('FIXTURE-OTHER-ACCOUNT', 20));
export const OTHER_CHAIN = { id: 1, name: 'Ethereum' } as const;
const CHAINS: Record<number, string> = { [ARC_CHAIN_ID]: 'Arc Testnet', [OTHER_CHAIN.id]: OTHER_CHAIN.name };
const SIGNING = new Set(['eth_sign', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_signTransaction', 'eth_sendRawTransaction']);

export type WalletPrompt = { id: number; method: string; summary: string };
type Waiting = WalletPrompt & { resolve: () => void; reject: (error: RpcError) => void };
type Listener = (...args: unknown[]) => void;
type SendRequest = { from?: string; to?: string | null; data?: Hex; input?: Hex; value?: Hex; gas?: Hex };

export class FixtureWallet {
  readonly isSignaFixture = true;
  account: Address;
  chainId: number;
  connected = false;
  private waiting: Waiting[] = [];
  private prompts = 0;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly subscribers = new Set<(message: string) => void>();

  constructor(readonly chain: FixtureChain, options: { account?: Address; chainId?: number } = {}) {
    this.account = options.account ?? chain.addresses.operator;
    this.chainId = options.chainId ?? ARC_CHAIN_ID;
  }

  get pending(): readonly WalletPrompt[] {
    return this.waiting.map(({ id, method, summary }) => ({ id, method, summary }));
  }

  get chainName(): string {
    return CHAINS[this.chainId] ?? `chain ${this.chainId}`;
  }

  async request({ method, params }: { method: string; params?: readonly unknown[] | object }): Promise<unknown> {
    const p: readonly unknown[] = Array.isArray(params) ? params : [];
    switch (method) {
      case 'eth_accounts':
        return this.connected ? [this.account] : [];
      case 'eth_chainId':
        return numberToHex(this.chainId);
      case 'net_version':
        return String(this.chainId);
      case 'eth_requestAccounts':
        if (!this.connected) await this.connect(method);
        return [this.account];
      case 'wallet_requestPermissions':
        await this.connect(method);
        return [this.permission()];
      case 'wallet_getPermissions':
        return this.connected ? [this.permission()] : [];
      case 'wallet_revokePermissions':
        this.connected = false;
        this.notify('The page’s permission was revoked');
        return null;
      case 'wallet_switchEthereumChain': {
        const id = Number((p[0] as { chainId?: string } | undefined)?.chainId);
        if (!CHAINS[id]) throw new RpcError(4902, `The fixture wallet does not know chain ${id}.`);
        if (id !== this.chainId) {
          await this.ask(method, `Switch the wallet to ${CHAINS[id]}`);
          this.setChain(id);
        }
        return null;
      }
      case 'eth_sendTransaction': {
        const tx = p[0] as SendRequest | undefined;
        if (!this.connected) throw new RpcError(4100, 'The fixture wallet has not connected this page.');
        if (!tx?.from || !isAddressEqual(tx.from as Address, this.account)) throw new RpcError(4100, 'The request names an account the wallet has not selected.');
        if (this.chainId !== ARC_CHAIN_ID) throw new RpcError(4901, `The wallet is on ${this.chainName}, not Arc Testnet.`);
        const to = tx.to ? getAddress(tx.to) : null;
        const input = tx.data ?? tx.input ?? '0x';
        await this.ask(method, `Send ${this.chain.describe(to, input)}`);
        return this.chain.submit({ from: this.account, to, input, value: tx.value ? BigInt(tx.value) : 0n, ...(tx.gas ? { gas: BigInt(tx.gas) } : {}) });
      }
    }
    if (SIGNING.has(method)) throw new RpcError(4200, 'The UI fixture wallet holds no key and signs nothing.');
    if (method.startsWith('eth_')) {
      if (this.chainId !== ARC_CHAIN_ID) throw new RpcError(4901, `The wallet is on ${this.chainName}; the fixture has no node for it.`);
      return this.chain.request({ method, params: p });
    }
    throw new RpcError(4200, `The UI fixture wallet does not support ${method}.`);
  }

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  removeListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  subscribe(listener: (message: string) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Answers the oldest waiting request as the wallet's user would. */
  approve(): void {
    const next = this.next();
    this.notify(`Approved in wallet: ${next.summary}`);
    next.resolve();
  }

  decline(): void {
    const next = this.next();
    this.notify(`Declined in wallet: ${next.summary}`);
    next.reject(new RpcError(4001, 'User rejected the request.'));
  }

  /** Changes made in the wallet itself, which the page learns of through events. */
  useAccount(account: Address): void {
    this.account = getAddress(account);
    this.notify(`Wallet account changed to ${this.account}`);
    if (this.connected) this.emit('accountsChanged', [this.account]);
  }

  moveToChain(id: number): void {
    this.setChain(id);
  }

  disconnectFromWallet(): void {
    this.connected = false;
    this.notify('Disconnected in the wallet');
    this.emit('accountsChanged', []);
  }

  private async connect(method: string): Promise<void> {
    await this.ask(method, 'Connect this page to the fixture wallet');
    this.connected = true;
    this.notify('Connected to this page');
  }

  private permission() {
    return { parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [this.account] }] };
  }

  private ask(method: string, summary: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ id: ++this.prompts, method, summary, resolve, reject });
      this.notify(`Wallet request: ${summary}`);
    });
  }

  private next(): Waiting {
    const next = this.waiting.shift();
    if (!next) throw new Error('No wallet request is waiting.');
    return next;
  }

  private setChain(id: number): void {
    this.chainId = id;
    this.notify(`Wallet network changed to ${this.chainName}`);
    this.emit('chainChanged', numberToHex(id));
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  private notify(message: string): void {
    for (const listener of this.subscribers) listener(message);
  }
}
