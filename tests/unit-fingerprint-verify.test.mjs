import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetFingerprint, decodeAssetFingerprint, parseAssetUnit, verifyAssetFingerprint, verifyUnitFingerprint } from '../src/cardano.js';

// Unit fingerprint verification — the unit-level form of
// verifyAssetFingerprint: the claim is judged against a fingerprint
// recomputed from the unit's own split (parseAssetUnit itself, judged
// by verifyAssetFingerprint itself), so the three tools can never
// disagree. Anchored externally on the eight test vectors published in
// CIP-0014, reached here through their units (policy ‖ name as one
// string) rather than through their components.
const CIP14_VECTORS = [
  ['7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373', '', 'asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3'],
  ['7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc37e', '', 'asset1nl0puwxmhas8fawxp8nx4e2q3wekg969n2auw3'],
  ['1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209', '', 'asset1uyuxku60yqe57nusqzjx38aan3f2wq6s93f6ea'],
  ['7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373', '504154415445', 'asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92'],
  ['1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209', '504154415445', 'asset1hv4p5tv2a837mzqrst04d0dcptdjmluqvdx9k3'],
  ['1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209', '7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373', 'asset1aqrdypg669jgazruv5ah07nuyqe0wxjhe2el6f'],
  ['7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373', '1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209', 'asset17jd78wukhtrnmjh3fngzasxm8rck0l2r4hhyyt'],
  ['7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373', '00'.repeat(32), 'asset1pkpwyknlvul7az0xx8czhl60pyel45rpje4z8w'],
];
const unitOf = ([policy, name]) => policy + name;

test('all eight published CIP-14 vectors verify from their units', () => {
  for (const v of CIP14_VECTORS) {
    const r = verifyUnitFingerprint(unitOf(v), v[2]);
    assert.equal(r.match, true, unitOf(v));
    assert.equal(r.computedFingerprint, v[2]);
    assert.equal(r.claimedFingerprint, v[2]);
    assert.equal(r.computedDigestHex, r.claimedDigestHex);
    assert.equal(r.policyId, v[0]);
    assert.equal(r.assetNameHex, v[1]);
    assert.equal(r.unitHex, unitOf(v));
  }
});

test('the unit verifier agrees with the splitter, the fingerprint computation, and the component verifier on every vector', () => {
  for (const v of CIP14_VECTORS) {
    const unit = unitOf(v);
    const r = verifyUnitFingerprint(unit, v[2]);
    assert.equal(r.computedFingerprint, parseAssetUnit(unit).fingerprint);
    assert.equal(r.computedFingerprint, assetFingerprint(v[0], v[1]));
    assert.equal(r.match, verifyAssetFingerprint(v[0], v[1], v[2]).match);
    assert.equal(r.computedDigestHex, decodeAssetFingerprint(v[2]).digestHex);
  }
});

test('the same policy with a different name fails — a well-formed fingerprint of a different asset, both digests reported', () => {
  // Vectors 0 and 3 share the policy; only the name differs ('' vs PATATE).
  const r = verifyUnitFingerprint(unitOf(CIP14_VECTORS[0]), CIP14_VECTORS[3][2]);
  assert.equal(r.match, false);
  assert.equal(r.computedFingerprint, CIP14_VECTORS[0][2]);
  assert.equal(r.claimedFingerprint, CIP14_VECTORS[3][2]);
  assert.notEqual(r.computedDigestHex, r.claimedDigestHex);
  assert.equal(r.claimedDigestHex, decodeAssetFingerprint(CIP14_VECTORS[3][2]).digestHex);
});

test('the same name under a different policy fails — paired identifiers under another policy are a different asset', () => {
  // Vectors 3 and 4 share the PATATE name; only the policy differs.
  const r = verifyUnitFingerprint(unitOf(CIP14_VECTORS[3]), CIP14_VECTORS[4][2]);
  assert.equal(r.match, false);
  assert.equal(r.computedFingerprint, CIP14_VECTORS[3][2]);
  assert.equal(r.policyId, CIP14_VECTORS[3][0]);
});

test('a CIP-68 label prefix alone changes the fingerprint: a reference token and its user token do not cross-verify', () => {
  const policy = CIP14_VECTORS[0][0];
  const text = '546f6b656e'; // "Token"
  const refUnit = policy + '000643b0' + text;   // label 100
  const userUnit = policy + '000de140' + text;  // label 222
  const refFp = assetFingerprint(policy, '000643b0' + text);
  const userFp = assetFingerprint(policy, '000de140' + text);
  assert.notEqual(refFp, userFp);
  assert.equal(verifyUnitFingerprint(refUnit, refFp).match, true);
  assert.equal(verifyUnitFingerprint(userUnit, userFp).match, true);
  assert.equal(verifyUnitFingerprint(refUnit, userFp).match, false);
  assert.equal(verifyUnitFingerprint(userUnit, refFp).match, false);
  assert.equal(verifyUnitFingerprint(refUnit, refFp).decoded.label.label, 100);
});

test('an empty-name asset is a policy ID alone as a unit, and verifies against the fingerprint of the policy bytes alone', () => {
  const [policy, , fp] = CIP14_VECTORS[0];
  const r = verifyUnitFingerprint(policy, fp);
  assert.equal(r.match, true);
  assert.equal(r.byteLength, 28);
  assert.equal(r.assetNameHex, '');
  assert.equal(r.nameByteLength, 0);
});

test('an all-uppercase unit with surrounding whitespace is the same asset, reported in canonical lowercase', () => {
  const v = CIP14_VECTORS[3];
  const r = verifyUnitFingerprint('  ' + unitOf(v).toUpperCase() + ' ', v[2]);
  assert.equal(r.match, true);
  assert.equal(r.unitHex, unitOf(v));
  assert.equal(r.policyId, v[0]);
});

test('an all-uppercase fingerprint is the same fingerprint, reported in its canonical lowercase form', () => {
  const v = CIP14_VECTORS[4];
  const r = verifyUnitFingerprint(unitOf(v), v[2].toUpperCase());
  assert.equal(r.match, true);
  assert.equal(r.claimedFingerprint, v[2]);
});

test('the verdict is a single exact verdict: the result carries no policy or name position to partially match', () => {
  const r = verifyUnitFingerprint(unitOf(CIP14_VECTORS[0]), CIP14_VECTORS[0][2]);
  assert.deepEqual(Object.keys(r).sort(), ['assetNameHex', 'byteLength', 'claimedDigestHex', 'claimedFingerprint', 'computedDigestHex', 'computedFingerprint', 'decoded', 'match', 'nameByteLength', 'policyId', 'unitHex']);
  assert.equal('policyMatch' in r, false);
  assert.equal('nameMatch' in r, false);
});

test('a unit that cannot be split is refused, never scored as a mismatch', () => {
  const policy = CIP14_VECTORS[0][0], fp = CIP14_VECTORS[0][2];
  assert.throws(() => verifyUnitFingerprint('zz' + policy.slice(2), fp), /even-length hexadecimal/);
  assert.throws(() => verifyUnitFingerprint('ab'.repeat(20), fp), /shorter than a 28-byte policy ID/);
  assert.throws(() => verifyUnitFingerprint(policy + 'ab'.repeat(33), fp), /name part would be 33 bytes/);
  // A fingerprint handed over AS the unit is a hash — it cannot be split back.
  assert.throws(() => verifyUnitFingerprint(fp, fp), /even-length hexadecimal/);
  assert.throws(() => verifyUnitFingerprint('', fp), /even-length hexadecimal/);
});

test('a claimed fingerprint that cannot be decoded is refused, never scored as a mismatch', () => {
  const unit = unitOf(CIP14_VECTORS[0]), fp = CIP14_VECTORS[0][2];
  const corrupted = fp.slice(0, -1) + (fp.endsWith('q') ? 'p' : 'q');
  assert.throws(() => verifyUnitFingerprint(unit, corrupted), /checksum is invalid/);
  assert.throws(() => verifyUnitFingerprint(unit, 'Asset' + fp.slice(5)), /Mixed-case/);
  // An address and a unit are different identifiers, not fingerprints.
  assert.throws(() => verifyUnitFingerprint(unit, 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw'), /asset fingerprint/);
  assert.throws(() => verifyUnitFingerprint(unit, unit), /asset fingerprint/);
});

test('non-string inputs are refused on the side that is malformed', () => {
  const v = CIP14_VECTORS[0];
  assert.throws(() => verifyUnitFingerprint(42, v[2]), /even-length hexadecimal/);
  assert.throws(() => verifyUnitFingerprint(null, v[2]), /even-length hexadecimal/);
  assert.throws(() => verifyUnitFingerprint(unitOf(v), null), /asset fingerprint/);
  assert.throws(() => verifyUnitFingerprint(unitOf(v), ''), /asset fingerprint/);
});

test('app wires the unit fingerprint verifier into the network explorer, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyUnitFingerprint/);
  assert.match(app, /unitFingerprintVerifyPreview/);
  assert.match(app, /asset-unit-fingerprint-verify-unit/);
  assert.match(app, /asset-unit-fingerprint-verify-claimed/);
  assert.match(app, /asset-unit-fingerprint-verify-result/);
  assert.match(app, /cannot say which half of the unit differs/);
  assert.match(app, /v1\.85/);
});
