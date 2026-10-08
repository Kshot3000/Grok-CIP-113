import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, bytesToHex, decodeAddress, deriveRewardAddress, deriveSmartWallet, inspectAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The hex form of a Shelley address — its raw bytes as hexadecimal — is
// how CIP-30 wallet APIs and Koios return addresses. It encodes exactly
// the same bytes as Bech32, so every inspection of a hex input must equal
// the Bech32 inspection of the same address, except for the recorded
// input form. What hex does NOT carry is a checksum: that difference is
// part of the result, not a footnote.
const MAINNET0 = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const POINTER4 = 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k';
const PAY = '11'.repeat(28);
const STK = '22'.repeat(28);
const hexOf = (bech32) => bytesToHex(decodeAddress(bech32).bytes);
const withoutForm = ({ inputForm, ...rest }) => rest;

test('the official CIP-19 base vector inspects identically from its hex form', () => {
  const viaHex = inspectAddress(hexOf(MAINNET0));
  const viaBech32 = inspectAddress(MAINNET0);
  assert.equal(viaHex.inputForm, 'hex');
  assert.equal(viaBech32.inputForm, 'bech32');
  assert.deepEqual(withoutForm(viaHex), withoutForm(viaBech32));
  // The canonical address reported is the checksummed Bech32 form.
  assert.equal(viaHex.address, MAINNET0);
});

test('hex and Bech32 inspections agree across every built type and network', () => {
  for (const network of [0, 1]) {
    for (const [pay, stk] of [['key', 'key'], ['script', 'key'], ['key', 'script'], ['script', 'script'], ['key', null], ['script', null]]) {
      const built = buildAddress(pay, PAY, stk, stk ? STK : '', network);
      const viaHex = inspectAddress(built.hex);
      assert.equal(viaHex.inputForm, 'hex');
      assert.deepEqual(withoutForm(viaHex), withoutForm(inspectAddress(built.address)), `${pay}/${stk} net ${network}`);
      assert.equal(viaHex.address, built.address);
    }
  }
});

test('a pointer address inspects identically from its hex form', () => {
  const viaHex = inspectAddress(hexOf(POINTER4));
  assert.equal(viaHex.inputForm, 'hex');
  assert.equal(viaHex.kind, 'Pointer');
  assert.deepEqual(viaHex.pointer, { slot: 2498243, txIndex: 27, certIndex: 3 });
  assert.deepEqual(withoutForm(viaHex), withoutForm(inspectAddress(POINTER4)));
});

test('uppercase hex is canonicalised to the same address', () => {
  const hex = hexOf(MAINNET0);
  assert.equal(inspectAddress(hex.toUpperCase()).address, MAINNET0);
  assert.equal(inspectAddress(hex.toUpperCase()).inputForm, 'hex');
});

test('reward derivation accepts the hex form and derives the same address', () => {
  const built = buildAddress('key', PAY, 'script', STK, 1);
  assert.deepEqual(deriveRewardAddress(built.hex), deriveRewardAddress(built.address));
});

test('smart-wallet derivation accepts a hex-form owner address', () => {
  const owner = buildAddress('key', PAY, 'key', STK, 0);
  const script = 'ab'.repeat(28);
  assert.equal(deriveSmartWallet(owner.hex, script, 0), deriveSmartWallet(owner.address, script, 0));
});

test('hex has no checksum: a changed digit decodes to a different address instead of failing', () => {
  // This is the documented risk of the form, pinned so it can never be
  // mistaken for a verified decode: flip one payment byte and the hex
  // inspection SUCCEEDS with a different payment hash, while the same
  // flip in Bech32 fails its checksum.
  const hex = hexOf(MAINNET0);
  const flipped = hex.slice(0, 4) + (hex[4] === '0' ? '1' : '0') + hex.slice(5);
  const info = inspectAddress(flipped);
  assert.notEqual(info.payment.hash, inspectAddress(MAINNET0).payment.hash);
  assert.throws(() => inspectAddress(MAINNET0.slice(0, 10) + (MAINNET0[10] === 'q' ? 'p' : 'q') + MAINNET0.slice(11)), /checksum/);
});

test('odd-length hex is refused as hex, not misread as Bech32', () => {
  assert.throws(() => inspectAddress(hexOf(MAINNET0) + 'a'), /even number of characters/);
});

test('hex with a wrong length for its type is refused', () => {
  const built = buildAddress('key', PAY, 'key', STK, 0);
  const short = built.hex.slice(0, -2); // 56 bytes under a base header
  assert.throws(() => inspectAddress(short), /base, enterprise, or pointer/);
  const enterprise = buildAddress('key', PAY, null, '', 0);
  assert.throws(() => inspectAddress(enterprise.hex + '00'), /base, enterprise, or pointer/);
});

test('Byron and reward bytes in hex remain refused', () => {
  const byronHex = '81' + PAY;
  assert.throws(() => inspectAddress(byronHex), /base, enterprise, or pointer/);
  const rewardHex = 'e1' + STK;
  assert.throws(() => inspectAddress(rewardHex), /base, enterprise, or pointer/);
});

test('a bad network nibble in hex is refused', () => {
  const built = buildAddress('key', PAY, null, '', 0);
  const badNet = '6f' + built.hex.slice(2); // enterprise header, network 15
  assert.throws(() => inspectAddress(badNet), /network/);
});

test('non-hex, non-Bech32 input keeps the Bech32 errors', () => {
  assert.throws(() => inspectAddress('hello world'), /addr or addr_test/);
  assert.throws(() => inspectAddress('addr1qqqq'), /checksum|addr/);
});

test('the network page wires the hex form with its no-checksum copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /or hex\)/);
  assert.match(app, /Hex \(the CIP-30 form\) — no checksum/);
  assert.match(app, /Hex carries no checksum/);
  assert.match(app, /checksummed Bech32 form is the one to copy/);
});
