import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAssetUnit, assetFingerprint, decodeAssetName } from '../src/cardano.js';

const POLICY = '7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373';

test('a known unit splits at exactly 28 bytes', () => {
  const unit = POLICY + '504154415445';
  const s = parseAssetUnit(unit);
  assert.equal(s.policyId, POLICY);
  assert.equal(s.assetNameHex, '504154415445');
  assert.equal(s.policyByteLength, 28);
  assert.equal(s.nameByteLength, 6);
  assert.equal(s.byteLength, 34);
  assert.equal(s.policyId + s.assetNameHex, unit);
});

test('the split fingerprint is the CIP-14 fingerprint of the parts', () => {
  const s = parseAssetUnit(POLICY + '504154415445');
  assert.equal(s.fingerprint, assetFingerprint(POLICY, '504154415445'));
  // Published CIP-0014 vector for this policy + name.
  assert.equal(s.fingerprint, 'asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92');
});

test('a policy-only unit is a valid empty-name asset', () => {
  const s = parseAssetUnit(POLICY);
  assert.equal(s.assetNameHex, '');
  assert.equal(s.nameByteLength, 0);
  assert.equal(s.decoded.empty, true);
  // Published CIP-0014 empty-name vector for this policy.
  assert.equal(s.fingerprint, 'asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3');
});

test('a labelled unit decodes its CIP-68 name through the split', () => {
  const s = parseAssetUnit(POLICY + '000de14047697665596f755570');
  assert.equal(s.decoded.label.label, 222);
  assert.equal(s.decoded.label.role, 'User NFT');
  assert.equal(s.decoded.text, 'GiveYouUp');
  assert.deepEqual(s.decoded, decodeAssetName('000de14047697665596f755570'));
});

test('an unlabeled printable name reads as text; non-printable bytes stay undecoded', () => {
  assert.equal(parseAssetUnit(POLICY + '504154415445').decoded.text, 'PATATE');
  const raw = parseAssetUnit(POLICY + 'fffe0080');
  assert.equal(raw.decoded.textDecodable, false);
  assert.equal(raw.decoded.text, null);
});

test('uppercase units are canonicalised to lowercase', () => {
  const s = parseAssetUnit((POLICY + '504154415445').toUpperCase());
  assert.equal(s.policyId, POLICY);
  assert.equal(s.assetNameHex, '504154415445');
  assert.equal(s.unitHex, POLICY + '504154415445');
});

test('the maximum unit — 28-byte policy plus a 32-byte name — splits exactly', () => {
  const name = 'ab'.repeat(32);
  const s = parseAssetUnit(POLICY + name);
  assert.equal(s.byteLength, 60);
  assert.equal(s.nameByteLength, 32);
  assert.equal(s.assetNameHex, name);
});

test('a unit shorter than a policy ID is refused with its byte count', () => {
  assert.throws(() => parseAssetUnit('ab'.repeat(27)), /27 bytes/);
  assert.throws(() => parseAssetUnit(''), /hexadecimal/);
});

test('a name part over the 32-byte limit is refused, not truncated', () => {
  assert.throws(() => parseAssetUnit(POLICY + 'ab'.repeat(33)), /33 bytes/);
  assert.throws(() => parseAssetUnit(POLICY + 'ab'.repeat(33)), /32 bytes/);
});

test('odd-length, non-hex, and non-string units are refused', () => {
  assert.throws(() => parseAssetUnit(POLICY + '5'), /hexadecimal/);
  assert.throws(() => parseAssetUnit(POLICY + 'zz'), /hexadecimal/);
  assert.throws(() => parseAssetUnit(null), /hexadecimal/);
  assert.throws(() => parseAssetUnit(42), /hexadecimal/);
});

test('a fingerprint cannot be split back — bech32 input is refused', () => {
  assert.throws(() => parseAssetUnit('asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92'), /hexadecimal/);
});

test('app wiring: the Network page splits units live with the honesty copy', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /parseAssetUnit/);
  assert.match(app, /id="asset-unit"/);
  assert.match(app, /id="asset-unit-split"/);
  assert.match(app, /does not prove the asset was minted/);
  assert.match(app, /is a hash and cannot be split back/);
});
