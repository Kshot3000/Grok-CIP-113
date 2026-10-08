import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { crc32, inspectAddress, inspectByronAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The standalone Byron (bootstrap) address inspector: the pre-Shelley
// address form every Shelley inspector in PRISM refuses gets its own
// decoder on the Network page — Base58 text carrying strict canonical
// CBOR (a tag-24 payload and its CRC32, the checksum verified over the
// payload bytes before anything in the payload is read). Anchored
// externally on the two fully worked examples in the cardano-wallet
// design documentation (a Yoroi mainnet address and a Daedalus testnet
// address, each decoded there byte by byte), the Byron example in
// CIP-19's own table, and the SLIP-0023 vectors.
const YOROI = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';
const DAEDALUS = '37btjrVyb4KEB2STADSsj3MYSAdj52X5FrFWpw2r7Wmj2GDzXjFRsHWuZqrw7zSkwopv8Ci3VWeg6bisU9dgJxW5hb2MZYeduNKbQJrqz3zVBsu9nT';
const CIP19_EXAMPLE = '37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na';
const SLIP23 = [
  { address: 'Ae2tdPwUPEZ1TjYcvfkWAbiHtGVxv4byEHHZoSyQXjPJ362DifCe1ykgqgy', root: '2ea63b3db3a1865f59c11762a5aede800ed8f2dc0605d75df2ed7c9c', checksumHex: 'e8266816' },
  { address: 'Ae2tdPwUPEZGXmSbda1kBNfyhRQGRcQxJFdk7mhWZXAGnapyejv2b2U3aRb', root: 'c5ad517f2d416a4c1253620dc1b93ae5d9cb0fce7e946445fa58c22d', checksumHex: 'cdf2fdd6' },
];

// Test-side independent construction: payload CBOR assembled as literal
// bytes here, the CRC taken from Node's reference zlib.crc32, and Base58
// encoded here — nothing is borrowed from the module under test, so a
// constructed address the module decodes is a genuine cross-check.
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
function buildByron(payloadBytes, crcOverride = null) {
  const payload = Uint8Array.from(payloadBytes);
  const crc = (crcOverride ?? zlibCrc32(payload)) >>> 0;
  return base58Encode(Uint8Array.from([0x82, 0xd8, 0x18, 0x58, payload.length, ...payload, 0x1a, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]));
}
const ROOT42 = Array(28).fill(0x42);

test('the cardano-wallet Yoroi mainnet example decodes to its published parts', () => {
  // The design document decodes this address byte by byte: root
  // ba97…ccdd, an empty attribute map, type 0, CRC 0x9026da5b.
  const info = inspectByronAddress(YOROI);
  assert.equal(info.root, 'ba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdd');
  assert.equal(info.type, 0);
  assert.equal(info.typeName, 'Public key');
  assert.equal(info.networkDiscriminant, null);
  assert.equal(info.networkName, 'Mainnet');
  assert.equal(info.hasDerivationPath, false);
  assert.equal(info.derivationPathCiphertext, null);
  assert.deepEqual(info.unknownAttributes, []);
  assert.equal(info.checksum, 0x9026da5b);
  assert.equal(info.checksumHex, '9026da5b');
  assert.equal(info.payloadByteLength, 33);
  assert.equal(info.byteLength, 43);
});

test('the cardano-wallet Daedalus testnet example decodes its attributes', () => {
  // Published byte-by-byte: root 9c70…450e, attribute 1 a 28-byte
  // encrypted derivation path, attribute 2 the network discriminant
  // 1097911063 (the Byron-era public testnet's network magic), type 0,
  // CRC 0x6979126c.
  const info = inspectByronAddress(DAEDALUS);
  assert.equal(info.root, '9c708538a763ff27169987a489e35057ef3cd3778c05e96f7ba9450e');
  assert.equal(info.type, 0);
  assert.equal(info.hasDerivationPath, true);
  assert.equal(info.derivationPathCiphertext, '9c1722f7e446689256e1a30260f3510d558d99d0c391f2ba89cb6977');
  assert.equal(info.networkDiscriminant, 1097911063);
  assert.equal(info.networkName, 'Test network');
  assert.equal(info.checksum, 0x6979126c);
  assert.equal(info.payloadByteLength, 73);
  assert.equal(info.byteLength, 83);
});

test('the CIP-19 table Byron example decodes with the same testnet discriminant', () => {
  const info = inspectByronAddress(CIP19_EXAMPLE);
  assert.equal(info.root, '7e9ee4a9527dea9091e2d580edd6716888c42f75d96276290f98fe0b');
  assert.equal(info.hasDerivationPath, true);
  assert.equal(info.derivationPathCiphertext, '0cdf39b531d1ac0963cbd183f63e43d895d16a9c567c95e1056e28bd');
  assert.equal(info.networkDiscriminant, 1097911063);
  assert.equal(info.checksumHex, '53249b67');
});

test('both SLIP-0023 mainnet addresses decode with empty attributes', () => {
  for (const v of SLIP23) {
    const info = inspectByronAddress(v.address);
    assert.equal(info.root, v.root, v.address);
    assert.equal(info.checksumHex, v.checksumHex);
    assert.equal(info.type, 0);
    assert.equal(info.networkName, 'Mainnet');
    assert.equal(info.hasDerivationPath, false);
  }
});

test('the module CRC32 agrees with the reference zlib implementation', () => {
  const samples = [
    new Uint8Array(0),
    Uint8Array.from([0]),
    // The Yoroi example's payload bytes, as published in the design doc.
    Uint8Array.from([0x83, 0x58, 0x1c, 0xba, 0x97, 0x0a, 0xd3, 0x66, 0x54, 0xd8, 0xdd, 0x8f, 0x74, 0x27, 0x4b, 0x73, 0x34, 0x52, 0xdd, 0xea, 0xb9, 0xa6, 0x2a, 0x39, 0x77, 0x46, 0xbe, 0x3c, 0x42, 0xcc, 0xdd, 0xa0, 0x00]),
    Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255),
  ];
  for (const s of samples) assert.equal(crc32(s), zlibCrc32(s) >>> 0);
  assert.equal(crc32(samples[2]), 0x9026da5b);
});

test('script and redemption types decode from independently constructed addresses', () => {
  const script = inspectByronAddress(buildByron([0x83, 0x58, 0x1c, ...ROOT42, 0xa0, 0x01]));
  assert.equal(script.type, 1);
  assert.equal(script.typeName, 'Script');
  assert.equal(script.root, '42'.repeat(28));
  const redeem = inspectByronAddress(buildByron([0x83, 0x58, 0x1c, ...ROOT42, 0xa0, 0x02]));
  assert.equal(redeem.type, 2);
  assert.equal(redeem.typeName, 'Redemption key');
});

test('an unrecognised attribute is reported, not interpreted', () => {
  // Attribute key 7 carrying a two-byte value: neither the derivation
  // path (1) nor the network discriminant (2), so it is named by key.
  const info = inspectByronAddress(buildByron([0x83, 0x58, 0x1c, ...ROOT42, 0xa1, 0x07, 0x42, 0xaa, 0xbb, 0x00]));
  assert.deepEqual(info.unknownAttributes, [7]);
  assert.equal(info.hasDerivationPath, false);
  assert.equal(info.networkDiscriminant, null);
});

test('a corrupted checksum is refused, never partially decoded', () => {
  const corrupted = YOROI.slice(0, -1) + (YOROI.endsWith('i') ? 'j' : 'i');
  assert.throws(() => inspectByronAddress(corrupted), /checksum failed/);
  const wrongCrc = buildByron([0x83, 0x58, 0x1c, ...ROOT42, 0xa0, 0x00], 0xdeadbeef);
  assert.throws(() => inspectByronAddress(wrongCrc), /checksum failed/);
});

test('a root that is not 28 bytes and an unknown type are refused', () => {
  assert.throws(() => inspectByronAddress(buildByron([0x83, 0x58, 0x1b, ...ROOT42.slice(0, 27), 0xa0, 0x00])), /root must be exactly 28 bytes — got 27 bytes/);
  assert.throws(() => inspectByronAddress(buildByron([0x83, 0x58, 0x1c, ...ROOT42, 0xa0, 0x05])), /Unknown Byron address type 5/);
});

test('non-canonical CBOR is refused: the same address in a second byte form does not decode', () => {
  // The CRC written as an 8-byte uint (0x1b) instead of the canonical
  // 4-byte form — same value, second encoding, refused as non-canonical.
  const payload = Uint8Array.from([0x83, 0x58, 0x1c, ...ROOT42, 0xa0, 0x00]);
  const crc = zlibCrc32(payload) >>> 0;
  const nonCanonical = base58Encode(Uint8Array.from([0x82, 0xd8, 0x18, 0x58, payload.length, ...payload, 0x1b, 0, 0, 0, 0, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]));
  assert.throws(() => inspectByronAddress(nonCanonical), /canonical \(shortest\) form/);
});

test('truncated, non-Base58, and non-string inputs are refused', () => {
  assert.throws(() => inspectByronAddress(YOROI.slice(0, 40)), /Byron/);
  assert.throws(() => inspectByronAddress('Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpM0O'), /Base58 alphabet/);
  assert.throws(() => inspectByronAddress(''), /Byron/);
  assert.throws(() => inspectByronAddress(42), /Byron/);
  assert.throws(() => inspectByronAddress(null), /Byron/);
});

test('Shelley payment and reward addresses are refused by the Byron decoder', () => {
  assert.throws(() => inspectByronAddress('addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'), /Byron|Base58/);
  assert.throws(() => inspectByronAddress('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw'), /Byron|Base58/);
});

test('the payment inspector still refuses Byron addresses — the forms stay separate', () => {
  assert.throws(() => inspectAddress(YOROI), /Bech32|addr or addr_test/);
  assert.throws(() => inspectAddress(DAEDALUS), /Bech32|addr or addr_test/);
});

test('the network page wires the Byron inspector with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Inspect a Byron \(bootstrap\) address/);
  assert.match(app, /byron-inspect-form/);
  assert.match(app, /byronInspectResultView/);
  // The root is a hash: the spending data behind it cannot be recovered.
  assert.match(app, /cannot be recovered from it/);
  // The encrypted derivation path is reported, never decrypted.
  assert.match(app, /is not decrypted here/);
  assert.match(app, /spending password, which PRISM never asks for/);
  // Byron predates staking — no reward address is implied.
  assert.match(app, /Byron addresses predate staking/);
});
