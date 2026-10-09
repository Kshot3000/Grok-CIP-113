import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyAssetUnit, buildAssetUnit, parseAssetUnit } from '../src/cardano.js';

const POLICY = '7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373';
const POLICY2 = '1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209';
const NAME = '504154415445'; // PATATE — published CIP-0014 vector name

test('a unit built from published CIP-14 parts verifies exactly against those parts', () => {
  const r = verifyAssetUnit(POLICY + NAME, POLICY, NAME);
  assert.equal(r.match, true);
  assert.equal(r.policyMatch, true);
  assert.equal(r.nameMatch, true);
  assert.equal(r.fingerprintMatch, true);
  assert.equal(r.unitHex, POLICY + NAME);
  assert.equal(r.builtUnitHex, POLICY + NAME);
  // Published CIP-0014 fingerprint for this policy + name.
  assert.equal(r.fingerprint, 'asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92');
  assert.equal(r.builtFingerprint, r.fingerprint);
  assert.equal(r.decoded.text, 'PATATE');
});

test('a policy-only unit verifies against an empty-name claim', () => {
  const r = verifyAssetUnit(POLICY, POLICY, '');
  assert.equal(r.match, true);
  assert.equal(r.nameByteLength, 0);
  assert.equal(r.fingerprint, 'asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3');
});

test('an all-uppercase unit is the same unit, stated in canonical lowercase', () => {
  const r = verifyAssetUnit((POLICY + NAME).toUpperCase(), POLICY.toUpperCase(), NAME.toUpperCase());
  assert.equal(r.match, true);
  assert.equal(r.unitHex, POLICY + NAME);
  assert.equal(r.policyId, POLICY);
  // Surrounding whitespace on a pasted claim is trimmed by the verifier.
  assert.equal(verifyAssetUnit(`  ${POLICY + NAME} `, POLICY, NAME).match, true);
});

test('a policy difference alone fails only the policy position', () => {
  const r = verifyAssetUnit(POLICY2 + NAME, POLICY, NAME);
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, false);
  assert.equal(r.nameMatch, true);
  assert.equal(r.fingerprintMatch, false);
  assert.equal(r.builtUnitHex, POLICY + NAME);
  assert.equal(r.policyId, POLICY2);
  assert.equal(r.claimedPolicyId, POLICY);
});

test('a name difference alone fails only the name position', () => {
  const r = verifyAssetUnit(POLICY + '504154415446', POLICY, NAME);
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, true);
  assert.equal(r.nameMatch, false);
  assert.equal(r.fingerprintMatch, false);
  // A claimed empty name against a named unit also differs on name alone.
  const s = verifyAssetUnit(POLICY + NAME, POLICY, '');
  assert.equal(s.policyMatch, true);
  assert.equal(s.nameMatch, false);
  assert.equal(s.builtUnitHex, POLICY);
});

test('the fingerprint cross-check matches exactly when both positions match', () => {
  for (const [unit, policy, name] of [
    [POLICY + NAME, POLICY, NAME],
    [POLICY2 + NAME, POLICY, NAME],
    [POLICY + NAME, POLICY, ''],
    [POLICY, POLICY, ''],
  ]) {
    const r = verifyAssetUnit(unit, policy, name);
    assert.equal(r.fingerprintMatch, r.match, unit);
    assert.equal(r.fingerprintMatch, r.policyMatch && r.nameMatch);
  }
});

test('every built unit verifies against its own inputs, including the maximum name', () => {
  for (const name of ['', NAME, '000de14047697665596f755570', 'ab'.repeat(32), 'fffe0080']) {
    for (const policy of [POLICY, POLICY2]) {
      const b = buildAssetUnit(policy, name);
      const r = verifyAssetUnit(b.unitHex, policy, name);
      assert.equal(r.match, true, `${policy} ${name}`);
      assert.deepEqual(r.decoded, parseAssetUnit(b.unitHex).decoded);
    }
  }
});

test('a candidate shorter than a policy ID is refused with its byte count, not a mismatch', () => {
  assert.throws(() => verifyAssetUnit('ab'.repeat(27), POLICY, ''), /27 bytes/);
  assert.throws(() => verifyAssetUnit('', POLICY, ''), /hexadecimal/);
});

test('a candidate whose name part is over the limit is refused, not truncated or mismatched', () => {
  assert.throws(() => verifyAssetUnit(POLICY + 'ab'.repeat(33), POLICY, ''), /33 bytes/);
});

test('a fingerprint candidate is refused as a different identifier, not a mismatch', () => {
  assert.throws(() => verifyAssetUnit('asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92', POLICY, NAME), /hexadecimal/);
});

test('odd-length, non-hex, and non-string candidates are refused', () => {
  assert.throws(() => verifyAssetUnit(POLICY + '5', POLICY, NAME), /hexadecimal/);
  assert.throws(() => verifyAssetUnit(POLICY + 'zz', POLICY, NAME), /hexadecimal/);
  assert.throws(() => verifyAssetUnit(null, POLICY, NAME), /hexadecimal/);
  assert.throws(() => verifyAssetUnit(42, POLICY, NAME), /hexadecimal/);
});

test('malformed claims are refused by the builder validation, with their sizes', () => {
  assert.throws(() => verifyAssetUnit(POLICY + NAME, 'ab'.repeat(27), NAME), /27 bytes/);
  assert.throws(() => verifyAssetUnit(POLICY + NAME, POLICY, 'ab'.repeat(33)), /33 bytes/);
  assert.throws(() => verifyAssetUnit(POLICY + NAME, POLICY, 'zz'), /Asset name/);
  assert.throws(() => verifyAssetUnit(POLICY + NAME, null, NAME), /Policy ID/);
});

test('app wiring: the Network page verifies units live with the honesty copy', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyAssetUnit/);
  assert.match(app, /Verify an asset unit/);
  assert.match(app, /id="asset-unit-verify-claimed"/);
  assert.match(app, /id="asset-unit-verify-result"/);
  assert.match(app, /ASSET UNIT MATCHES/);
  assert.match(app, /does not prove the asset was minted/);
  assert.match(app, /refused here rather than reported as a mismatch/);
});
