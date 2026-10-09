import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyAssetName, encodeAssetName, decodeAssetName } from '../src/cardano.js';

const hex = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

test('the official CIP-68 examples verify exactly against their label and text', () => {
  const ref = verifyAssetName('000643b047656e546f6b656e', 100, 'GenToken');
  assert.equal(ref.match, true);
  assert.equal(ref.labelMatch, true);
  assert.equal(ref.contentMatch, true);
  assert.equal(ref.nameHex, '000643b047656e546f6b656e');
  assert.equal(ref.builtNameHex, ref.nameHex);
  assert.equal(ref.label.role, 'Reference token');
  const user = verifyAssetName('000de14047697665596f755570', 222, 'GiveYouUp');
  assert.equal(user.match, true);
  assert.equal(user.text, 'GiveYouUp');
  assert.equal(user.byteLength, 13);
});

test('every encoded name verifies against its own inputs, across labels and texts', () => {
  for (const [label, text] of [[100, 'GenToken'], [222, 'GiveYouUp'], [333, 'Café ☕'], [444, ''], [100, ''], [null, 'PRA'], [null, ''], [333, 'é'.repeat(14)]]) {
    const enc = encodeAssetName(label, text);
    const r = verifyAssetName(enc.nameHex, label, text);
    assert.equal(r.match, true, `${label}/${text}`);
    assert.equal(r.labelMatch, true);
    assert.equal(r.contentMatch, true);
    assert.equal(r.builtNameHex, enc.nameHex);
    assert.equal(r.builtDecoded.text, text);
    assert.equal(r.decoded.contentHex, enc.contentHex);
  }
});

test('an all-uppercase or whitespace-padded candidate is the same name, stated in canonical lowercase', () => {
  const r = verifyAssetName('  000DE14047697665596F755570 ', 222, 'GiveYouUp');
  assert.equal(r.match, true);
  assert.equal(r.nameHex, '000de14047697665596f755570');
});

test('a label difference alone fails only the label position — the reference/user trap', () => {
  // The label-222 user token and the label-100 reference token of the same
  // text share every byte after the prefix: the bytes match, the label
  // does not, and those are different tokens.
  const r = verifyAssetName('000de14047697665596f755570', 100, 'GiveYouUp');
  assert.equal(r.match, false);
  assert.equal(r.labelMatch, false);
  assert.equal(r.contentMatch, true);
  assert.equal(r.label.label, 222);
  assert.equal(r.builtLabel.label, 100);
  assert.equal(r.builtNameHex, '000643b047697665596f755570');
  // Same isolation between two user labels.
  const r2 = verifyAssetName('000de14047697665596f755570', 333, 'GiveYouUp');
  assert.equal(r2.labelMatch, false);
  assert.equal(r2.contentMatch, true);
  assert.equal(r2.match, false);
});

test('a text difference alone fails only the name-bytes position', () => {
  const r = verifyAssetName('000de14047697665596f755570', 222, 'NeverGonna');
  assert.equal(r.match, false);
  assert.equal(r.labelMatch, true);
  assert.equal(r.contentMatch, false);
  assert.equal(r.text, 'GiveYouUp');
  assert.equal(r.builtNameHex, encodeAssetName(222, 'NeverGonna').nameHex);
});

test('labeled and unlabeled claims fail on the label position in both directions, bytes equal', () => {
  // A labeled candidate claimed as a plain name: the bytes after the
  // prefix ARE the plain text bytes, so content matches and only the
  // label position carries the difference.
  const a = verifyAssetName('000de14047697665596f755570', null, 'GiveYouUp');
  assert.equal(a.match, false);
  assert.equal(a.labelMatch, false);
  assert.equal(a.contentMatch, true);
  // A plain-name candidate claimed under a label: the decoder reads the
  // whole name as content, which again equals the claimed text bytes.
  const b = verifyAssetName(hex('GiveYouUp'), 222, 'GiveYouUp');
  assert.equal(b.match, false);
  assert.equal(b.labelMatch, false);
  assert.equal(b.contentMatch, true);
  assert.equal(b.label, null);
});

test('candidate bytes that are not printable UTF-8 are a mismatch standing as hex, never a refusal', () => {
  const r = verifyAssetName('000de140fffe', 222, 'GiveYouUp');
  assert.equal(r.match, false);
  assert.equal(r.labelMatch, true);
  assert.equal(r.contentMatch, false);
  assert.equal(r.text, null);
  assert.equal(r.textDecodable, false);
  assert.equal(r.contentHex, 'fffe');
});

test('the empty name and the label-only name verify against their claims', () => {
  const empty = verifyAssetName('', null, '');
  assert.equal(empty.match, true);
  assert.equal(empty.byteLength, 0);
  assert.equal(empty.label, null);
  const labelOnly = verifyAssetName('000643b0', 100, '');
  assert.equal(labelOnly.match, true);
  assert.equal(labelOnly.contentHex, '');
  assert.equal(labelOnly.text, '');
});

test('a candidate that cannot be decoded at all is refused, never reported as a mismatch', () => {
  assert.throws(() => verifyAssetName('zz', 222, 'GiveYouUp'), /hexadecimal/);
  assert.throws(() => verifyAssetName('abc', 222, 'GiveYouUp'), /hexadecimal/);
  assert.throws(() => verifyAssetName('aa'.repeat(33), null, ''), /hexadecimal/);
  // A fingerprint is a hash — a different identifier, not a name.
  assert.throws(() => verifyAssetName('asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92', 222, 'GiveYouUp'), /hexadecimal/);
  assert.throws(() => verifyAssetName(42, 222, 'GiveYouUp'));
});

test('an unbuildable claim is refused with the builder\u2019s own reason, never scored', () => {
  const good = '000de14047697665596f755570';
  assert.throws(() => verifyAssetName(good, 999, 'GiveYouUp'), /label must be 100, 222, 333, or 444/);
  assert.throws(() => verifyAssetName(good, '222', 'GiveYouUp'), /label must be/);
  assert.throws(() => verifyAssetName(good, 222, 'A\nB'), /printable/);
  assert.throws(() => verifyAssetName(good, 222, 'a'.repeat(29)), /33 bytes/);
  assert.throws(() => verifyAssetName(good, 222, 42), /must be a string/);
});

test('the return carries exactly the documented keys — no design or claim object to apply', () => {
  const r = verifyAssetName('000de14047697665596f755570', 222, 'GiveYouUp');
  assert.deepEqual(Object.keys(r).sort(), [
    'builtByteLength', 'builtContentHex', 'builtDecoded', 'builtLabel', 'builtNameHex',
    'byteLength', 'claimedLabel', 'claimedText', 'contentHex', 'contentMatch', 'decoded',
    'label', 'labelMatch', 'match', 'nameHex', 'text', 'textDecodable',
  ].sort());
});

test('verification never disagrees with the decoder about what a name says', () => {
  for (const nameHex of ['000643b047656e546f6b656e', '000de14047697665596f755570', hex('plain'), '']) {
    const d = decodeAssetName(nameHex);
    const r = verifyAssetName(nameHex, d.label?.label ?? null, d.text ?? '');
    if (d.textDecodable) assert.equal(r.match, true, nameHex);
    assert.equal(r.contentHex, d.contentHex);
    assert.equal(r.text, d.text);
  }
});

test('app wires the verifier under the name builder, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyAssetName/);
  assert.match(app, /asset-name-verify-claimed/);
  assert.match(app, /assetNameVerifyPreview/);
  assert.match(app, /does not prove the token was minted/);
  assert.match(app, /refused here rather than reported as a mismatch/);
});
