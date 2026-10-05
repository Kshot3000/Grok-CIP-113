import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blake2b, bytesToHex, assetFingerprint } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The eight test vectors published in CIP-0014 (cardano-foundation/CIPs),
// copied verbatim 2026-10-04: policy_id and asset_name are base16, the
// fingerprint is the Bech32 'asset' encoding of blake2b-160(policy ‖ name).
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

test('asset fingerprint reproduces every published CIP-14 test vector', () => {
  for (const [policy, name, expected] of CIP14_VECTORS) {
    assert.equal(assetFingerprint(policy, name), expected, `policy ${policy} name ${name}`);
  }
});

test('blake2b matches the reference digest for empty, short, and multi-block inputs', () => {
  // Reference values cross-checked against hashlib.blake2b (Python) this run.
  assert.equal(bytesToHex(blake2b(new Uint8Array(0), 64)),
    '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce');
  assert.equal(bytesToHex(blake2b(new TextEncoder().encode('abc'), 64)),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923');
  // 512 bytes forces several compression blocks plus a padded final block.
  const wide = Uint8Array.from({ length: 512 }, (_, i) => i % 256);
  assert.equal(bytesToHex(blake2b(wide, 32)),
    '540b20132d8aeae54057cb69c24f95d26a1c472cc700dd450defe9bb796d4f14');
  assert.equal(bytesToHex(blake2b(new Uint8Array(200).fill(97), 20)),
    '48b666ff92747148c4dfe4e2437fe78dd64872d1');
  assert.throws(() => blake2b('abc', 20), /must be bytes/);
  assert.throws(() => blake2b(new Uint8Array(0), 0), /between 1 and 64/);
  assert.throws(() => blake2b(new Uint8Array(0), 65), /between 1 and 64/);
});

test('fingerprint canonicalises hex case and treats an empty name as valid', () => {
  const [policy, , expected] = CIP14_VECTORS[0];
  assert.equal(assetFingerprint(policy.toUpperCase(), ''), expected);
  assert.equal(assetFingerprint(policy, ''), expected);
  // A one-character policy change must change the fingerprint (vector 2).
  assert.notEqual(assetFingerprint(policy, ''), CIP14_VECTORS[1][2]);
});

test('fingerprint rejects malformed policy ids and asset names', () => {
  const policy = CIP14_VECTORS[0][0];
  for (const bad of ['', policy.slice(2), policy + 'ab', 'zz' + policy.slice(2), 42, null]) {
    assert.throws(() => assetFingerprint(bad, ''), /Policy ID must be 56 hexadecimal/);
  }
  for (const bad of ['0', 'zz', 'ab'.repeat(33), 7, undefined]) {
    assert.throws(() => assetFingerprint(policy, bad), /Asset name must contain 0–32 bytes/);
  }
  // Exactly 32 name bytes is the boundary and stays valid.
  assert.ok(assetFingerprint(policy, 'ab'.repeat(32)).startsWith('asset1'));
});

test('the network page wires the local fingerprint, live preview, and Koios cross-check', async () => {
  const app = await read('src/app.js');
  const config = await read('src/config.js');
  assert.match(app, /id="asset-fingerprint"/);
  assert.match(app, /fingerprintPreview\(\$\('#asset-policy'\)\.value/);
  assert.match(app, /assetFingerprint\(policy,nameHex\)/);
  // Honesty copy travels with the feature: local computation, agreement and
  // disagreement are both surfaced, and identity never implies authenticity.
  assert.match(app, /COMPUTED LOCALLY/);
  assert.match(app, /Koios fingerprint matches the local CIP-14 computation/);
  assert.match(app, /Koios returned a different fingerprint — do not rely on this result/);
  assert.match(app, /does not prove authenticity, backing, or registry membership/);
  assert.match(app, /needs no network/);
  assert.match(config, /CIP-14 asset fingerprint/);
  assert.match(config, /CIP-0014/);
});
