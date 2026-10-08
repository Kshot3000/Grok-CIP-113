import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAddress, deriveSmartWallet, inspectAddress, bytesToHex, hexToBytes } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Deterministic credential bytes: payment = 28 bytes of 0x11, stake = 28 of 0x22.
const PAY = Array(28).fill(0x11);
const STK = Array(28).fill(0x22);
const PAY_HEX = '11'.repeat(28);
const STK_HEX = '22'.repeat(28);
const addr = (type, network = 0, pay = PAY, stk = STK) =>
  encodeAddress(Uint8Array.from([(type << 4) | network, ...pay, ...(type < 4 ? stk : [])]));

test('bytesToHex renders lowercase hex and rejects non-bytes', () => {
  assert.equal(bytesToHex(Uint8Array.from([0, 15, 16, 255])), '000f10ff');
  assert.equal(bytesToHex(hexToBytes('deadbeef')), 'deadbeef');
  assert.throws(() => bytesToHex([1, 2]), /Expected bytes/);
});

test('inspector decodes every supported CIP-19 type with exact credential hashes', () => {
  const cases = [
    [0, 'Base', 'key', 'key'], [1, 'Base', 'script', 'key'],
    [2, 'Base', 'key', 'script'], [3, 'Base', 'script', 'script'],
    [6, 'Enterprise', 'key', null], [7, 'Enterprise', 'script', null],
  ];
  for (const [type, kind, payCred, stkCred] of cases) {
    const a = addr(type);
    const info = inspectAddress(a);
    assert.equal(info.address, a);
    assert.equal(info.type, type);
    assert.equal(info.kind, kind);
    assert.equal(info.network, 0);
    assert.equal(info.networkName, 'Testnet');
    assert.equal(info.byteLength, type < 4 ? 57 : 29);
    assert.deepEqual(info.payment, { credential: payCred, hash: PAY_HEX });
    if (stkCred === null) {
      assert.equal(info.stake, null);
      assert.equal(info.ownerCredential, null);
    } else {
      assert.deepEqual(info.stake, { credential: stkCred, hash: STK_HEX });
    }
  }
});

test('inspector reports mainnet from the header nibble and hrp together', () => {
  const info = inspectAddress(addr(0, 1));
  assert.equal(info.network, 1);
  assert.equal(info.networkName, 'Mainnet');
  assert.ok(info.address.startsWith('addr1'));
});

test('smart-wallet shape is base + script payment only — never enterprise or key payment', () => {
  assert.equal(inspectAddress(addr(1)).smartWalletShape, true);
  assert.equal(inspectAddress(addr(3)).smartWalletShape, true);
  assert.equal(inspectAddress(addr(1)).ownerCredential, STK_HEX);
  assert.equal(inspectAddress(addr(3)).ownerCredential, STK_HEX);
  for (const t of [0, 2, 6, 7]) {
    const info = inspectAddress(addr(t));
    assert.equal(info.smartWalletShape, false, `type ${t} must not read as a smart-wallet shape`);
    assert.equal(info.ownerCredential, null);
  }
});

test('a derived CIP-113 smart wallet inspects back to its exact parts', () => {
  // Owner: a testnet base address with a key payment credential.
  const owner = addr(0, 0);
  const baseScriptHash = 'ab'.repeat(28);
  const derived = deriveSmartWallet(owner, baseScriptHash, 0);
  const info = inspectAddress(derived);
  assert.equal(info.smartWalletShape, true);
  assert.equal(info.kind, 'Base');
  assert.equal(info.type, 1); // script payment + key stake-position credential
  assert.equal(info.payment.hash, baseScriptHash);
  assert.equal(info.payment.credential, 'script');
  // The stake position carries the owner's original PAYMENT credential.
  assert.equal(info.ownerCredential, PAY_HEX);
  assert.equal(info.stake.hash, PAY_HEX);
  // A script-credential owner derives a type-3 address instead.
  const scriptOwner = deriveSmartWallet(addr(1, 0), baseScriptHash, 0);
  const info3 = inspectAddress(scriptOwner);
  assert.equal(info3.type, 3);
  assert.equal(info3.smartWalletShape, true);
  assert.equal(info3.ownerCredential, PAY_HEX);
});

test('inspector canonicalises uppercase Bech32 and rejects tampered or unsupported input', () => {
  const a = addr(0);
  const upper = inspectAddress(a.toUpperCase());
  assert.equal(upper.address, a);
  // Tamper with the final character: checksum must fail.
  const tampered = a.slice(0, -1) + (a.endsWith('q') ? 'p' : 'q');
  assert.throws(() => inspectAddress(tampered), /checksum/i);
  assert.throws(() => inspectAddress(''), /payment address/);
  assert.throws(() => inspectAddress('not-an-address'), /payment address|checksum/);
  assert.throws(() => inspectAddress(a.slice(0, 20) + 'Q' + a.slice(21)), /Mixed-case/);
  // Reward (type 14) addresses stay unsupported as payment addresses, as in
  // decodeAddress. (Pointer types 4/5 are supported since v1.43 — see
  // tests/pointer-address.test.mjs.)
  const reward = encodeAddress(Uint8Array.from([(14 << 4) | 0, ...PAY]));
  assert.throws(() => inspectAddress(reward), /base, enterprise, or pointer/);
});

test('the network page wires the inspector form and reuses it for derived addresses', async () => {
  const app = await read('src/app.js');
  assert.match(app, /id="inspect-form"/);
  assert.match(app, /id="inspect-address"/);
  assert.match(app, /event\.target\.id==='inspect-form'/);
  assert.match(app, /inspectResultView\(inspectAddress\(address\)\)/);
  // Honesty copy travels with the feature: shape is not membership, no lookup happens.
  assert.match(app, /Shape alone does not prove CIP-113 membership/);
  assert.match(app, /nothing was looked up on chain/);
  assert.match(app, /Decoded in this browser only/);
});
