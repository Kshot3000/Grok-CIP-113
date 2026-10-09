import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { buildByronAddress, verifyByronAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The Byron address verifier: the checking half of buildByronAddress,
// and the last builder in PRISM to gain one. A claimed Byron address is
// rebuilt from the parts it is claimed to be built from — root, type,
// network discriminant, encrypted derivation-path ciphertext — and
// compared position by position, following the discipline of the other
// verifiers: a well-formed address built from different parts is a
// mismatch naming the position, while a claim that cannot be decoded
// or built at all is REFUSED, never a mismatch. Anchored externally on
// the same published addresses as the inspector and builder suites:
// the cardano-wallet design document's two worked examples, the CIP-19
// table example, and both SLIP-0023 addresses, each verified against
// its published parts — not parts read back out of the module.
const YOROI = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';
const YOROI_ROOT = 'ba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdd';
const DAEDALUS = '37btjrVyb4KEB2STADSsj3MYSAdj52X5FrFWpw2r7Wmj2GDzXjFRsHWuZqrw7zSkwopv8Ci3VWeg6bisU9dgJxW5hb2MZYeduNKbQJrqz3zVBsu9nT';
const DAEDALUS_ROOT = '9c708538a763ff27169987a489e35057ef3cd3778c05e96f7ba9450e';
const DAEDALUS_PATH = '9c1722f7e446689256e1a30260f3510d558d99d0c391f2ba89cb6977';
const TESTNET_DISCRIMINANT = 1097911063;
const PUBLISHED = [
  { address: YOROI, root: YOROI_ROOT, type: 0, discriminant: null, path: null },
  { address: DAEDALUS, root: DAEDALUS_ROOT, type: 0, discriminant: TESTNET_DISCRIMINANT, path: DAEDALUS_PATH },
  { address: '37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na', root: '7e9ee4a9527dea9091e2d580edd6716888c42f75d96276290f98fe0b', type: 0, discriminant: TESTNET_DISCRIMINANT, path: '0cdf39b531d1ac0963cbd183f63e43d895d16a9c567c95e1056e28bd' },
  { address: 'Ae2tdPwUPEZ1TjYcvfkWAbiHtGVxv4byEHHZoSyQXjPJ362DifCe1ykgqgy', root: '2ea63b3db3a1865f59c11762a5aede800ed8f2dc0605d75df2ed7c9c', type: 0, discriminant: null, path: null },
  { address: 'Ae2tdPwUPEZGXmSbda1kBNfyhRQGRcQxJFdk7mhWZXAGnapyejv2b2U3aRb', root: 'c5ad517f2d416a4c1253620dc1b93ae5d9cb0fce7e946445fa58c22d', type: 0, discriminant: null, path: null },
];
const ROOT42 = '42'.repeat(28);
const SHELLEY = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

// Test-side independent construction (literal payload bytes, Node's
// reference zlib.crc32, a local Base58 encoder — nothing borrowed from
// the module), as in the inspector suite: an address carrying an
// attribute the builder never writes can only be made this way.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  let zeros = 0; while (bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}
function buildByron(payloadBytes) {
  const payload = Uint8Array.from(payloadBytes);
  const crc = zlibCrc32(payload) >>> 0;
  return base58Encode(Uint8Array.from([0x82, 0xd8, 0x18, 0x58, payload.length, ...payload, 0x1a, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]));
}

test('every published Byron address verifies exactly against its published parts', () => {
  for (const v of PUBLISHED) {
    const r = verifyByronAddress(v.address, v.root, v.type, v.discriminant, v.path);
    assert.equal(r.match, true, v.address);
    assert.equal(r.rootMatch, true);
    assert.equal(r.typeMatch, true);
    assert.equal(r.networkMatch, true);
    assert.equal(r.derivationPathMatch, true);
    assert.deepEqual(r.unknownAttributes, []);
    assert.equal(r.builtAddress, v.address);
  }
});

test('every built Byron address verifies against its own inputs, across types and attribute combinations', () => {
  for (const type of [0, 1, 2]) {
    for (const [discriminant, path] of [[null, null], [42, null], [null, 'ab'.repeat(28)], [TESTNET_DISCRIMINANT, 'cd'.repeat(28)]]) {
      const built = buildByronAddress(ROOT42, type, discriminant, path);
      const r = verifyByronAddress(built.address, ROOT42, type, discriminant, path);
      assert.equal(r.match, true, `${type}/${discriminant}/${path ? 'path' : 'nopath'}`);
      assert.equal(r.builtAddress, built.address);
      assert.equal(r.checksumHex, built.checksumHex);
    }
  }
});

test('an uppercase hex root claim verifies — the builder normalises the claim, not the comparison', () => {
  const r = verifyByronAddress(YOROI, YOROI_ROOT.toUpperCase(), 0);
  assert.equal(r.match, true);
  assert.equal(r.claimedRoot, YOROI_ROOT);
});

test('a wrong root differs on the root position only', () => {
  const r = verifyByronAddress(YOROI, ROOT42, 0);
  assert.equal(r.match, false);
  assert.equal(r.rootMatch, false);
  assert.equal(r.typeMatch, true);
  assert.equal(r.networkMatch, true);
  assert.equal(r.derivationPathMatch, true);
  assert.equal(r.root, YOROI_ROOT);
  assert.equal(r.claimedRoot, ROOT42);
  assert.notEqual(r.builtAddress, r.address);
});

test('a wrong type differs on the type position only', () => {
  const r = verifyByronAddress(YOROI, YOROI_ROOT, 1);
  assert.equal(r.match, false);
  assert.equal(r.rootMatch, true);
  assert.equal(r.typeMatch, false);
  assert.equal(r.type, 0);
  assert.equal(r.claimedType, 1);
  assert.equal(r.claimedTypeName, 'Script');
});

test('a network difference alone differs on the network position, in both directions', () => {
  // A mainnet address claimed as a test-network one.
  const claimedTest = verifyByronAddress(YOROI, YOROI_ROOT, 0, TESTNET_DISCRIMINANT);
  assert.equal(claimedTest.match, false);
  assert.equal(claimedTest.networkMatch, false);
  assert.equal(claimedTest.rootMatch, true);
  assert.equal(claimedTest.networkDiscriminant, null);
  assert.equal(claimedTest.claimedNetworkDiscriminant, TESTNET_DISCRIMINANT);
  // A test-network address claimed as mainnet — its derivation path
  // still matches, because the path is a separate position.
  const claimedMain = verifyByronAddress(DAEDALUS, DAEDALUS_ROOT, 0, null, DAEDALUS_PATH);
  assert.equal(claimedMain.match, false);
  assert.equal(claimedMain.networkMatch, false);
  assert.equal(claimedMain.derivationPathMatch, true);
  assert.equal(claimedMain.networkDiscriminant, TESTNET_DISCRIMINANT);
  assert.equal(claimedMain.claimedNetworkDiscriminant, null);
});

test('discriminant 0 is a test-network claim, not mainnet: no discriminant is null, not zero', () => {
  const built = buildByronAddress(ROOT42, 0, 0);
  assert.equal(verifyByronAddress(built.address, ROOT42, 0, 0).match, true);
  const asMainnet = verifyByronAddress(built.address, ROOT42, 0, null);
  assert.equal(asMainnet.match, false);
  assert.equal(asMainnet.networkMatch, false);
});

test('a derivation-path difference differs on the path position only, in both directions', () => {
  // The address carries a path; the claim carries none.
  const dropped = verifyByronAddress(DAEDALUS, DAEDALUS_ROOT, 0, TESTNET_DISCRIMINANT, null);
  assert.equal(dropped.match, false);
  assert.equal(dropped.derivationPathMatch, false);
  assert.equal(dropped.networkMatch, true);
  assert.equal(dropped.hasDerivationPath, true);
  assert.equal(dropped.claimedDerivationPathCiphertext, null);
  // The claim carries a different ciphertext — compared as ciphertext,
  // so a single differing byte is a path mismatch, nothing more.
  const other = verifyByronAddress(DAEDALUS, DAEDALUS_ROOT, 0, TESTNET_DISCRIMINANT, 'ab'.repeat(28));
  assert.equal(other.match, false);
  assert.equal(other.derivationPathMatch, false);
  assert.equal(other.derivationPathCiphertext, DAEDALUS_PATH);
  // The address carries no path; the claim invents one.
  const invented = verifyByronAddress(YOROI, YOROI_ROOT, 0, null, 'ab'.repeat(28));
  assert.equal(invented.match, false);
  assert.equal(invented.derivationPathMatch, false);
  assert.equal(invented.rootMatch, true);
});

test('an address carrying an unrecognised attribute matches every named position yet does not match', () => {
  // Attribute key 7 with a two-byte value: the builder writes only keys
  // 1 and 2, so no claim can name this attribute — the verifier reports
  // it as its own verdict instead of leaving an unexplained difference.
  const candidate = buildByron([0x83, 0x58, 0x1c, ...Array(28).fill(0x42), 0xa1, 0x07, 0x42, 0xaa, 0xbb, 0x00]);
  const r = verifyByronAddress(candidate, ROOT42, 0);
  assert.equal(r.rootMatch, true);
  assert.equal(r.typeMatch, true);
  assert.equal(r.networkMatch, true);
  assert.equal(r.derivationPathMatch, true);
  assert.deepEqual(r.unknownAttributes, [7]);
  assert.equal(r.match, false);
  assert.notEqual(r.builtAddress, r.address);
});

test('a corrupted candidate is refused on its CRC32, never reported as a mismatch', () => {
  const corrupted = YOROI.slice(0, -1) + (YOROI.endsWith('i') ? 'j' : 'i');
  assert.throws(() => verifyByronAddress(corrupted, YOROI_ROOT, 0), /checksum failed/);
});

test('Shelley and garbage candidates are refused, not mismatches', () => {
  assert.throws(() => verifyByronAddress(SHELLEY, YOROI_ROOT, 0), /Base58 alphabet/);
  // Short garbage is refused by the inspector's length gate; longer
  // garbage reaches the Base58 alphabet check. Both are refusals.
  assert.throws(() => verifyByronAddress('not an address at all', YOROI_ROOT, 0), /Byron \(bootstrap\) address/);
  assert.throws(() => verifyByronAddress('this is not a byron address, it is just words', YOROI_ROOT, 0), /Base58 alphabet/);
  assert.throws(() => verifyByronAddress('', YOROI_ROOT, 0), /Byron/);
});

test('malformed claims are refused with the builder’s own reasons', () => {
  assert.throws(() => verifyByronAddress(YOROI, '42'.repeat(27), 0), /root must be exactly 28 bytes.*got 27 bytes/);
  assert.throws(() => verifyByronAddress(YOROI, YOROI_ROOT, 3), /type must be 0 \(public key\), 1 \(script\), or 2 \(redemption key\)/);
  assert.throws(() => verifyByronAddress(YOROI, YOROI_ROOT, 0, 4294967296), /uint32/);
  assert.throws(() => verifyByronAddress(YOROI, YOROI_ROOT, 0, null, 'ab'.repeat(27)), /derivation path must be exactly 28 bytes.*got 27 bytes/i);
});

test('the network page wires the Byron verifier with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Verify a Byron \(bootstrap\) address/);
  assert.match(app, /byron-verify-address/);
  assert.match(app, /byron-verify-result/);
  assert.match(app, /byronVerifyPreview/);
  // The path is compared as ciphertext, never decrypted.
  assert.match(app, /compared as ciphertext, byte for byte, and never decrypted/);
  // A match proves the composition only — the root names no key or script.
  assert.match(app, /does not prove which key or script stands behind this address/);
  assert.match(app, /refused here rather than reported as a mismatch/);
});
