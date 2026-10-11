import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCip68Pair, cip68Pair } from '../src/cardano.js';

const hex = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
const REF = '000643b0', U222 = '000de140', U333 = '0014df10', U444 = '001bc280';

test('a user token verifies against the reference name the pair finder derives', () => {
  const source = U222 + hex('GiveYouUp');
  const r = verifyCip68Pair(source, cip68Pair(source).pairs[0].nameHex);
  assert.equal(r.match, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, true);
  assert.equal(r.sourceKind, 'user');
  assert.equal(r.claimedNameHex, REF + hex('GiveYouUp'));
  assert.equal(r.claimedLabel, 100);
  assert.equal(r.claimedLabelRole, 'Reference token');
  assert.equal(r.expectedPairs.length, 1);
});

test('a reference token verifies against each of its three user candidates', () => {
  const source = REF + hex('GenToken');
  for (const prefix of [U222, U333, U444]) {
    const r = verifyCip68Pair(source, prefix + hex('GenToken'));
    assert.equal(r.match, true, prefix);
    assert.equal(r.sourceKind, 'reference');
    assert.equal(r.expectedPairs.length, 3);
  }
});

test('every derived pair verifies, in both directions, across labels and texts', () => {
  for (const source of [U222 + hex('PRISM'), U333 + hex('Café'), U444 + hex(''), REF + hex('Pair')]) {
    for (const p of cip68Pair(source).pairs) {
      assert.equal(verifyCip68Pair(source, p.nameHex).match, true, `${source} -> ${p.nameHex}`);
      assert.equal(verifyCip68Pair(p.nameHex, source).match, true, `${p.nameHex} -> ${source}`);
    }
  }
});

test('a token handed back its own name fails the label verdict alone — it is not its own pair', () => {
  for (const source of [U222 + hex('GiveYouUp'), REF + hex('GenToken')]) {
    const r = verifyCip68Pair(source, source);
    assert.equal(r.match, false);
    assert.equal(r.contentMatch, true);
    assert.equal(r.labelMatch, false);
  }
});

test('the relation is asymmetric: a 333 name verifies against the reference but not against the 222 token', () => {
  const claimed = U333 + hex('PRISM');
  assert.equal(verifyCip68Pair(REF + hex('PRISM'), claimed).match, true);
  const r = verifyCip68Pair(U222 + hex('PRISM'), claimed);
  assert.equal(r.match, false);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, false);
  assert.deepEqual(r.expectedPairs.map(p => p.label), [100]);
});

test('the right pair label on different name bytes fails the content verdict alone', () => {
  const r = verifyCip68Pair(U222 + hex('GiveYouUp'), REF + hex('NeverGonna'));
  assert.equal(r.match, false);
  assert.equal(r.labelMatch, true);
  assert.equal(r.contentMatch, false);
  assert.equal(r.claimedText, 'NeverGonna');
});

test('an unlabeled copy of the same bytes is not the pair', () => {
  const r = verifyCip68Pair(U222 + hex('PRISM'), hex('PRISM'));
  assert.equal(r.match, false);
  assert.equal(r.contentMatch, true);
  assert.equal(r.labelMatch, false);
  assert.equal(r.claimedLabel, null);
});

test('an unlabeled source has no pair to verify against — scored, not refused, and nothing invented', () => {
  const source = hex('PlainName');
  const r = verifyCip68Pair(source, REF + hex('PlainName'));
  assert.equal(r.sourceKind, 'unlabeled');
  assert.deepEqual(r.expectedPairs, []);
  assert.equal(r.labelMatch, false);
  assert.equal(r.match, false);
  const empty = verifyCip68Pair('', REF);
  assert.equal(empty.match, false);
  assert.equal(empty.contentMatch, false);
  assert.deepEqual(empty.expectedPairs, []);
});

test('a label-only name pairs with the label-only reference name', () => {
  const r = verifyCip68Pair(U222, REF);
  assert.equal(r.match, true);
  assert.equal(r.sourceContentHex, '');
  assert.equal(r.claimedContentHex, '');
});

test('non-printable name bytes pair by bytes and verify standing as hex, never guessed', () => {
  const r = verifyCip68Pair(U222 + 'fffe', REF + 'fffe');
  assert.equal(r.match, true);
  assert.equal(r.contentMatch, true);
  assert.equal(r.claimedText, null);
  assert.equal(r.claimedTextDecodable, false);
});

test('uppercase and whitespace-padded names are the same pair, stated in canonical lowercase', () => {
  const r = verifyCip68Pair('  ' + (U222 + hex('PRISM')).toUpperCase() + ' ', (REF + hex('PRISM')).toUpperCase());
  assert.equal(r.match, true);
  assert.equal(r.sourceNameHex, U222 + hex('PRISM'));
  assert.equal(r.claimedNameHex, REF + hex('PRISM'));
});

test('names that cannot be decoded at all are refused, never scored as a non-pair', () => {
  const good = U222 + hex('PRISM');
  assert.throws(() => verifyCip68Pair('zz', REF + hex('PRISM')));
  assert.throws(() => verifyCip68Pair(good, 'abc'));
  assert.throws(() => verifyCip68Pair(good, 'aa'.repeat(33)));
  assert.throws(() => verifyCip68Pair(good, 'asset1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'));
  assert.throws(() => verifyCip68Pair(42, REF));
  assert.throws(() => verifyCip68Pair(good, null));
});

test('app wires the pair verifier into the network explorer, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyCip68Pair/);
  assert.match(app, /assetPairVerifyPreview/);
  assert.match(app, /asset-pair-verify-source/);
  assert.match(app, /asset-pair-verify-claimed/);
  assert.match(app, /asset-pair-verify-result/);
  assert.match(app, /pairing holds only under one policy/);
  assert.match(app, /v1\.106/);
});
