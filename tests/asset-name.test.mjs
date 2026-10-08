import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAssetName, CIP68_LABELS } from '../src/cardano.js';

const hex = s => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');

test('official CIP-68 example: label 100 reference token named GenToken', () => {
  const d = decodeAssetName('000643b047656e546f6b656e');
  assert.equal(d.label.label, 100);
  assert.equal(d.label.role, 'Reference token');
  assert.equal(d.text, 'GenToken');
  assert.equal(d.byteLength, 12);
});

test('official CIP-68 example: label 222 user NFT named GiveYouUp', () => {
  const d = decodeAssetName('000de14047697665596f755570');
  assert.equal(d.label.label, 222);
  assert.equal(d.text, 'GiveYouUp');
});

test('labels 333 and 444 decode with their roles and shared name', () => {
  assert.equal(decodeAssetName('0014df10' + hex('PRISM')).label.label, 333);
  assert.equal(decodeAssetName('0014df10' + hex('PRISM')).text, 'PRISM');
  assert.equal(decodeAssetName('001bc280' + hex('PRISM')).label.label, 444);
  assert.deepEqual(Object.keys(CIP68_LABELS).sort(), ['000643b0', '000de140', '0014df10', '001bc280']);
});

test('plain UTF-8 name without a label prefix decodes in full', () => {
  const d = decodeAssetName(hex('PRA'));
  assert.equal(d.label, null);
  assert.equal(d.text, 'PRA');
  assert.equal(d.contentHex, hex('PRA'));
});

test('empty asset name is a valid empty result', () => {
  const d = decodeAssetName('');
  assert.equal(d.empty, true);
  assert.equal(d.text, '');
  assert.equal(d.label, null);
});

test('label prefix with no name bytes decodes to empty text', () => {
  const d = decodeAssetName('000643b0');
  assert.equal(d.label.label, 100);
  assert.equal(d.text, '');
  assert.equal(d.textDecodable, true);
});

test('non-UTF-8 bytes are never guessed: text is null', () => {
  const d = decodeAssetName('fffe0080');
  assert.equal(d.text, null);
  assert.equal(d.textDecodable, false);
});

test('control characters are not printable text', () => {
  const d = decodeAssetName('410042'); // "A\0B"
  assert.equal(d.text, null);
  assert.equal(d.textDecodable, false);
});

test('multibyte UTF-8 after a label decodes exactly', () => {
  const d = decodeAssetName('000de140' + hex('Café ☕'));
  assert.equal(d.text, 'Café ☕');
});

test('uppercase hex is accepted and canonicalised', () => {
  const d = decodeAssetName('000643B047656E546F6B656E');
  assert.equal(d.label.label, 100);
  assert.equal(d.text, 'GenToken');
});

test('invalid names throw: odd length, non-hex, over 32 bytes', () => {
  assert.throws(() => decodeAssetName('abc'));
  assert.throws(() => decodeAssetName('zz'));
  assert.throws(() => decodeAssetName('aa'.repeat(33)));
  assert.throws(() => decodeAssetName(42));
});

test('app wires the decoder into the asset lookup, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /decodeAssetName/);
  assert.match(app, /asset-name-decoded/);
  assert.match(app, /does not prove CIP-68 metadata exists/);
});
