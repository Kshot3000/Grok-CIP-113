import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAssetUnit, parseAssetUnit, assetFingerprint, decodeAssetName } from '../src/cardano.js';

const POLICY = '7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373';

test('a policy and name join at exactly the 28-byte boundary', () => {
  const b = buildAssetUnit(POLICY, '504154415445');
  assert.equal(b.unitHex, POLICY + '504154415445');
  assert.equal(b.policyId, POLICY);
  assert.equal(b.assetNameHex, '504154415445');
  assert.equal(b.policyByteLength, 28);
  assert.equal(b.nameByteLength, 6);
  assert.equal(b.byteLength, 34);
});

test('the built fingerprint is the CIP-14 fingerprint of the parts', () => {
  const b = buildAssetUnit(POLICY, '504154415445');
  assert.equal(b.fingerprint, assetFingerprint(POLICY, '504154415445'));
  // Published CIP-0014 vector for this policy + name.
  assert.equal(b.fingerprint, 'asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92');
});

test('an empty name builds the policy-only unit', () => {
  const b = buildAssetUnit(POLICY, '');
  assert.equal(b.unitHex, POLICY);
  assert.equal(b.nameByteLength, 0);
  assert.equal(b.decoded.empty, true);
  // Published CIP-0014 empty-name vector for this policy.
  assert.equal(b.fingerprint, 'asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3');
});

test('round-trip: build then split returns exactly the inputs', () => {
  for (const name of ['', '504154415445', '000de14047697665596f755570', 'ab'.repeat(32), 'fffe0080']) {
    const b = buildAssetUnit(POLICY, name);
    const s = parseAssetUnit(b.unitHex);
    assert.equal(s.policyId, POLICY);
    assert.equal(s.assetNameHex, name);
    assert.equal(s.fingerprint, b.fingerprint);
    assert.deepEqual(s.decoded, b.decoded);
  }
});

test('round-trip: split then build returns exactly the unit', () => {
  for (const unit of [POLICY, POLICY + '504154415445', POLICY + '000643b047656e546f6b656e']) {
    const s = parseAssetUnit(unit);
    assert.equal(buildAssetUnit(s.policyId, s.assetNameHex).unitHex, unit);
  }
});

test('a labelled name decodes through the build', () => {
  const b = buildAssetUnit(POLICY, '000de14047697665596f755570');
  assert.equal(b.decoded.label.label, 222);
  assert.equal(b.decoded.label.role, 'User NFT');
  assert.equal(b.decoded.text, 'GiveYouUp');
  assert.deepEqual(b.decoded, decodeAssetName('000de14047697665596f755570'));
});

test('uppercase inputs are canonicalised to lowercase', () => {
  const b = buildAssetUnit(POLICY.toUpperCase(), '504154415445'.toUpperCase());
  assert.equal(b.unitHex, POLICY + '504154415445');
});

test('the maximum name — 32 bytes — builds exactly', () => {
  const name = 'ab'.repeat(32);
  const b = buildAssetUnit(POLICY, name);
  assert.equal(b.byteLength, 60);
  assert.equal(b.assetNameHex, name);
});

test('a policy ID that is not exactly 28 bytes is refused with its size', () => {
  assert.throws(() => buildAssetUnit('ab'.repeat(27), ''), /27 bytes/);
  assert.throws(() => buildAssetUnit('ab'.repeat(29), ''), /29 bytes/);
  assert.throws(() => buildAssetUnit('', ''), /28 bytes/);
});

test('a name over the 32-byte limit is refused, not truncated', () => {
  assert.throws(() => buildAssetUnit(POLICY, 'ab'.repeat(33)), /33 bytes/);
  assert.throws(() => buildAssetUnit(POLICY, 'ab'.repeat(33)), /32-byte/);
});

test('odd-length, non-hex, and non-string inputs are refused', () => {
  assert.throws(() => buildAssetUnit(POLICY + 'a', ''), /Policy ID/);
  assert.throws(() => buildAssetUnit('zz'.repeat(28), ''), /Policy ID/);
  assert.throws(() => buildAssetUnit(POLICY, 'abc'), /Asset name/);
  assert.throws(() => buildAssetUnit(POLICY, 'zz'), /Asset name/);
  assert.throws(() => buildAssetUnit(null, ''), /Policy ID/);
  assert.throws(() => buildAssetUnit(POLICY, 42), /Asset name/);
});

test('app wiring: the Network page builds units live with the honesty copy', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /buildAssetUnit/);
  assert.match(app, /id="asset-build-policy"/);
  assert.match(app, /id="asset-build-name"/);
  assert.match(app, /id="asset-unit-built"/);
  assert.match(app, /does not mint the asset/);
  assert.match(app, /splits back to exactly these parts/);
});
