import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRewardAddress, deriveRewardAddress, verifyRewardAddress } from '../src/cardano.js';

// The reward address verifier: the checking half of buildRewardAddress.
// A claimed stake1… / stake_test1… address (or the hex form CIP-30
// returns) is rebuilt from the stake credential and network it is claimed
// to name and compared position by position — credential (hash AND kind)
// and network — following verifyAddress's discipline: a well-formed
// address naming a different credential is a mismatch, while a claim that
// cannot be decoded or built at all is REFUSED, never a mismatch.
// Anchored externally on the four official CIP-19 reward test vectors,
// whose credentials are the stake key and script from the CIP's own
// vector set (the same vectors the inspector suite uses).
const KEY_HASH = '337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251';
const SCRIPT_HASH = 'c37b1b5dc0669f1d3c61a6fddb2e8fde96be87b881c60bce8e8d542f';
const VECTORS = [
  { address: 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', type: 14, credential: 'key', hash: KEY_HASH, network: 1, hex: 'e1' + KEY_HASH },
  { address: 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5', type: 15, credential: 'script', hash: SCRIPT_HASH, network: 1, hex: 'f1' + SCRIPT_HASH },
  { address: 'stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gssrtvn', type: 14, credential: 'key', hash: KEY_HASH, network: 0, hex: 'e0' + KEY_HASH },
  { address: 'stake_test17rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcljw6kf', type: 15, credential: 'script', hash: SCRIPT_HASH, network: 0, hex: 'f0' + SCRIPT_HASH },
];
const BASE_MAINNET = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const BYRON = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';

test('all four official CIP-19 reward vectors verify exactly against their published credentials', () => {
  for (const v of VECTORS) {
    const r = verifyRewardAddress(v.address, v.credential, v.hash, v.network);
    assert.equal(r.match, true, v.address);
    assert.equal(r.credentialMatch, true);
    assert.equal(r.networkMatch, true);
    assert.equal(r.address, v.address);
    assert.equal(r.builtAddress, v.address);
    assert.equal(r.type, v.type);
    assert.equal(r.builtType, v.type);
    assert.equal(r.inputForm, 'bech32');
  }
});

test('the hex form verifies against the same claim, with the form recorded', () => {
  for (const v of VECTORS) {
    const r = verifyRewardAddress(v.hex, v.credential, v.hash, v.network);
    assert.equal(r.match, true, v.hex);
    assert.equal(r.inputForm, 'hex');
    // The canonical address reported is the checksummed Bech32 form.
    assert.equal(r.address, v.address);
    assert.equal(r.hex, v.hex);
  }
});

test('an all-uppercase Bech32 claim verifies and is stated in canonical lowercase', () => {
  const r = verifyRewardAddress(VECTORS[0].address.toUpperCase(), 'key', KEY_HASH, 1);
  assert.equal(r.match, true);
  assert.equal(r.address, VECTORS[0].address);
});

test('a reward address derived from a base address verifies against that base address’s stake credential', () => {
  const derived = deriveRewardAddress(BASE_MAINNET);
  assert.equal(derived.address, VECTORS[0].address);
  const r = verifyRewardAddress(derived.address, 'key', KEY_HASH, 1);
  assert.equal(r.match, true);
});

test('every built reward address verifies against its own inputs', () => {
  const hash = 'ab'.repeat(28);
  for (const credential of ['key', 'script']) {
    for (const network of [0, 1]) {
      const built = buildRewardAddress(credential, hash, network);
      const r = verifyRewardAddress(built.address, credential, hash, network);
      assert.equal(r.match, true, `${credential}/${network}`);
      assert.equal(r.builtAddress, built.address);
    }
  }
});

test('a wrong stake hash differs on the credential position only', () => {
  const r = verifyRewardAddress(VECTORS[0].address, 'key', SCRIPT_HASH, 1);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.hash, KEY_HASH);
  assert.equal(r.claimedHash, SCRIPT_HASH);
  assert.notEqual(r.builtAddress, r.address);
});

test('the right hash under the wrong credential kind differs on the credential position', () => {
  // Same 28 bytes, claimed as a script credential: header type 15, not 14 —
  // a hash-only comparison would pass this silently.
  const r = verifyRewardAddress(VECTORS[0].address, 'script', KEY_HASH, 1);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.type, 14);
  assert.equal(r.builtType, 15);
});

test('a network difference alone differs on the network position and builds the cross-network twin', () => {
  const r = verifyRewardAddress(VECTORS[0].address, 'key', KEY_HASH, 0);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, true);
  assert.equal(r.networkMatch, false);
  assert.equal(r.builtAddress, VECTORS[2].address);
});

test('a flipped hex digit is a well-formed mismatch, not a refusal', () => {
  const hex = VECTORS[0].hex;
  const flipped = hex.slice(0, 10) + (hex[10] === '0' ? '1' : '0') + hex.slice(11);
  const r = verifyRewardAddress(flipped, 'key', KEY_HASH, 1);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.inputForm, 'hex');
});

test('a flipped Bech32 character is refused on its checksum, not reported as a mismatch', () => {
  const b = VECTORS[0].address;
  const flipped = b.slice(0, 10) + (b[10] === 'q' ? 'p' : 'q') + b.slice(11);
  assert.throws(() => verifyRewardAddress(flipped, 'key', KEY_HASH, 1), /checksum/);
});

test('payment, Byron, and garbage candidates are refused, not mismatches', () => {
  assert.throws(() => verifyRewardAddress(BASE_MAINNET, 'key', KEY_HASH, 1), /stake or stake_test reward address/);
  // Byron text is mixed-case Base58, so it is refused as mixed-case Bech32
  // before its prefix is ever read — a refusal either way, never a mismatch.
  assert.throws(() => verifyRewardAddress(BYRON, 'key', KEY_HASH, 1), /Mixed-case Bech32/);
  assert.throws(() => verifyRewardAddress('not an address at all', 'key', KEY_HASH, 1), /stake or stake_test reward address/);
});

test('malformed claims are refused with the builder’s own reasons', () => {
  assert.throws(() => verifyRewardAddress(VECTORS[0].address, 'key', '1111', 1), /got 2 bytes/);
  assert.throws(() => verifyRewardAddress(VECTORS[0].address, 'owner', KEY_HASH, 1), /key hash or a script hash/);
  assert.throws(() => verifyRewardAddress(VECTORS[0].address, 'key', KEY_HASH, 2), /Network must be 0/);
  assert.throws(() => verifyRewardAddress('e13', 'key', KEY_HASH, 1), /even number of characters/);
});
