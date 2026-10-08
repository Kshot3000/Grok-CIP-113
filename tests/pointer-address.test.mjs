import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAddress, inspectAddress, deriveRewardAddress, decodeAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Official CIP-19 test vectors (cardano-foundation/CIPs, CIP-0019): the
// shared pointer is (slot 2498243, transaction 27, certificate 3), the
// type-04 payment credential is the type-00 vector's payment key hash, and
// the type-05 payment credential is the type-01 vector's script hash.
const OFFICIAL = {
  mainnet4: 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k',
  mainnet5: 'addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu',
  testnet4: 'addr_test1gz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrdw5vky',
  testnet5: 'addr_test12rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcryqrvmw',
  mainnet0: 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
  mainnet1: 'addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh',
};
const POINTER = { slot: 2498243, txIndex: 27, certIndex: 3 };
const PAY = Array(28).fill(0x11);

// Canonical variable-length encoding of a natural (test-side builder).
const vlq = (n) => {
  let v = BigInt(n);
  if (v === 0n) return [0];
  const groups = [];
  while (v > 0n) { groups.unshift(Number(v & 0x7fn)); v >>= 7n; }
  return groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
};
const pointerAddr = (type, network, slot, tx, cert, pay = PAY) =>
  encodeAddress(Uint8Array.from([(type << 4) | network, ...pay, ...vlq(slot), ...vlq(tx), ...vlq(cert)]));

test('the official CIP-19 pointer vectors decode to the published pointer', () => {
  const cases = [
    [OFFICIAL.mainnet4, 4, 1, 'Mainnet', 'key'],
    [OFFICIAL.mainnet5, 5, 1, 'Mainnet', 'script'],
    [OFFICIAL.testnet4, 4, 0, 'Testnet', 'key'],
    [OFFICIAL.testnet5, 5, 0, 'Testnet', 'script'],
  ];
  for (const [a, type, network, networkName, cred] of cases) {
    const info = inspectAddress(a);
    assert.equal(info.address, a);
    assert.equal(info.kind, 'Pointer');
    assert.equal(info.type, type);
    assert.equal(info.network, network);
    assert.equal(info.networkName, networkName);
    assert.equal(info.payment.credential, cred);
    assert.equal(info.byteLength, 35); // 1 header + 28 payment + 6 pointer bytes
    assert.deepEqual(info.pointer, POINTER);
    assert.equal(info.stake, null);
    assert.equal(info.rewardAddress, null);
    assert.equal(info.smartWalletShape, false);
    assert.equal(info.ownerCredential, null);
  }
});

test('pointer payment credentials are the base vectors’ payment credentials', () => {
  assert.equal(inspectAddress(OFFICIAL.mainnet4).payment.hash, inspectAddress(OFFICIAL.mainnet0).payment.hash);
  assert.equal(inspectAddress(OFFICIAL.mainnet5).payment.hash, inspectAddress(OFFICIAL.mainnet1).payment.hash);
  assert.equal(inspectAddress(OFFICIAL.testnet4).payment.hash, inspectAddress(OFFICIAL.mainnet4).payment.hash);
});

test('custom pointers round-trip across the coordinate grid', () => {
  const grid = [
    [0, 0, 0], [1, 1, 1], [127, 0, 5], [128, 3, 0], [16383, 127, 2],
    [16384, 128, 1], [2498243, 27, 3], [200_000_000, 999, 17], [2 ** 32, 65535, 255],
  ];
  for (const [slot, tx, cert] of grid) {
    for (const type of [4, 5]) {
      const a = pointerAddr(type, 0, slot, tx, cert);
      const info = inspectAddress(a);
      assert.equal(info.address, a);
      assert.deepEqual(info.pointer, { slot, txIndex: tx, certIndex: cert }, `type ${type} (${slot},${tx},${cert})`);
      assert.equal(info.payment.credential, type === 4 ? 'key' : 'script');
    }
  }
});

test('a script-payment pointer address is not a CIP-113 smart-wallet shape', () => {
  // Shape requires a BASE address: the stake position must carry the owner
  // credential, and a pointer address has no stake position at all.
  const info = inspectAddress(pointerAddr(5, 0, 100, 2, 1));
  assert.equal(info.payment.credential, 'script');
  assert.equal(info.smartWalletShape, false);
  assert.equal(info.ownerCredential, null);
});

test('no reward address is derived from a pointer — the refusal names the certificate location', () => {
  assert.throws(() => deriveRewardAddress(OFFICIAL.mainnet4), /Pointer addresses carry no stake credential/);
  assert.throws(() => deriveRewardAddress(OFFICIAL.mainnet4), /slot 2498243, transaction 27, certificate 3/);
  assert.throws(() => deriveRewardAddress(OFFICIAL.mainnet4), /only a chain lookup can resolve/);
  // Distinct from the enterprise refusal.
  assert.throws(() => deriveRewardAddress(OFFICIAL.mainnet4), /no reward address can be derived locally/);
});

test('a truncated pointer coordinate is refused, not read short', () => {
  // Final byte still carries the continuation bit: the number never ends.
  const bytes = Uint8Array.from([(4 << 4) | 0, ...PAY, ...vlq(2498243), 27, 0x81]);
  assert.throws(() => inspectAddress(encodeAddress(bytes)), /truncated/);
});

test('missing coordinates are refused', () => {
  // Header + payment credential only (29 bytes): no pointer at all.
  const bare = encodeAddress(Uint8Array.from([(4 << 4) | 0, ...PAY]));
  assert.throws(() => inspectAddress(bare), /too short/);
  // Two long coordinates and nothing else: the third read runs off the end.
  const two = encodeAddress(Uint8Array.from([(4 << 4) | 0, ...PAY, ...vlq(2498243), ...vlq(27)]));
  assert.throws(() => inspectAddress(two), /truncated/);
});

test('trailing bytes after the third coordinate are refused', () => {
  const bytes = Uint8Array.from([(4 << 4) | 0, ...PAY, ...vlq(100), ...vlq(2), ...vlq(1), 0]);
  assert.throws(() => inspectAddress(encodeAddress(bytes)), /trailing bytes/);
});

test('a non-canonical leading zero group is refused', () => {
  // 0x80 0x05 would decode to 5 with a wasted leading zero group: the same
  // pointer would have two byte forms, so the non-canonical one is refused.
  const bytes = Uint8Array.from([(4 << 4) | 0, ...PAY, 0x80, 0x05, 0, 0]);
  assert.throws(() => inspectAddress(encodeAddress(bytes)), /canonical/);
});

test('an oversized coordinate is refused rather than rounded', () => {
  const bytes = Uint8Array.from([(4 << 4) | 0, ...PAY, ...Array(10).fill(0xff), 0x01, 0, 0]);
  assert.throws(() => inspectAddress(encodeAddress(bytes)), /too large/);
});

test('Byron and reward addresses remain refused by the payment decoder', () => {
  const byron = encodeAddress(Uint8Array.from([(8 << 4) | 1, ...PAY]));
  assert.throws(() => decodeAddress(byron), /base, enterprise, or pointer/);
  const reward = encodeAddress(Uint8Array.from([(14 << 4) | 1, ...PAY]));
  assert.throws(() => inspectAddress(reward), /base, enterprise, or pointer/);
});

test('non-pointer inspections carry a null pointer', () => {
  const base = encodeAddress(Uint8Array.from([(0 << 4) | 0, ...PAY, ...Array(28).fill(0x22)]));
  assert.equal(inspectAddress(base).pointer, null);
  const enterprise = encodeAddress(Uint8Array.from([(6 << 4) | 0, ...PAY]));
  assert.equal(inspectAddress(enterprise).pointer, null);
});

test('the network page wires the pointer result with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Stake pointer/);
  assert.match(app, /None can be derived locally/);
  assert.match(app, /which credential it registered/);
  assert.match(app, /builder below only assembles the bytes to reproduce one/);
  assert.match(app, /registers no stake certificate and adds nothing on any chain/);
  assert.match(app, /the chain pointer a pointer address carries/);
});
