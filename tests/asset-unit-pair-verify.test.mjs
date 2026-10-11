import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyUnitPair, verifyCip68Pair, cip68Pair, buildAssetUnit } from '../src/cardano.js';

const hex = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
const REF = '000643b0', U222 = '000de140', U333 = '0014df10', U444 = '001bc280';
const POLICY_A = '7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373';
const POLICY_B = '1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209';
const unit = (policy, name) => buildAssetUnit(policy, name).unitHex;

test('a user-token unit verifies against the reference unit under the same policy', () => {
  const source = unit(POLICY_A, U222 + hex('GiveYouUp'));
  const claimed = unit(POLICY_A, REF + hex('GiveYouUp'));
  const r = verifyUnitPair(source, claimed);
  assert.equal(r.match, true);
  assert.equal(r.policyMatch, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, true);
  assert.equal(r.sourceKind, 'user');
  assert.equal(r.claimedUnitHex, claimed);
  assert.equal(r.expectedUnits.length, 1);
  assert.equal(r.expectedUnits[0].unitHex, claimed);
  assert.equal(r.expectedUnits[0].fingerprint, r.claimedFingerprint);
});

test('a reference unit verifies against each of its three user units under one policy', () => {
  const source = unit(POLICY_A, REF + hex('GenToken'));
  for (const prefix of [U222, U333, U444]) {
    const r = verifyUnitPair(source, unit(POLICY_A, prefix + hex('GenToken')));
    assert.equal(r.match, true, prefix);
    assert.equal(r.expectedUnits.length, 3);
  }
});

test('every expected unit verifies, in both directions, and agrees with the name verifier', () => {
  for (const name of [U222 + hex('PRISM'), REF + hex('Pair'), U444 + hex('')]) {
    const source = unit(POLICY_B, name);
    for (const eu of verifyUnitPair(source, unit(POLICY_B, name)).expectedUnits) {
      assert.equal(verifyUnitPair(source, eu.unitHex).match, true, `${source} -> ${eu.unitHex}`);
      assert.equal(verifyUnitPair(eu.unitHex, source).match, true, `${eu.unitHex} -> ${source}`);
      assert.equal(verifyCip68Pair(name, eu.nameHex).match, true);
    }
    for (const p of cip68Pair(name).pairs) {
      assert.equal(verifyUnitPair(source, unit(POLICY_B, p.nameHex)).match, true);
    }
  }
});

test('the same paired names under a different policy fail the policy verdict alone — different assets entirely', () => {
  const source = unit(POLICY_A, U222 + hex('PRISM'));
  const claimed = unit(POLICY_B, REF + hex('PRISM'));
  const r = verifyUnitPair(source, claimed);
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, false);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, true);
  // The name verifier alone calls this a pair; the unit verifier must not.
  assert.equal(verifyCip68Pair(U222 + hex('PRISM'), REF + hex('PRISM')).match, true);
  assert.notEqual(r.sourceFingerprint, r.claimedFingerprint);
});

test('a token handed back its own unit fails the label verdict alone — it is not its own pair', () => {
  for (const name of [U222 + hex('GiveYouUp'), REF + hex('GenToken')]) {
    const u = unit(POLICY_A, name);
    const r = verifyUnitPair(u, u);
    assert.equal(r.match, false);
    assert.equal(r.policyMatch, true);
    assert.equal(r.contentMatch, true);
    assert.equal(r.labelMatch, false);
  }
});

test('the relation stays asymmetric at unit level: a 333 unit verifies against the reference unit but not against the 222 unit', () => {
  const claimed = unit(POLICY_A, U333 + hex('PRISM'));
  assert.equal(verifyUnitPair(unit(POLICY_A, REF + hex('PRISM')), claimed).match, true);
  const r = verifyUnitPair(unit(POLICY_A, U222 + hex('PRISM')), claimed);
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, false);
  assert.deepEqual(r.expectedUnits.map(u => u.label), [100]);
});

test('the right pair under the right policy but different name bytes fails the content verdict alone', () => {
  const r = verifyUnitPair(unit(POLICY_A, U222 + hex('GiveYouUp')), unit(POLICY_A, REF + hex('NeverGonna')));
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, true);
  assert.equal(r.labelMatch, true);
  assert.equal(r.contentMatch, false);
  assert.equal(r.claimedText, 'NeverGonna');
});

test('an unlabeled source unit has no pair to verify against — scored, not refused, policy verdict still reported', () => {
  const source = unit(POLICY_A, hex('PlainName'));
  const r = verifyUnitPair(source, unit(POLICY_A, REF + hex('PlainName')));
  assert.equal(r.sourceKind, 'unlabeled');
  assert.deepEqual(r.expectedUnits, []);
  assert.equal(r.policyMatch, true);
  assert.equal(r.labelMatch, false);
  assert.equal(r.match, false);
  const otherPolicy = verifyUnitPair(source, unit(POLICY_B, REF + hex('PlainName')));
  assert.equal(otherPolicy.policyMatch, false);
  assert.equal(otherPolicy.match, false);
});

test('an unlabeled claimed unit under the same policy is not the pair', () => {
  const r = verifyUnitPair(unit(POLICY_A, U222 + hex('PRISM')), unit(POLICY_A, hex('PRISM')));
  assert.equal(r.match, false);
  assert.equal(r.policyMatch, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, false);
  assert.equal(r.claimedLabel, null);
});

test('non-printable name bytes pair by bytes at unit level and verify standing as hex, never guessed', () => {
  const r = verifyUnitPair(unit(POLICY_A, U222 + 'fffe'), unit(POLICY_A, REF + 'fffe'));
  assert.equal(r.match, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.claimedText, null);
  assert.equal(r.claimedTextDecodable, false);
});

test('uppercase and whitespace-padded units are the same pair, stated in canonical lowercase', () => {
  const source = unit(POLICY_A, U222 + hex('PRISM'));
  const claimed = unit(POLICY_A, REF + hex('PRISM'));
  const r = verifyUnitPair('  ' + source.toUpperCase() + ' ', claimed.toUpperCase());
  assert.equal(r.match, true);
  assert.equal(r.sourceUnitHex, source);
  assert.equal(r.claimedUnitHex, claimed);
});

test('units that cannot be split at all are refused, never scored as a non-pair', () => {
  const good = unit(POLICY_A, U222 + hex('PRISM'));
  assert.throws(() => verifyUnitPair('abcd', good));
  assert.throws(() => verifyUnitPair(good, 'zz'.repeat(40)));
  assert.throws(() => verifyUnitPair(good, POLICY_A + 'aa'.repeat(33)));
  assert.throws(() => verifyUnitPair(good, 'asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3'));
  assert.throws(() => verifyUnitPair(42, good));
  assert.throws(() => verifyUnitPair(good, null));
  assert.throws(() => verifyUnitPair('', good));
});

test('app wires the unit-pair verifier into the network explorer, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyUnitPair/);
  assert.match(app, /unitPairVerifyPreview/);
  assert.match(app, /asset-unit-pair-verify-source/);
  assert.match(app, /asset-unit-pair-verify-claimed/);
  assert.match(app, /asset-unit-pair-verify-result/);
  assert.match(app, /different assets entirely/);
  assert.match(app, /v1\.107/);
});
