import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPointerAddress, inspectAddress, deriveRewardAddress } from '../src/cardano.js';

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
};
const POINTER = { slot: 2498243, txIndex: 27, certIndex: 3 };
const HASH = {
  key: inspectAddress(OFFICIAL.mainnet4).payment.hash,
  script: inspectAddress(OFFICIAL.mainnet5).payment.hash,
};

test('building from the official vectors’ parts reproduces all four official pointer addresses', () => {
  const cases = [
    ['key', 1, OFFICIAL.mainnet4, 4],
    ['script', 1, OFFICIAL.mainnet5, 5],
    ['key', 0, OFFICIAL.testnet4, 4],
    ['script', 0, OFFICIAL.testnet5, 5],
  ];
  for (const [cred, network, expected, type] of cases) {
    const b = buildPointerAddress(cred, HASH[cred], POINTER, network);
    assert.equal(b.address, expected, `${cred} on network ${network}`);
    assert.equal(b.type, type);
    assert.equal(b.kind, 'Pointer');
    assert.equal(b.byteLength, 35); // 1 header + 28 payment + 6 pointer bytes
    assert.equal(b.network, network);
    assert.deepEqual(b.pointer, POINTER);
    assert.deepEqual(b.payment, { credential: cred, hash: HASH[cred] });
    assert.equal(b.stake, null);
    assert.equal(b.rewardAddress, null);
    assert.equal(b.smartWalletShape, false);
  }
});

test('every built address inspects back to exactly its inputs across the coordinate grid', () => {
  const grid = [
    [0, 0, 0], [1, 1, 1], [127, 0, 5], [128, 3, 0], [16383, 127, 2],
    [16384, 128, 1], [2498243, 27, 3], [200_000_000, 999, 17],
    [2 ** 32, 65535, 255], [Number.MAX_SAFE_INTEGER, 0, 0],
  ];
  for (const [slot, txIndex, certIndex] of grid) {
    for (const cred of ['key', 'script']) {
      const b = buildPointerAddress(cred, HASH[cred], { slot, txIndex, certIndex }, 0);
      const info = inspectAddress(b.address);
      assert.equal(info.address, b.address);
      assert.equal(info.kind, 'Pointer');
      assert.deepEqual(info.pointer, { slot, txIndex, certIndex }, `${cred} (${slot},${txIndex},${certIndex})`);
      assert.equal(info.payment.hash, HASH[cred]);
      assert.equal(info.payment.credential, cred);
      assert.equal(info.stake, null);
      assert.equal(info.rewardAddress, null);
      assert.equal(Buffer.from(b.hex, 'hex').length, b.byteLength);
    }
  }
});

test('the encoding is canonical: group boundaries land exactly where the parser expects them', () => {
  // 0 is the single byte 0x00; 127 is one group; 128 needs two groups
  // (0x81 0x00); 16384 needs three (0x81 0x80 0x00). A leading zero group
  // would be a second byte form of the same pointer — never emitted.
  const tail = (slot) => buildPointerAddress('key', HASH.key, { slot, txIndex: 0, certIndex: 0 }, 0).hex.slice(58);
  assert.equal(tail(0), '000000');
  assert.equal(tail(127), '7f0000');
  assert.equal(tail(128), '81000000');
  assert.equal(tail(16383), 'ff7f0000');
  assert.equal(tail(16384), '8180000000');
});

test('a built pointer address still derives no reward address', () => {
  const b = buildPointerAddress('key', HASH.key, POINTER, 1);
  assert.throws(() => deriveRewardAddress(b.address), /slot 2498243, transaction 27, certificate 3/);
  assert.throws(() => deriveRewardAddress(b.address), /no reward address can be derived locally/);
});

test('missing coordinates are refused, naming the one that is missing', () => {
  assert.throws(() => buildPointerAddress('key', HASH.key, { txIndex: 27, certIndex: 3 }, 0), /Slot is required/);
  assert.throws(() => buildPointerAddress('key', HASH.key, { slot: 1, certIndex: 3 }, 0), /Transaction index is required/);
  assert.throws(() => buildPointerAddress('key', HASH.key, { slot: 1, txIndex: 27 }, 0), /Certificate index is required/);
  assert.throws(() => buildPointerAddress('key', HASH.key, null, 0), /chain pointer is required/i);
  assert.throws(() => buildPointerAddress('key', HASH.key, [1, 2, 3], 0), /chain pointer is required/i);
});

test('fractional, negative, non-numeric, and unsafe coordinates are refused rather than rounded', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '2498243', 2 ** 53, null]) {
    assert.throws(() => buildPointerAddress('key', HASH.key, { slot: bad, txIndex: 0, certIndex: 0 }, 0), /Slot/, `slot=${String(bad)}`);
  }
  assert.throws(() => buildPointerAddress('key', HASH.key, { slot: 0, txIndex: -2, certIndex: 0 }, 0), /Transaction index must be a non-negative integer/);
  assert.throws(() => buildPointerAddress('key', HASH.key, { slot: 0, txIndex: 0, certIndex: 0.25 }, 0), /Certificate index must be a non-negative integer/);
  // The largest safe integer is accepted exactly — the parser's own limit.
  const b = buildPointerAddress('key', HASH.key, { slot: Number.MAX_SAFE_INTEGER, txIndex: 0, certIndex: 0 }, 0);
  assert.equal(inspectAddress(b.address).pointer.slot, Number.MAX_SAFE_INTEGER);
});

test('a payment hash that is not exactly 28 bytes is refused with its byte count', () => {
  assert.throws(() => buildPointerAddress('key', 'abcd', POINTER, 0), /exactly 28 bytes.*got 2 bytes/);
  assert.throws(() => buildPointerAddress('key', HASH.key + 'ab', POINTER, 0), /exactly 28 bytes.*got 29 bytes/);
  assert.throws(() => buildPointerAddress('key', 'zz'.repeat(28), POINTER, 0), /not even-length hexadecimal|exactly 28 bytes/);
});

test('unknown credential kinds and networks are refused', () => {
  assert.throws(() => buildPointerAddress('stake', HASH.key, POINTER, 0), /key hash or a script hash/);
  assert.throws(() => buildPointerAddress('key', HASH.key, POINTER, 2), /Network must be 0/);
  assert.throws(() => buildPointerAddress('key', HASH.key, POINTER, '0'), /Network must be 0/);
});

test('the network page wires the pointer builder with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /buildPointerAddress/);
  assert.match(app, /Build a pointer address/);
  assert.match(app, /id="pointer-built"/);
  assert.match(app, /id="pointer-build-slot"/);
  assert.match(app, /BUILT POINTER ADDRESS/);
  assert.match(app, /registers no stake certificate/);
  assert.match(app, /adds nothing on any chain/);
  assert.match(app, /reproducing an existing address byte for byte/);
});
