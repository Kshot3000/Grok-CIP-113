import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, inspectAddress, deriveRewardAddress, deriveSmartWallet, encodeAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Deterministic credential bytes: payment = 28 bytes of 0x11, stake = 28 of 0x22.
const PAY_HEX = '11'.repeat(28);
const STK_HEX = '22'.repeat(28);
const addr = (type, network = 0, pay = Array(28).fill(0x11), stk = Array(28).fill(0x22)) =>
  encodeAddress(Uint8Array.from([(type << 4) | network, ...pay, ...(type < 4 ? stk : [])]));

test('a key/key base address is built byte for byte (header type 0)', () => {
  const built = buildAddress('key', PAY_HEX, 'key', STK_HEX, 0);
  assert.equal(built.type, 0);
  assert.equal(built.kind, 'Base');
  assert.equal(built.hex, '00' + PAY_HEX + STK_HEX);
  assert.equal(built.byteLength, 57);
  assert.equal(built.network, 0);
  assert.equal(built.networkName, 'Testnet');
  assert.ok(built.address.startsWith('addr_test1'));
  assert.equal(built.address, addr(0, 0));
  assert.deepEqual(built.payment, { credential: 'key', hash: PAY_HEX });
  assert.deepEqual(built.stake, { credential: 'key', hash: STK_HEX });
  assert.equal(built.smartWalletShape, false);
});

test('the credential kinds alone pick the header type — all six types', () => {
  assert.equal(buildAddress('key', PAY_HEX, 'key', STK_HEX, 0).type, 0);
  assert.equal(buildAddress('script', PAY_HEX, 'key', STK_HEX, 0).type, 1);
  assert.equal(buildAddress('key', PAY_HEX, 'script', STK_HEX, 0).type, 2);
  assert.equal(buildAddress('script', PAY_HEX, 'script', STK_HEX, 0).type, 3);
  assert.equal(buildAddress('key', PAY_HEX, null, null, 0).type, 6);
  assert.equal(buildAddress('script', PAY_HEX, null, null, 0).type, 7);
  // Only a script payment on a BASE address is the smart-wallet shape;
  // an enterprise script address has no stake position to carry an owner.
  assert.equal(buildAddress('script', PAY_HEX, 'key', STK_HEX, 0).smartWalletShape, true);
  assert.equal(buildAddress('script', PAY_HEX, null, null, 0).smartWalletShape, false);
  assert.equal(buildAddress('script', PAY_HEX, null, null, 0).byteLength, 29);
  assert.equal(buildAddress('script', PAY_HEX, null, null, 0).stake, null);
  assert.equal(buildAddress('script', PAY_HEX, null, null, 0).rewardAddress, null);
});

test('every built address inspects back to exactly its inputs (round-trip)', () => {
  const combos = [
    ['key', 'key'], ['script', 'key'], ['key', 'script'], ['script', 'script'],
    ['key', null], ['script', null],
  ];
  for (const [pay, stk] of combos) {
    for (const network of [0, 1]) {
      const built = buildAddress(pay, PAY_HEX, stk, stk ? STK_HEX : null, network);
      const inspected = inspectAddress(built.address);
      assert.equal(inspected.type, built.type);
      assert.equal(inspected.kind, built.kind);
      assert.equal(inspected.network, network);
      assert.deepEqual(inspected.payment, built.payment);
      assert.deepEqual(inspected.stake, built.stake);
      assert.equal(inspected.rewardAddress, built.rewardAddress);
      assert.equal(inspected.smartWalletShape, built.smartWalletShape);
      // Building the inspected parts again reproduces the same address.
      const rebuilt = buildAddress(
        inspected.payment.credential, inspected.payment.hash,
        inspected.stake?.credential ?? null, inspected.stake?.hash ?? null,
        inspected.network,
      );
      assert.equal(rebuilt.address, built.address);
      assert.equal(rebuilt.hex, built.hex);
    }
  }
});

test("a built base address's reward address is the one derived from it", () => {
  for (const [pay, stk] of [['key', 'key'], ['script', 'key'], ['key', 'script'], ['script', 'script']]) {
    const built = buildAddress(pay, PAY_HEX, stk, STK_HEX, 0);
    assert.equal(built.rewardAddress, deriveRewardAddress(built.address).address);
    assert.equal(deriveRewardAddress(built.address).credential, stk);
    assert.equal(deriveRewardAddress(built.address).hash, STK_HEX);
  }
});

test('the smart wallet derivation is the builder with a script payment (CIP-113 tie-in)', () => {
  // deriveSmartWallet places the base script hash in the payment position
  // and the owner's original payment credential — kind included — in the
  // stake position, so the general builder reproduces it exactly.
  const owner = addr(0, 0);
  const smart = deriveSmartWallet(owner, 'ab'.repeat(28), 0);
  assert.equal(buildAddress('script', 'ab'.repeat(28), 'key', PAY_HEX, 0).address, smart);
  // A script-payment owner yields a script stake credential (header type 3).
  const scriptOwner = addr(1, 0);
  const smart3 = deriveSmartWallet(scriptOwner, 'ab'.repeat(28), 0);
  assert.equal(buildAddress('script', 'ab'.repeat(28), 'script', PAY_HEX, 0).address, smart3);
});

test('mainnet builds an addr1 address on network 1', () => {
  const built = buildAddress('key', PAY_HEX, 'key', STK_HEX, 1);
  assert.ok(built.address.startsWith('addr1'));
  assert.ok(!built.address.startsWith('addr_test'));
  assert.equal(built.hex, '01' + PAY_HEX + STK_HEX);
  assert.ok(built.rewardAddress.startsWith('stake1'));
});

test('a credential hash that is not exactly 28 bytes is refused with its count', () => {
  assert.throws(() => buildAddress('key', '11'.repeat(27), 'key', STK_HEX, 0), /Payment credential hash must be exactly 28 bytes.*got 27 bytes/);
  assert.throws(() => buildAddress('key', PAY_HEX, 'key', '22'.repeat(29), 0), /Stake credential hash must be exactly 28 bytes.*got 29 bytes/);
  assert.throws(() => buildAddress('key', 'zz'.repeat(28), 'key', STK_HEX, 0), /Payment credential hash must be exactly 28 bytes/);
  assert.throws(() => buildAddress('key', '1'.repeat(55), 'key', STK_HEX, 0), /Payment credential hash must be exactly 28 bytes/);
  assert.throws(() => buildAddress('key', '', 'key', STK_HEX, 0), /Payment credential hash must be exactly 28 bytes/);
});

test('a stake hash with no stake credential is refused, never silently dropped', () => {
  // Dropping it would build an enterprise address — different staking
  // rights from the base address the builder described.
  assert.throws(() => buildAddress('key', PAY_HEX, null, STK_HEX, 0), /silently dropped/);
  assert.throws(() => buildAddress('key', PAY_HEX, null, STK_HEX, 0), /enterprise address carries no stake credential/);
  // And the mirror image: a stake kind chosen with no hash is refused too.
  assert.throws(() => buildAddress('key', PAY_HEX, 'key', '', 0), /no stake hash was supplied/);
  assert.throws(() => buildAddress('key', PAY_HEX, 'key', null, 0), /no stake hash was supplied/);
  // An empty stake hash with no stake credential is a valid enterprise build.
  assert.equal(buildAddress('key', PAY_HEX, null, '', 0).type, 6);
});

test('invalid credential kinds and networks are refused', () => {
  assert.throws(() => buildAddress('pointer', PAY_HEX, 'key', STK_HEX, 0), /Payment credential must be/);
  assert.throws(() => buildAddress('key', PAY_HEX, 'pointer', STK_HEX, 0), /Stake credential must be/);
  assert.throws(() => buildAddress('key', PAY_HEX, 'key', STK_HEX, 2), /Network must be 0/);
  assert.throws(() => buildAddress('key', PAY_HEX, 'key', STK_HEX, '0'), /Network must be 0/);
});

test('uppercase hashes build the same address as lowercase', () => {
  const lower = buildAddress('key', PAY_HEX, 'key', STK_HEX, 0);
  const upper = buildAddress('key', PAY_HEX.toUpperCase(), 'key', STK_HEX.toUpperCase(), 0);
  assert.equal(upper.address, lower.address);
  assert.equal(upper.payment.hash, PAY_HEX);
});

test('the network page renders the address builder in the inspector panel', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Build an address/);
  assert.match(app, /address-build-payment-hash/);
  assert.match(app, /address-built/);
  assert.match(app, /addressBuildPreview/);
  // Honesty copy travels with the feature: construction, not creation.
  assert.match(app, /does not create a wallet or key/);
  assert.match(app, /registers no stake credential, and delegates nothing/);
  assert.match(app, /a script hash names no script until a deployed script hashes to it/);
  assert.match(app, /inspects back to exactly these credentials/);
});
