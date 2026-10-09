import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blake2b, bytesToHex, hexToBytes, encodeBech32, assetFingerprint, decodeAssetFingerprint, verifyAssetFingerprint } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The eight test vectors published in CIP-0014 — the same external anchor
// the fingerprint computation itself is pinned against (asset-fingerprint
// suite). Verification is therefore checked against published values, not
// against PRISM's own output alone.
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

test('every published CIP-14 vector verifies as a match against its own identifiers', () => {
  for (const [policy, name, fingerprint] of CIP14_VECTORS) {
    const r = verifyAssetFingerprint(policy, name, fingerprint);
    assert.equal(r.match, true, `policy ${policy} name ${name}`);
    assert.equal(r.computedFingerprint, fingerprint);
    assert.equal(r.claimedFingerprint, fingerprint);
    assert.equal(r.computedDigestHex, r.claimedDigestHex);
    assert.equal(r.policyId, policy);
    assert.equal(r.assetNameHex, name);
  }
});

test('decoding a fingerprint yields the published 20-byte digest and re-encodes canonically', () => {
  for (const [policy, name, fingerprint] of CIP14_VECTORS) {
    const d = decodeAssetFingerprint(fingerprint);
    assert.equal(d.byteLength, 20);
    assert.equal(d.fingerprint, fingerprint);
    // The digest is anchored independently: BLAKE2b-160 of policy ‖ name,
    // computed here from the raw parts rather than via assetFingerprint.
    const bytes = new Uint8Array(28 + name.length / 2);
    bytes.set(hexToBytes(policy), 0);
    if (name) bytes.set(hexToBytes(name), 28);
    assert.equal(d.digestHex, bytesToHex(blake2b(bytes, 20)));
  }
});

test('a fingerprint of a different asset is a mismatch, not a refusal', () => {
  // Vector 2 differs from vector 1 by one policy character — the classic
  // near-miss a builder pastes from the wrong explorer row.
  const r = verifyAssetFingerprint(CIP14_VECTORS[0][0], '', CIP14_VECTORS[1][2]);
  assert.equal(r.match, false);
  assert.equal(r.computedFingerprint, CIP14_VECTORS[0][2]);
  assert.equal(r.claimedFingerprint, CIP14_VECTORS[1][2]);
  assert.notEqual(r.computedDigestHex, r.claimedDigestHex);
  // Same policy, different name: the empty-name and PATATE fingerprints swap.
  const s = verifyAssetFingerprint(CIP14_VECTORS[0][0], '504154415445', CIP14_VECTORS[0][2]);
  assert.equal(s.match, false);
  assert.equal(s.computedFingerprint, CIP14_VECTORS[3][2]);
});

test('an all-uppercase fingerprint is the same fingerprint, stated canonically', () => {
  const [policy, name, fingerprint] = CIP14_VECTORS[3];
  const d = decodeAssetFingerprint(fingerprint.toUpperCase());
  assert.equal(d.fingerprint, fingerprint);
  assert.equal(verifyAssetFingerprint(policy, name, fingerprint.toUpperCase()).match, true);
  // Surrounding whitespace on a pasted claim is trimmed by the verifier.
  assert.equal(verifyAssetFingerprint(policy, name, `  ${fingerprint} `).match, true);
});

test('a corrupted fingerprint is refused, never reported as a mismatch', () => {
  const [policy, , fingerprint] = CIP14_VECTORS[0];
  const flipped = fingerprint.slice(0, -1) + (fingerprint.endsWith('3') ? '4' : '3');
  assert.throws(() => verifyAssetFingerprint(policy, '', flipped), /checksum is invalid/);
  assert.throws(() => decodeAssetFingerprint(flipped), /checksum is invalid/);
  assert.throws(() => decodeAssetFingerprint('asset1' + fingerprint.slice(6).toUpperCase()), /Mixed-case/);
});

test('strings that are not asset fingerprints are refused with the identifier named', () => {
  for (const bad of ['', 'asset1', 'hello', 'addr1q9e34gpjgx6nx3gj7s3qvf5jfyygg9k4s0', 42, null, undefined]) {
    assert.throws(() => decodeAssetFingerprint(bad), /asset fingerprint|asset1…/, `input ${String(bad)}`);
  }
  // A valid Bech32 string under the wrong prefix is a different identifier.
  const addrLike = encodeBech32('addr', new Uint8Array(20).fill(7));
  assert.throws(() => decodeAssetFingerprint(addrLike), /asset fingerprint/);
});

test('a checksummed payload that is not 20 bytes is refused with its byte count', () => {
  for (const len of [19, 21, 32]) {
    const s = encodeBech32('asset', new Uint8Array(len).fill(9));
    assert.throws(() => decodeAssetFingerprint(s), new RegExp(`carries ${len} bytes`));
    assert.throws(() => verifyAssetFingerprint(CIP14_VECTORS[0][0], '', s), /not a CIP-14 fingerprint/);
  }
});

test('verification validates the identifiers before the claim', () => {
  const [, , fingerprint] = CIP14_VECTORS[0];
  assert.throws(() => verifyAssetFingerprint('abcd', '', fingerprint), /Policy ID must be 56 hexadecimal/);
  assert.throws(() => verifyAssetFingerprint(CIP14_VECTORS[0][0], 'zz', fingerprint), /Asset name must contain 0–32 bytes/);
  assert.throws(() => verifyAssetFingerprint(CIP14_VECTORS[0][0], '', ''), /Enter an asset fingerprint/);
});

test('the network page wires the fingerprint verifier with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /verifyAssetFingerprint/);
  assert.match(app, /Verify an asset fingerprint/);
  assert.match(app, /id="asset-verify-claimed"/);
  assert.match(app, /id="asset-verify-result"/);
  assert.match(app, /FINGERPRINT MATCHES/);
  assert.match(app, /does not prove the asset was minted/);
});
