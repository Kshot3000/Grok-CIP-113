import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAddress, buildPointerAddress, buildRewardAddress, deriveRewardAddress, verifyDerivedRewardAddress, verifyRewardAddress } from '../src/cardano.js';

// Derived reward address verification — the checking half of
// deriveRewardAddress, in the shape of verifySmartWallet (the checking
// half of the other derivation): the claim is judged against the
// derivation's own output, so verifier and derivation can never disagree.
// Anchored externally on the four official CIP-19 base/reward vector
// pairs — three published artefacts agreeing, not a self-derivation.
const KEY_HASH = '337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251';
const SCRIPT_HASH = 'c37b1b5dc0669f1d3c61a6fddb2e8fde96be87b881c60bce8e8d542f';
const PAIRS = [
  { base: 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x', reward: 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', credential: 'key', hash: KEY_HASH, network: 1, sourceType: 0 },
  { base: 'addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve', reward: 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5', credential: 'script', hash: SCRIPT_HASH, network: 1, sourceType: 2 },
  { base: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae', reward: 'stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gssrtvn', credential: 'key', hash: KEY_HASH, network: 0, sourceType: 0 },
  { base: 'addr_test1yz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shsf5r8qx', reward: 'stake_test17rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcljw6kf', credential: 'script', hash: SCRIPT_HASH, network: 0, sourceType: 2 },
];

test('all four official CIP-19 base addresses verify against their published derived reward addresses', () => {
  for (const p of PAIRS) {
    const r = verifyDerivedRewardAddress(p.reward, p.base);
    assert.equal(r.match, true, p.base);
    assert.equal(r.credentialMatch, true);
    assert.equal(r.networkMatch, true);
    assert.equal(r.address, p.reward);
    assert.equal(r.derivedAddress, p.reward);
    assert.equal(r.derivedCredential, p.credential);
    assert.equal(r.derivedHash, p.hash);
    assert.equal(r.derivedNetwork, p.network);
    assert.equal(r.sourceType, p.sourceType);
    assert.equal(r.sourceAddress, p.base);
    assert.equal(r.inputForm, 'bech32');
    assert.equal(r.sourceInputForm, 'bech32');
  }
});

test('the derived verifier agrees with the derivation and with the component verifier on every vector', () => {
  for (const p of PAIRS) {
    assert.equal(verifyDerivedRewardAddress(p.reward, p.base).derivedAddress, deriveRewardAddress(p.base).address);
    assert.equal(verifyDerivedRewardAddress(p.reward, p.base).match, verifyRewardAddress(p.reward, p.credential, p.hash, p.network).match);
    assert.equal(deriveRewardAddress(p.base).address, buildRewardAddress(p.credential, p.hash, p.network).address);
  }
});

test('the payment credential plays no part: different base addresses sharing one stake credential derive — and verify — the same reward address', () => {
  const byKeyPayment = buildAddress('key', '11'.repeat(28), 'key', KEY_HASH, 1).address;
  const byScriptPayment = buildAddress('script', '22'.repeat(28), 'key', KEY_HASH, 1).address;
  assert.notEqual(byKeyPayment, byScriptPayment);
  assert.equal(deriveRewardAddress(byKeyPayment).address, PAIRS[0].reward);
  assert.equal(deriveRewardAddress(byScriptPayment).address, PAIRS[0].reward);
  assert.equal(verifyDerivedRewardAddress(PAIRS[0].reward, byKeyPayment).match, true);
  assert.equal(verifyDerivedRewardAddress(PAIRS[0].reward, byScriptPayment).match, true);
});

test('the same stake credential on the other network fails the network verdict alone', () => {
  // PAIRS[0] and PAIRS[2] carry the identical key credential; only the
  // network differs, so the credential verdict must pass exactly.
  const r = verifyDerivedRewardAddress(PAIRS[0].reward, PAIRS[2].base);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, true);
  assert.equal(r.networkMatch, false);
  assert.equal(r.hash, r.derivedHash);
  const back = verifyDerivedRewardAddress(PAIRS[2].reward, PAIRS[0].base);
  assert.equal(back.credentialMatch, true);
  assert.equal(back.networkMatch, false);
});

test('the same 28-byte hash under the other credential kind fails the credential verdict alone', () => {
  // A base address carrying KEY_HASH as a SCRIPT stake credential derives
  // the type-15 reward address for those exact bytes; the type-14 vector
  // carrying them as a key credential must fail on kind alone.
  const scriptStakeBase = buildAddress('key', '33'.repeat(28), 'script', KEY_HASH, 1).address;
  const r = verifyDerivedRewardAddress(PAIRS[0].reward, scriptStakeBase);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.hash, KEY_HASH);
  assert.equal(r.derivedHash, KEY_HASH);
  assert.equal(r.credential, 'key');
  assert.equal(r.derivedCredential, 'script');
  assert.equal(r.derivedAddress, buildRewardAddress('script', KEY_HASH, 1).address);
});

test('a different stake hash under the same kind and network fails the credential verdict alone', () => {
  const otherStakeBase = buildAddress('key', '11'.repeat(28), 'key', 'aa'.repeat(28), 1).address;
  const r = verifyDerivedRewardAddress(PAIRS[0].reward, otherStakeBase);
  assert.equal(r.match, false);
  assert.equal(r.credentialMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.derivedHash, 'aa'.repeat(28));
});

test('hex forms verify on both sides, with each side\u2019s form recorded and the canonical addresses reported', () => {
  const sourceHex = buildAddress('key', '11'.repeat(28), 'key', KEY_HASH, 1).hex;
  const r = verifyDerivedRewardAddress('e1' + KEY_HASH, sourceHex);
  assert.equal(r.match, true);
  assert.equal(r.inputForm, 'hex');
  assert.equal(r.sourceInputForm, 'hex');
  assert.equal(r.address, PAIRS[0].reward);
  assert.equal(r.sourceAddress, buildAddress('key', '11'.repeat(28), 'key', KEY_HASH, 1).address);
});

test('uppercase hex and surrounding whitespace are the same claim, stated canonically', () => {
  const sourceHex = buildAddress('key', '11'.repeat(28), 'key', KEY_HASH, 0).hex;
  const r = verifyDerivedRewardAddress('  ' + ('e0' + KEY_HASH).toUpperCase() + ' ', ' ' + sourceHex.toUpperCase() + '  ');
  assert.equal(r.match, true);
  assert.equal(r.address, PAIRS[2].reward);
  assert.equal(r.derivedNetwork, 0);
});

test('an enterprise source has no reward address to check against — refused, never scored', () => {
  const enterprise = buildAddress('key', '11'.repeat(28), null, null, 1).address;
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, enterprise), /Enterprise addresses carry no stake credential/);
});

test('a pointer source\u2019s stake rights follow a registration certificate only a chain lookup can resolve — refused, never scored', () => {
  const pointer = buildPointerAddress('key', '11'.repeat(28), { slot: 2498243, txIndex: 27, certIndex: 3 }, 1).address;
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, pointer), /Pointer addresses carry no stake credential/);
});

test('a candidate that is not a reward address is refused, never scored as a mismatch', () => {
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].base, PAIRS[0].base), /stake or stake_test/);
  const good = PAIRS[0].reward;
  assert.throws(() => verifyDerivedRewardAddress(good.slice(0, 10) + (good[10] === 'q' ? 'p' : 'q') + good.slice(11), PAIRS[0].base), /checksum/);
  assert.throws(() => verifyDerivedRewardAddress('not-an-address', PAIRS[0].base), /stake/);
  assert.throws(() => verifyDerivedRewardAddress(42, PAIRS[0].base), /reward address/);
});

test('a source that is not a payment address is refused, never scored', () => {
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, PAIRS[0].reward), /addr or addr_test/);
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, 'zzzz'), /addr or addr_test|checksum|Shelley/);
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, ''), /addr or addr_test/);
  assert.throws(() => verifyDerivedRewardAddress(PAIRS[0].reward, null), /Shelley payment address/);
});

test('app wires the derived reward verifier into the network explorer, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /verifyDerivedRewardAddress/);
  assert.match(app, /derivedRewardVerifyPreview/);
  assert.match(app, /reward-derive-verify-source/);
  assert.match(app, /reward-derive-verify-claimed/);
  assert.match(app, /reward-derive-verify-result/);
  assert.match(app, /payment credential plays no part/);
  assert.match(app, /v1.96/);
});
