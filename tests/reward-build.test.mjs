import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, buildRewardAddress, deriveRewardAddress, deriveSmartWallet, inspectRewardAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Deterministic credential bytes: payment = 28 bytes of 0x11, stake = 28 of 0x22.
const PAY_HEX = '11'.repeat(28);
const STK_HEX = '22'.repeat(28);

test('a key stake credential builds its CIP-19 reward address byte for byte', () => {
  const built = buildRewardAddress('key', STK_HEX, 0);
  // Header 0xe0 = type 14 (key) on testnet (network 0), then the stake bytes.
  assert.equal(built.hex, 'e0' + STK_HEX);
  assert.equal(built.address, 'stake_test1uq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw4fsh7');
  assert.equal(built.type, 14);
  assert.equal(built.credential, 'key');
  assert.equal(built.hash, STK_HEX);
  assert.equal(built.network, 0);
  assert.equal(built.networkName, 'Testnet');
  assert.equal(built.byteLength, 29);
});

test('the credential kind alone picks the header type — a script stake builds type 15', () => {
  const built = buildRewardAddress('script', STK_HEX, 0);
  assert.equal(built.hex, 'f0' + STK_HEX);
  assert.equal(built.type, 15);
  assert.equal(built.credential, 'script');
  assert.equal(built.address, 'stake_test17q3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs8a4sq7');
  // The same hash under the other kind is a different address — the kind is
  // part of the credential, never decoration.
  assert.notEqual(built.address, buildRewardAddress('key', STK_HEX, 0).address);
});

test('mainnet builds a stake1 address on network 1', () => {
  const built = buildRewardAddress('key', STK_HEX, 1);
  assert.equal(built.hex, 'e1' + STK_HEX);
  assert.equal(built.network, 1);
  assert.equal(built.networkName, 'Mainnet');
  assert.equal(built.address, 'stake1uy3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsflrjnr');
  assert.ok(!built.address.startsWith('stake_test'));
});

test('every built reward address round-trips through the reward inspector', () => {
  for (const credential of ['key', 'script']) {
    for (const network of [0, 1]) {
      const built = buildRewardAddress(credential, STK_HEX, network);
      const viaBech32 = inspectRewardAddress(built.address);
      assert.equal(viaBech32.hash, STK_HEX);
      assert.equal(viaBech32.credential, credential);
      assert.equal(viaBech32.type, built.type);
      assert.equal(viaBech32.network, network);
      assert.equal(viaBech32.address, built.address);
      // CIP-30 hands reward addresses back as hex; that form inspects
      // identically apart from the recorded input form.
      const viaHex = inspectRewardAddress(built.hex);
      assert.equal(viaHex.inputForm, 'hex');
      const { inputForm: _f, ...hexRest } = viaHex;
      const { inputForm: _g, ...bechRest } = viaBech32;
      assert.deepEqual(hexRest, bechRest);
    }
  }
});

test('the standalone builder is exactly the derivation from a base address', () => {
  // For every base type, building from the stake credential alone must give
  // the address deriveRewardAddress derives from the whole payment address —
  // the two constructions are the same bytes, or one of them is wrong.
  for (const [payment, stake, type] of [['key', 'key', 0], ['script', 'key', 1], ['key', 'script', 2], ['script', 'script', 3]]) {
    for (const network of [0, 1]) {
      const base = buildAddress(payment, PAY_HEX, stake, STK_HEX, network);
      assert.equal(base.type, type);
      assert.equal(buildRewardAddress(stake, STK_HEX, network).address, base.rewardAddress);
      assert.equal(buildRewardAddress(stake, STK_HEX, network).address, deriveRewardAddress(base.address).address);
      assert.equal(buildRewardAddress(stake, STK_HEX, network).hex, deriveRewardAddress(base.address).hex);
    }
  }
});

test('a CIP-113 smart wallet’s reward address builds from the owner credential alone', () => {
  // deriveSmartWallet places the owner's original PAYMENT credential in the
  // stake position, so the smart wallet's reward address is built from that
  // credential directly — key owner and script owner alike.
  const keyOwner = buildAddress('key', PAY_HEX, 'key', '33'.repeat(28), 0).address;
  const smartKey = deriveSmartWallet(keyOwner, 'ab'.repeat(28), 0);
  assert.equal(buildRewardAddress('key', PAY_HEX, 0).address, deriveRewardAddress(smartKey).address);
  const scriptOwner = buildAddress('script', PAY_HEX, 'key', '33'.repeat(28), 0).address;
  const smartScript = deriveSmartWallet(scriptOwner, 'ab'.repeat(28), 0);
  assert.equal(buildRewardAddress('script', PAY_HEX, 0).address, deriveRewardAddress(smartScript).address);
});

test('uppercase hashes are canonicalised, never a different credential', () => {
  const upper = buildRewardAddress('key', STK_HEX.toUpperCase(), 0);
  assert.equal(upper.address, buildRewardAddress('key', STK_HEX, 0).address);
  assert.equal(upper.hash, STK_HEX);
});

test('a hash that is not exactly 28 bytes is refused with its actual byte count', () => {
  assert.throws(() => buildRewardAddress('key', '22'.repeat(27), 0), /exactly 28 bytes.*got 27 bytes/);
  assert.throws(() => buildRewardAddress('key', '22'.repeat(29), 0), /exactly 28 bytes.*got 29 bytes/);
  assert.throws(() => buildRewardAddress('script', '2222', 0), /exactly 28 bytes.*got 2 bytes/);
  assert.throws(() => buildRewardAddress('key', '', 0), /exactly 28 bytes/);
});

test('odd-length and non-hex hashes are refused rather than padded', () => {
  // Padding would change the bytes being identified — a different credential.
  assert.throws(() => buildRewardAddress('key', '2'.repeat(55), 0), /exactly 28 bytes/);
  assert.throws(() => buildRewardAddress('key', 'zz'.repeat(28), 0), /exactly 28 bytes/);
  assert.throws(() => buildRewardAddress('key', 42, 0), /exactly 28 bytes/);
  assert.throws(() => buildRewardAddress('key', null, 0), /exactly 28 bytes/);
});

test('unknown credential kinds and networks are refused', () => {
  assert.throws(() => buildRewardAddress('none', STK_HEX, 0), /key hash or a script hash/);
  assert.throws(() => buildRewardAddress(null, STK_HEX, 0), /key hash or a script hash/);
  assert.throws(() => buildRewardAddress('key', STK_HEX, 2), /Network must be 0/);
  assert.throws(() => buildRewardAddress('key', STK_HEX, '0'), /Network must be 0/);
});

test('the network page renders the reward builder with its honesty boundary', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Build a reward \(stake\) address/);
  assert.match(app, /id="reward-build-credential"/);
  assert.match(app, /id="reward-build-hash"/);
  assert.match(app, /id="reward-built"/);
  assert.match(app, /buildRewardAddress/);
  // Honesty copy travels with the feature: construction, not registration.
  assert.match(app, /does not create a stake account or key, registers no stake certificate, and delegates to no pool/);
  assert.match(app, /whether this credential is registered or delegated is chain state/);
  assert.match(app, /a script hash names no script until a deployed script hashes to it/);
});
