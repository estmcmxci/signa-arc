import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertFixtureContext, FIXTURE_STATES, fixtureSnapshot, fixtureVerdict } from '../src/test/fixtures.ts';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const SENDER = '0x0000000000000000000000000000000000000001' as const;
const UNIT = 1_000_000n;
const readable = FIXTURE_STATES.filter((state) => state !== 'rpc-error');

async function verdict(state: string, amount = UNIT) {
  const { block } = await fixtureSnapshot('compliant', NOW, 0);
  return fixtureVerdict(state, amount, SENDER, block, 0);
}

test('every state the desk offers is a labelled fabrication or a deliberate read failure', async () => {
  for (const state of FIXTURE_STATES) {
    if (state === 'rpc-error') {
      await assert.rejects(fixtureSnapshot(state, NOW, 0), /No RPC endpoint was contacted/);
      continue;
    }
    const snapshot = await fixtureSnapshot(state, NOW, 0);
    assert.equal(snapshot.mode, 'fixture', state);
    assert.match(snapshot.block.hash, /^0x4649585455524/, `${state} block hash decodes to FIXTURE`);
  }
  await assert.rejects(fixtureSnapshot('not-a-state', NOW, 0), /Unknown UI fixture state/);
});

test('no fixture verdict carries a transaction request', async () => {
  for (const state of readable) {
    for (const amount of [1n, UNIT, 10n * UNIT]) {
      assert.equal('request' in (await verdict(state, amount)), false, `${state} ${amount}`);
    }
  }
});

test('held states name the rule the vault enforces', async () => {
  assert.equal((await verdict('compliant')).kind, 'permitted');
  assert.deepEqual((await verdict('cure')).args, [2]);
  assert.deepEqual((await verdict('breach')).args, [3]);
  // A waiver permits while coverage is below policy; its lapse falls back to CURE.
  assert.equal((await verdict('waived')).kind, 'permitted');
  assert.deepEqual((await verdict('expired-waiver')).args, [2]);
  for (const state of ['stale', 'missing', 'revoked', 'maturity']) {
    assert.equal((await verdict(state)).code, 'DrawNotAllowed', state);
  }
  const reserve = await verdict('reserve');
  assert.deepEqual([reserve.code, reserve.args], ['ReserveViolation', [500_000n, UNIT, 500_000n]]);
  const tooLarge = await verdict('compliant', 3n * UNIT);
  assert.deepEqual([tooLarge.code, tooLarge.args], ['ReserveViolation', [3n * UNIT, 3n * UNIT, 500_000n]]);
});

test('a failed read is reported as unavailable, never as zero', async () => {
  const partial = await fixtureSnapshot('partial', NOW, 0);
  assert.equal(partial.coverage, null);
  assert.equal(partial.available, null);
  assert.deepEqual(partial.issues, ['evaluate', 'availableToDraw']);
});

test('fixtures refuse every browser context except the development /test-ui/ entry', () => {
  assert.doesNotThrow(() => assertFixtureContext(true, '/test-ui/'));
  for (const [dev, pathname] of [[false, '/test-ui/'], [true, '/app/'], [undefined, '/']] as const) {
    assert.throws(() => assertFixtureContext(dev, pathname), /development \/test-ui\/ entry/);
  }
});

test('the fixture module cannot reach a wallet or a live client', async () => {
  const source = await readFile(new URL('../src/test/fixtures.ts', import.meta.url), 'utf8');
  for (const forbidden of ['wagmi', '../data/client', 'createWalletClient', 'createPublicClient', 'writeContract', 'sendTransaction', 'http(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
