import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cip68Pair, decodeAssetName } from '../src/cardano.js';

const hex = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

test('a user NFT (222) pairs with the label-100 reference token of the same name bytes', () => {
  const r = cip68Pair('000de140' + hex('GiveYouUp'));
  assert.equal(r.kind, 'user');
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].label, 100);
  assert.equal(r.pairs[0].role, 'Reference token');
  // The content bytes are preserved exactly — the pair is NOT the separate
  // CIP-68 worked example "GenToken"; it is this token's own name, relabelled.
  assert.equal(r.pairs[0].nameHex, '000643b0' + hex('GiveYouUp'));
  assert.equal(r.pairs[0].text, 'GiveYouUp');
});

test('user FT (333) and RFT (444) pair with the same single reference name', () => {
  for (const prefix of ['0014df10', '001bc280']) {
    const r = cip68Pair(prefix + hex('PRISM'));
    assert.equal(r.kind, 'user');
    assert.deepEqual(r.pairs.map(p => p.nameHex), ['000643b0' + hex('PRISM')]);
    assert.equal(r.pairs[0].text, 'PRISM');
  }
});

test('a reference token (100) yields all three user candidates, none picked', () => {
  const r = cip68Pair('000643b0' + hex('GenToken'));
  assert.equal(r.kind, 'reference');
  assert.deepEqual(r.pairs.map(p => p.label), [222, 333, 444]);
  assert.deepEqual(r.pairs.map(p => p.nameHex), [
    '000de140' + hex('GenToken'),
    '0014df10' + hex('GenToken'),
    '001bc280' + hex('GenToken'),
  ]);
  assert.ok(r.pairs.every(p => p.text === 'GenToken'));
});

test('pairing round-trips: the reference of a user token pairs back to it', () => {
  const user = '0014df10' + hex('RoundTrip');
  const ref = cip68Pair(user).pairs[0].nameHex;
  const back = cip68Pair(ref);
  assert.ok(back.pairs.some(p => p.nameHex === user),
    'the original user name must be among the reference token\u2019s candidates');
});

test('every paired name is itself a valid decodable asset name of the same length', () => {
  for (const name of ['000de140' + hex('Café'), '000643b0', '001bc280' + 'ff'.repeat(28)]) {
    const r = cip68Pair(name);
    for (const p of r.pairs) {
      const d = decodeAssetName(p.nameHex);
      assert.equal(d.label.label, p.label);
      assert.equal(p.nameHex.length, name.length);
    }
  }
});

test('a label-only user name pairs with the label-only reference name', () => {
  const r = cip68Pair('000de140');
  assert.equal(r.kind, 'user');
  assert.equal(r.pairs[0].nameHex, '000643b0');
  assert.equal(r.pairs[0].text, '');
  assert.equal(r.pairs[0].textDecodable, true);
});

test('an unlabeled plain name has no pair', () => {
  const r = cip68Pair(hex('PRA'));
  assert.equal(r.kind, 'unlabeled');
  assert.deepEqual(r.pairs, []);
});

test('the empty name has no pair', () => {
  const r = cip68Pair('');
  assert.equal(r.kind, 'unlabeled');
  assert.deepEqual(r.pairs, []);
});

test('non-printable name bytes stay undecoded in the pair, never guessed', () => {
  const r = cip68Pair('000de140fffe0080');
  assert.equal(r.pairs[0].nameHex, '000643b0fffe0080');
  assert.equal(r.pairs[0].text, null);
  assert.equal(r.pairs[0].textDecodable, false);
});

test('uppercase hex is accepted and paired names are canonical lowercase', () => {
  const r = cip68Pair('000DE140' + hex('PRISM').toUpperCase());
  assert.equal(r.pairs[0].nameHex, '000643b0' + hex('PRISM'));
});

test('invalid names throw instead of producing a pair', () => {
  assert.throws(() => cip68Pair('abc'));
  assert.throws(() => cip68Pair('zz'));
  assert.throws(() => cip68Pair('aa'.repeat(33)));
  assert.throws(() => cip68Pair(42));
});

test('app wires the pair finder into the asset lookup, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /cip68Pair/);
  assert.match(app, /asset-pair/);
  assert.match(app, /does not prove the paired token was minted/);
});
