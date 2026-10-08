import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildByronAddress, inspectByronAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The Byron (bootstrap) address builder: the inverse of the v1.46
// inspector, and the standalone constructive form of the Byron form.
// It assembles a Byron address entirely locally from its 28-byte root,
// its type, and its optional attributes — canonical CBOR, the payload
// CRC32 appended as the inspector verifies it, Base58-encoded.
// Anchored externally, not self-derived: building from the published
// parts of every address the inspector is anchored on reproduces that
// address byte for byte, so the writer cannot share a wrong assumption
// with the reader and still pass.
const YOROI = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';
const DAEDALUS = '37btjrVyb4KEB2STADSsj3MYSAdj52X5FrFWpw2r7Wmj2GDzXjFRsHWuZqrw7zSkwopv8Ci3VWeg6bisU9dgJxW5hb2MZYeduNKbQJrqz3zVBsu9nT';
const CIP19_EXAMPLE = '37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na';
const SLIP23 = [
  'Ae2tdPwUPEZ1TjYcvfkWAbiHtGVxv4byEHHZoSyQXjPJ362DifCe1ykgqgy',
  'Ae2tdPwUPEZGXmSbda1kBNfyhRQGRcQxJFdk7mhWZXAGnapyejv2b2U3aRb',
];
const ROOT42 = '42'.repeat(28);

function rebuild(address) {
  const info = inspectByronAddress(address);
  return buildByronAddress(info.root, info.type, info.networkDiscriminant, info.derivationPathCiphertext);
}

test('building from the Yoroi example\'s published parts reproduces its address exactly', () => {
  const built = buildByronAddress('ba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdd', 0);
  assert.equal(built.address, YOROI);
  assert.equal(built.checksumHex, '9026da5b');
  assert.equal(built.payloadByteLength, 33);
  assert.equal(built.byteLength, 43);
  assert.equal(built.networkName, 'Mainnet');
  assert.equal(built.hasDerivationPath, false);
});

test('building from the Daedalus example\'s parts reproduces its address, attributes included', () => {
  // Both attributes present: the encrypted derivation path (key 1) and
  // the network discriminant 1097911063 (key 2), written in that order.
  const built = buildByronAddress(
    '9c708538a763ff27169987a489e35057ef3cd3778c05e96f7ba9450e', 0, 1097911063,
    '9c1722f7e446689256e1a30260f3510d558d99d0c391f2ba89cb6977',
  );
  assert.equal(built.address, DAEDALUS);
  assert.equal(built.checksumHex, '6979126c');
  assert.equal(built.payloadByteLength, 73);
  assert.equal(built.networkName, 'Test network');
});

test('the CIP-19 table example and both SLIP-0023 addresses rebuild exactly', () => {
  assert.equal(rebuild(CIP19_EXAMPLE).address, CIP19_EXAMPLE);
  for (const address of SLIP23) assert.equal(rebuild(address).address, address);
});

test('every published address round-trips: inspect(build(parts)) is the inspection', () => {
  for (const address of [YOROI, DAEDALUS, CIP19_EXAMPLE, ...SLIP23]) {
    assert.deepEqual(rebuild(address), inspectByronAddress(address));
    assert.deepEqual(inspectByronAddress(rebuild(address).address), inspectByronAddress(address));
  }
});

test('script and redemption types build and inspect back to the same type', () => {
  for (const [type, typeName] of [[1, 'Script'], [2, 'Redemption key']]) {
    const built = buildByronAddress(ROOT42, type);
    assert.equal(built.typeName, typeName);
    const info = inspectByronAddress(built.address);
    assert.equal(info.type, type);
    assert.equal(info.root, ROOT42);
    assert.deepEqual(info, built);
  }
});

test('each attribute is optional independently, and both together round-trip', () => {
  const pathOnly = buildByronAddress(ROOT42, 0, null, 'ab'.repeat(28));
  assert.equal(pathOnly.hasDerivationPath, true);
  assert.equal(pathOnly.networkDiscriminant, null);
  assert.deepEqual(inspectByronAddress(pathOnly.address), pathOnly);
  const discOnly = buildByronAddress(ROOT42, 0, 42, null);
  assert.equal(discOnly.hasDerivationPath, false);
  assert.equal(discOnly.networkDiscriminant, 42);
  assert.equal(discOnly.networkName, 'Test network');
  assert.deepEqual(inspectByronAddress(discOnly.address), discOnly);
  const both = buildByronAddress(ROOT42, 2, 1097911063, 'cd'.repeat(28));
  assert.deepEqual(inspectByronAddress(both.address), both);
});

test('the discriminant range is the CBOR uint32 range, endpoints included', () => {
  assert.equal(buildByronAddress(ROOT42, 0, 0).networkDiscriminant, 0);
  const max = buildByronAddress(ROOT42, 0, 4294967295);
  assert.equal(inspectByronAddress(max.address).networkDiscriminant, 4294967295);
  assert.throws(() => buildByronAddress(ROOT42, 0, 4294967296), /uint32/);
  assert.throws(() => buildByronAddress(ROOT42, 0, -1), /uint32/);
  assert.throws(() => buildByronAddress(ROOT42, 0, 1.5), /uint32/);
  assert.throws(() => buildByronAddress(ROOT42, 0, '1097911063'), /uint32/);
});

test('a root that is not exactly 28 bytes is refused with its byte count, never padded', () => {
  assert.throws(() => buildByronAddress('42'.repeat(27), 0), /root must be exactly 28 bytes.*got 27 bytes/);
  assert.throws(() => buildByronAddress('42'.repeat(29), 0), /got 29 bytes/);
  assert.throws(() => buildByronAddress('424', 0), /not even-length hexadecimal/);
  assert.throws(() => buildByronAddress('zz'.repeat(28), 0), /not even-length hexadecimal/);
  assert.throws(() => buildByronAddress('', 0), /not even-length hexadecimal/);
  assert.throws(() => buildByronAddress(null, 0), /not even-length hexadecimal/);
});

test('a derivation path that is not exactly 28 bytes is refused with its byte count', () => {
  assert.throws(() => buildByronAddress(ROOT42, 0, null, 'ab'.repeat(27)), /derivation path must be exactly 28 bytes.*got 27 bytes/i);
  assert.throws(() => buildByronAddress(ROOT42, 0, null, 'ab'.repeat(29)), /got 29 bytes/);
  assert.throws(() => buildByronAddress(ROOT42, 0, null, 'abc'), /not even-length hexadecimal/);
});

test('an unknown type is refused rather than written into the payload', () => {
  assert.throws(() => buildByronAddress(ROOT42, 3), /type must be 0 \(public key\), 1 \(script\), or 2 \(redemption key\)/);
  assert.throws(() => buildByronAddress(ROOT42, -1), /type must be 0/);
  assert.throws(() => buildByronAddress(ROOT42, '0'), /type must be 0/);
});

test('uppercase hex roots build the same address as lowercase', () => {
  const upper = buildByronAddress('BA970AD36654D8DD8F74274B733452DDEAB9A62A397746BE3C42CCDD', 0);
  assert.equal(upper.address, YOROI);
  assert.equal(upper.root, 'ba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdd');
});

test('a built address carries no unknown attributes and its checksum verifies on inspection', () => {
  const built = buildByronAddress(ROOT42, 1, 999, 'ef'.repeat(28));
  assert.deepEqual(built.unknownAttributes, []);
  // inspectByronAddress throws unless the stored CRC32 matches the
  // payload bytes, so a successful inspection is the checksum proof.
  assert.equal(inspectByronAddress(built.address).checksum, built.checksum);
});

test('the network page wires the Byron builder with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Build a Byron \(bootstrap\) address/);
  assert.match(app, /byron-build-root/);
  assert.match(app, /byron-built/);
  assert.match(app, /byronBuildPreview/);
  // Building assembles from a supplied root — it does not derive it.
  assert.match(app, /does not derive that root from any key or script/);
  // The derivation path is carried as ciphertext, never decrypted.
  assert.match(app, /carried as ciphertext, never decrypted or created here/);
  assert.match(app, /creates no wallet or key/);
});
