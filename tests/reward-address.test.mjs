import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAddress, deriveSmartWallet, deriveRewardAddress, inspectAddress, inspectRewardAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Deterministic credential bytes: payment = 28 bytes of 0x11, stake = 28 of 0x22.
const PAY = Array(28).fill(0x11);
const STK = Array(28).fill(0x22);
const PAY_HEX = '11'.repeat(28);
const STK_HEX = '22'.repeat(28);
const addr = (type, network = 0, pay = PAY, stk = STK) =>
  encodeAddress(Uint8Array.from([(type << 4) | network, ...pay, ...(type < 4 ? stk : [])]));

test('a key-stake base address derives its CIP-19 reward address byte for byte', () => {
  const derived = deriveRewardAddress(addr(0, 0));
  // Header 0xe0 = type 14 (key) on testnet (network 0), then the stake bytes.
  assert.equal(derived.hex, 'e0' + STK_HEX);
  assert.equal(derived.type, 14);
  assert.equal(derived.credential, 'key');
  assert.equal(derived.hash, STK_HEX);
  assert.equal(derived.network, 0);
  assert.equal(derived.networkName, 'Testnet');
  assert.equal(derived.byteLength, 29);
  assert.ok(derived.address.startsWith('stake_test1'));
  // The payment credential plays no part: a different payment hash, same stake, same reward.
  const other = deriveRewardAddress(addr(0, 0, Array(28).fill(0x33)));
  assert.equal(other.address, derived.address);
  assert.equal(other.hex, derived.hex);
});

test('the stake credential alone picks the header type — script stake derives type 15', () => {
  // Type 2: key payment, script stake → script reward, header 0xf0.
  const scriptStake = deriveRewardAddress(addr(2, 0));
  assert.equal(scriptStake.hex, 'f0' + STK_HEX);
  assert.equal(scriptStake.type, 15);
  assert.equal(scriptStake.credential, 'script');
  // Type 3: script payment AND script stake → still the stake that governs.
  assert.equal(deriveRewardAddress(addr(3, 0)).type, 15);
  // Type 1: script payment, key stake → key reward; the payment being a
  // script must not leak into the reward address.
  const keyStake = deriveRewardAddress(addr(1, 0));
  assert.equal(keyStake.type, 14);
  assert.equal(keyStake.credential, 'key');
  assert.equal(keyStake.hash, STK_HEX);
});

test('mainnet derives a stake1 address on network 1', () => {
  const derived = deriveRewardAddress(addr(0, 1));
  assert.equal(derived.hex, 'e1' + STK_HEX);
  assert.equal(derived.network, 1);
  assert.equal(derived.networkName, 'Mainnet');
  assert.ok(derived.address.startsWith('stake1'));
  assert.ok(!derived.address.startsWith('stake_test'));
});

test('every derived reward address round-trips through the reward inspector', () => {
  for (const type of [0, 1, 2, 3]) {
    for (const network of [0, 1]) {
      const derived = deriveRewardAddress(addr(type, network));
      const viaBech32 = inspectRewardAddress(derived.address);
      assert.equal(viaBech32.hash, STK_HEX);
      assert.equal(viaBech32.credential, derived.credential);
      assert.equal(viaBech32.type, derived.type);
      assert.equal(viaBech32.network, network);
      assert.equal(viaBech32.address, derived.address);
      // CIP-30 hands reward addresses back as hex; that form inspects identically.
      const viaHex = inspectRewardAddress(derived.hex);
      assert.deepEqual(viaHex, viaBech32);
    }
  }
});

test('enterprise addresses have no stake credential, so derivation is refused', () => {
  for (const type of [6, 7]) {
    assert.throws(() => deriveRewardAddress(addr(type)), /Enterprise addresses carry no stake credential/);
    assert.throws(() => deriveRewardAddress(addr(type)), /no reward address can be derived/);
  }
});

test('the inspector carries the derived reward address for base addresses only', () => {
  for (const type of [0, 1, 2, 3]) {
    const a = addr(type);
    assert.equal(inspectAddress(a).rewardAddress, deriveRewardAddress(a).address);
  }
  for (const type of [6, 7]) {
    assert.equal(inspectAddress(addr(type)).rewardAddress, null);
  }
});

test('a CIP-113 smart wallet’s reward address is built from the owner credential', () => {
  // deriveSmartWallet places the owner's original PAYMENT credential in the
  // stake position, so the smart wallet's reward address is the owner's.
  const owner = addr(0, 0);
  const smart = deriveSmartWallet(owner, 'ab'.repeat(28), 0);
  const derived = deriveRewardAddress(smart);
  assert.equal(derived.hash, PAY_HEX);
  assert.equal(derived.credential, 'key');
  assert.equal(derived.sourceType, 1);
  // And it equals the reward address of a base address whose stake
  // credential IS that payment credential (payment = stake = PAY here).
  assert.equal(derived.address, deriveRewardAddress(addr(0, 0, PAY, PAY)).address);
});

test('derivation refuses inputs that are not payment addresses', () => {
  const reward = deriveRewardAddress(addr(0, 0)).address;
  assert.throws(() => deriveRewardAddress(reward), /payment address/);
  assert.throws(() => deriveRewardAddress(''), /payment address/);
  assert.throws(() => deriveRewardAddress('not-an-address'), /payment address|checksum/);
  const a = addr(0, 0);
  const tampered = a.slice(0, -1) + (a.endsWith('q') ? 'p' : 'q');
  assert.throws(() => deriveRewardAddress(tampered), /checksum/i);
});

test('the network page renders the derived reward address in the inspector result', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Reward \(stake\) address/);
  assert.match(app, /info\.rewardAddress/);
  // Honesty copy travels with the feature: construction, not registration.
  assert.match(app, /constructed locally from the stake credential alone/);
  assert.match(app, /registers no stake certificate and delegates nothing/);
  assert.match(app, /no reward address can be derived/);
});
