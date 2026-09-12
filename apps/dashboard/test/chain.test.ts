import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';
import { arcTestnet } from 'viem/chains';

import { answer, ARC_CHAIN_ID, CHAIN_ABI, chainAddresses, FixtureChain, type ReplacementReason } from '../src/test/chain.ts';
import { FIXTURE_STATES, fixtureSnapshot, fixtureVerdict } from '../src/test/fixtures.ts';
import { routeRequest } from '../src/test/harness.ts';
import { FixtureWallet, OTHER_ACCOUNT, OTHER_CHAIN } from './support/fixtureWallet.ts';

const root = new URL('../', import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8')) as unknown;
const manifest = (await json('../../deployments/arc-testnet.json')) as Parameters<typeof chainAddresses>[0] & { rpcUrl: string };
const abi = Object.fromEntries(
  await Promise.all(['CovenantVault', 'CoverageEngine', 'CredentialRegistry', 'FacilityRegistry', 'MockUSDC'].map(async (name) => [name, (await json(`src/data/abi/${name}.json`)) as Abi] as const)),
);
const errors = Object.values(abi).flat().filter((item) => item.type === 'error');
const vaultAbi = [...abi.CovenantVault!.filter((item) => item.type !== 'error'), ...errors] as Abi;
const A = chainAddresses(manifest);
const UNIT = 1_000_000n;
const NOW = Date.parse('2026-09-11T12:00:00.000Z');

// The same transport the /test-ui/ harness installs: viem's HTTP client, answered in-process.
function clients(state: string) {
  const chain = new FixtureChain(state, A, () => NOW);
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => new Response(await answer(chain, String(init?.body)), { headers: { 'Content-Type': 'application/json' } });
  const rpc = createPublicClient({ chain: arcTestnet, transport: http(manifest.rpcUrl, { fetchFn, retryCount: 0 }), batch: { multicall: true }, pollingInterval: 10 });
  const wallet = new FixtureWallet(chain);
  const signer = createWalletClient({ account: A.operator, chain: arcTestnet, transport: custom(wallet) });
  return { chain, rpc, wallet, signer };
}

async function prompted(wallet: FixtureWallet) {
  for (let i = 0; i < 200 && !wallet.pending.length; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(wallet.pending.length, 'the wallet shows a request');
}

async function connect(wallet: FixtureWallet) {
  const accounts = wallet.request({ method: 'eth_requestAccounts' });
  await prompted(wallet);
  wallet.approve();
  return accounts;
}

async function send(wallet: FixtureWallet, signer: ReturnType<typeof clients>['signer'], functionName: string, args: readonly unknown[], address: Address = A.vault) {
  const hash = signer.writeContract({ address, abi: address === A.vault ? vaultAbi : abi.MockUSDC!, functionName, args, chain: arcTestnet } as never);
  await prompted(wallet);
  wallet.approve();
  return hash;
}

function revert(error: unknown) {
  const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  assert.ok(reverted instanceof ContractFunctionRevertedError, String(error));
  return [reverted.data?.errorName, reverted.data?.args ?? []] as const;
}

function canonical(params: readonly AbiParameter[]): string {
  return params.map((p) => ('components' in p && p.components ? `(${canonical(p.components)})${p.type.slice(5)}` : p.type)).join(',');
}

test('the node declares the contract surface exactly as the generated ABIs do', () => {
  const generated = Object.values(abi).flat();
  for (const item of CHAIN_ABI) {
    if (item.type !== 'function' && item.type !== 'event' && item.type !== 'error') continue;
    if (item.type === 'function' && item.name === 'aggregate3') continue; // Multicall3, not a Signa contract
    const shape = (x: typeof item) => `${x.type} ${x.name}(${canonical(x.inputs)})${x.type === 'function' ? ` ${x.stateMutability} → ${canonical(x.outputs)}` : ''}${x.type === 'event' ? x.inputs.map((i) => (i.indexed ? 'i' : '-')).join('') : ''}`;
    const matches = generated.filter((g) => g.type === item.type && 'name' in g && g.name === item.name).map((g) => shape(g as typeof item));
    assert.ok(matches.includes(shape(item)), `${shape(item)} ∉ ${matches.join(' | ')}`);
  }
});

test('the desk’s snapshot reads decode from the node at a pinned block', async () => {
  for (const state of ['compliant', 'missing', 'partial', 'waived']) {
    const { rpc } = clients(state);
    const block = await rpc.getBlock();
    const expected = await fixtureSnapshot(state === 'partial' ? 'compliant' : state, NOW, 0);
    const reads = await rpc.multicall({
      blockNumber: block.number,
      allowFailure: true,
      contracts: [
        { address: A.facilityRegistry, abi: abi.FacilityRegistry!, functionName: 'getFacility', args: [A.facilityId] },
        { address: A.credentialRegistry, abi: abi.CredentialRegistry!, functionName: 'currentExposure', args: [A.facilityId] },
        { address: A.coverageEngine, abi: abi.CoverageEngine!, functionName: 'evaluate', args: [A.facilityId] },
        { address: A.vault, abi: vaultAbi, functionName: 'covenantState' },
        { address: A.vault, abi: vaultAbi, functionName: 'availableToDraw' },
        { address: A.vault, abi: vaultAbi, functionName: 'activeWaiver' },
        { address: A.settlementAsset, abi: abi.MockUSDC!, functionName: 'balanceOf', args: [A.vault] },
        { address: A.credentialRegistry, abi: abi.CredentialRegistry!, functionName: 'hedgeTradeIds', args: [A.facilityId] },
      ],
    });
    const [policy, exposure, coverage, covenantState, available, waiver, balance, ids] = reads;
    assert.equal((policy?.result as { operator: Address }).operator, A.operator, state);
    assert.equal((exposure?.result as { digest: Hex }).digest, expected.exposure!.digest, state);
    assert.equal(covenantState?.result, expected.state, state);
    assert.equal(waiver?.result, expected.activeWaiver, state);
    assert.equal(balance?.result, expected.balance, state);
    assert.equal((ids?.result as Hex[]).length, expected.hedges!.length, state);
    if (state === 'partial') {
      assert.deepEqual([coverage?.status, available?.status], ['failure', 'failure'], 'unavailable, never zero');
    } else {
      assert.equal((coverage?.result as { coverageBps: number }).coverageBps, expected.coverage!.coverageBps, state);
      assert.equal(available?.result, expected.available, state);
    }
  }
  const zero = (await clients('missing').rpc.readContract({ address: A.credentialRegistry, abi: abi.CredentialRegistry!, functionName: 'currentExposure', args: [A.facilityId] })) as { digest: Hex; credential: { observedAt: bigint } };
  assert.deepEqual([BigInt(zero.digest), zero.credential.observedAt], [0n, 0n], 'the all-zero record, as the registry returns it');
});

test('draw simulations revert with the vault’s errors, matching the snapshot fixtures', async () => {
  for (const state of FIXTURE_STATES.filter((s) => !['partial', 'rpc-error', 'slow'].includes(s))) {
    const { rpc } = clients(state);
    const { block } = await fixtureSnapshot('compliant', NOW, 0);
    const fixture = await fixtureVerdict(state, UNIT, A.operator, block, 0);
    const simulated = await rpc.simulateContract({ address: A.vault, abi: vaultAbi, functionName: 'draw', args: [UNIT], account: A.operator }).then(
      () => ['PERMITTED', []] as const,
      revert,
    );
    assert.deepEqual(simulated, [fixture.code, fixture.args], state);
  }
  const { rpc } = clients('compliant');
  assert.deepEqual(await rpc.simulateContract({ address: A.vault, abi: vaultAbi, functionName: 'draw', args: [UNIT], account: OTHER_ACCOUNT }).catch(revert), ['NotOperator', [OTHER_ACCOUNT]]);
  assert.deepEqual(await rpc.simulateContract({ address: A.vault, abi: vaultAbi, functionName: 'repay', args: [UNIT], account: A.operator }).catch(revert), ['TokenTransferFailed', []]);
  assert.deepEqual(await clients('cure').rpc.simulateContract({ address: A.vault, abi: vaultAbi, functionName: 'restoreCompliance', account: A.operator }).catch(revert), ['DrawNotAllowed', [2]]);
});

test('a transaction stays pending until a block is mined, then confirms against that block', async () => {
  const { chain, rpc, wallet, signer } = clients('compliant');
  assert.deepEqual(await connect(wallet), [A.operator]);
  const hash = await send(wallet, signer, 'draw', [UNIT]);
  assert.match(hash, /^0x4649585455524/, 'the hash decodes to FIXTURE');
  assert.equal(await rpc.getTransactionReceipt({ hash }).catch(() => null), null, 'pending');
  const waiting = rpc.waitForTransactionReceipt({ hash, pollingInterval: 10 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  chain.mine();
  const receipt = await waiting;
  assert.equal(receipt.status, 'success');
  const principal = (blockNumber: bigint) => rpc.readContract({ address: A.vault, abi: vaultAbi, functionName: 'principal', blockNumber });
  assert.deepEqual([await principal(receipt.blockNumber - 1n), await principal(receipt.blockNumber)], [2n * UNIT, 3n * UNIT]);
  assert.deepEqual(parseEventLogs({ abi: vaultAbi, logs: receipt.logs, strict: false }).map((log) => log.eventName), ['CovenantSynchronized', 'Drawn']);
});

test('viem recognises each replacement the fixture wallet makes', async () => {
  for (const reason of ['repriced', 'cancelled', 'replaced'] as ReplacementReason[]) {
    const { chain, rpc, wallet, signer } = clients('compliant');
    await connect(wallet);
    const hash = await send(wallet, signer, 'draw', [UNIT]);
    let seen: { reason: string; hash: Hex } | undefined;
    const waiting = rpc.waitForTransactionReceipt({ hash, pollingInterval: 10, onReplaced: (r) => (seen = { reason: r.reason, hash: r.transaction.hash }) });
    const replacement = await chain.replace(hash, reason);
    const receipt = await waiting;
    assert.deepEqual([seen?.reason, seen?.hash, receipt.transactionHash], [reason, replacement, replacement], reason);
    const principal = await rpc.readContract({ address: A.vault, abi: vaultAbi, functionName: 'principal' });
    assert.equal(principal, reason === 'repriced' ? 3n * UNIT : 2n * UNIT, `${reason}: only a repriced draw moves principal`);
  }
});

test('a transaction that passed simulation can still revert when mined', async () => {
  const { chain, rpc, wallet, signer } = clients('compliant');
  await connect(wallet);
  const hash = await send(wallet, signer, 'draw', [UNIT]);
  chain.revertNext = true;
  chain.mine();
  const receipt = await rpc.getTransactionReceipt({ hash });
  assert.deepEqual([receipt.status, receipt.logs.length], ['reverted', 0]);
  assert.equal(await rpc.readContract({ address: A.vault, abi: vaultAbi, functionName: 'principal' }), 2n * UNIT);
});

test('a declined wallet request surfaces 4001 below the top two error levels', async () => {
  const { wallet, signer } = clients('compliant');
  await connect(wallet);
  const sent = signer.writeContract({ address: A.vault, abi: vaultAbi, functionName: 'draw', args: [UNIT], chain: arcTestnet });
  await prompted(wallet);
  wallet.decline();
  const error = await sent.catch((e: unknown) => e);
  assert.ok(error instanceof BaseError);
  const shallow = (error as { code?: number }).code ?? (error as { cause?: { code?: number } }).cause?.code;
  assert.equal(shallow, undefined, 'a check of the error and its cause alone misses the rejection');
  assert.equal((error.walk((e) => (e as { code?: unknown }).code === 4001) as { code?: number } | null)?.code, 4001);
});

test('repayment approves first; a failed repayment leaves the approval standing', async () => {
  for (const repayment of ['success', 'reverted'] as const) {
    const { chain, rpc, wallet, signer } = clients('compliant');
    await connect(wallet);
    const allowance = () => rpc.readContract({ address: A.settlementAsset, abi: abi.MockUSDC!, functionName: 'allowance', args: [A.operator, A.vault] });
    assert.equal(await allowance(), 0n);
    const approval = await send(wallet, signer, 'approve', [A.vault, UNIT], A.settlementAsset);
    chain.mine();
    assert.equal((await rpc.getTransactionReceipt({ hash: approval })).status, 'success');
    assert.equal(await allowance(), UNIT);
    const repay = await send(wallet, signer, 'repay', [UNIT]);
    chain.revertNext = repayment === 'reverted';
    chain.mine();
    assert.equal((await rpc.getTransactionReceipt({ hash: repay })).status, repayment);
    const principal = await rpc.readContract({ address: A.vault, abi: vaultAbi, functionName: 'principal' });
    assert.deepEqual([principal, await allowance()], repayment === 'success' ? [UNIT, 0n] : [2n * UNIT, UNIT], repayment);
  }
});

test('the wallet asks before connecting or switching, reports changes as events and never signs', async () => {
  const { wallet } = clients('compliant');
  const events: unknown[][] = [];
  wallet.on('accountsChanged', (accounts) => events.push(['accounts', accounts]));
  wallet.on('chainChanged', (chainId) => events.push(['chain', chainId]));
  assert.deepEqual(await wallet.request({ method: 'eth_accounts' }), []);
  const declined = wallet.request({ method: 'eth_requestAccounts' });
  await prompted(wallet);
  wallet.decline();
  await assert.rejects(declined, (e: { code?: number }) => e.code === 4001);
  await connect(wallet);
  const switched = wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
  await prompted(wallet);
  wallet.approve();
  await switched;
  for (const method of ['eth_call', 'eth_sendTransaction']) {
    await assert.rejects(wallet.request({ method, params: [{ from: A.operator, to: A.vault }] }), (e: { code?: number }) => e.code === 4901, method);
  }
  await assert.rejects(wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }), (e: { code?: number }) => e.code === 4902);
  wallet.moveToChain(ARC_CHAIN_ID);
  wallet.useAccount(OTHER_ACCOUNT);
  await assert.rejects(wallet.request({ method: 'eth_sendTransaction', params: [{ from: A.operator, to: A.vault }] }), (e: { code?: number }) => e.code === 4100);
  wallet.disconnectFromWallet();
  assert.deepEqual(await wallet.request({ method: 'eth_accounts' }), []);
  assert.deepEqual(events, [['chain', '0x1'], ['chain', `0x${ARC_CHAIN_ID.toString(16)}`], ['accounts', [OTHER_ACCOUNT]], ['accounts', []]]);
  assert.equal(OTHER_CHAIN.id, 1);
  for (const method of ['personal_sign', 'eth_sign', 'eth_signTypedData_v4', 'eth_signTransaction', 'eth_sendRawTransaction']) {
    await assert.rejects(wallet.request({ method, params: [] }), (e: { code?: number }) => e.code === 4200, method);
  }
});

test('the page may reach only its own origin and the fixture node', async () => {
  const page = 'http://127.0.0.1:5174';
  const rpcUrls = [...arcTestnet.rpcUrls.default.http, manifest.rpcUrl];
  assert.equal(routeRequest('/src/app/main.tsx', page, rpcUrls), 'page');
  assert.equal(routeRequest('https://rpc.testnet.arc.network', page, rpcUrls), 'rpc');
  assert.equal(routeRequest('https://rpc.testnet.arc.network/', page, rpcUrls), 'rpc');
  for (const url of ['https://testnet.arcscan.app/api', 'https://rpc.testnet.arc.network.example.com/', 'http://127.0.0.1:5173/', 'https://example.com/']) {
    assert.equal(routeRequest(url, page, rpcUrls), 'blocked', url);
  }
  const chain = new FixtureChain('compliant', A, () => NOW);
  const batch = JSON.parse(await answer(chain, JSON.stringify([{ id: 1, method: 'eth_chainId' }, { id: 2, method: 'eth_sendRawTransaction', params: ['0x00'] }]))) as { id: number; result?: string; error?: { code: number } }[];
  assert.deepEqual(batch.map((r) => r.result ?? r.error?.code), [`0x${ARC_CHAIN_ID.toString(16)}`, -32601]);
  assert.equal(new FixtureChain('rpc-error', A).transport, 'fail');
  assert.equal(new FixtureChain('slow', A).transport, 'slow');
});

test('the chain fixture and dev harness hold no key and open no connection of their own', async () => {
  for (const file of ['chain', 'harness', 'entry']) {
    const source = await readFile(new URL(`src/test/${file}.ts`, root), 'utf8');
    for (const forbidden of ['wagmi', 'privateKey', 'mnemonic', 'createWalletClient', 'createPublicClient', 'signTransaction(', 'sendRawTransaction(', 'http(', '../data/client']) {
      assert.equal(source.includes(forbidden), false, `${file}: ${forbidden}`);
    }
    if (file === 'chain') {
      for (const forbidden of ['fetch(', 'WebSocket', 'XMLHttpRequest', 'navigator.']) assert.equal(source.includes(forbidden), false, `${file}: ${forbidden}`);
    }
  }
  // The test-only fixture wallet (test/support/fixtureWallet.ts) lives outside src/,
  // so it can never reach the bundle regardless of what it imports.
  const walletSource = await readFile(new URL('test/support/fixtureWallet.ts', root), 'utf8');
  for (const forbidden of ['privateKey', 'mnemonic', 'fetch(', 'WebSocket', 'XMLHttpRequest', 'navigator.']) {
    assert.equal(walletSource.includes(forbidden), false, `fixtureWallet: ${forbidden}`);
  }
});
