import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, buildPointerAddress, inspectAddress, verifyAddress, verifyPointerAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The pointer address verifier: the checking half of buildPointerAddress,
// and the one claim verifyAddress cannot check — a pointer address's
// stake position carries a chain pointer, not a credential. A claimed
// pointer address is rebuilt from the payment credential and pointer it
// is claimed to carry and compared position by position — payment
// credential (hash AND kind), slot, transaction index, certificate
// index, network — following the other verifiers' discipline: a
// well-formed pointer address built from different parts is a mismatch,
// while a claim that cannot be decoded or built at all is REFUSED.
// Anchored externally on the four official CIP-19 pointer test vectors:
// the shared pointer is (slot 2498243, transaction 27, certificate 3),
// the type-04 credential is the type-00 vector's payment key hash, and
// the type-05 credential is the type-01 vector's script hash.
const OFFICIAL = {
  mainnet4: 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k',
  mainnet5: 'addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu',
  testnet4: 'addr_test1gz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrdw5vky',
  testnet5: 'addr_test12rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcryqrvmw',
};
const POINTER = { slot: 2498243, txIndex: 27, certIndex: 3 };
const HASH = {
  key: inspectAddress(OFFICIAL.mainnet4).payment.hash,
  script: inspectAddress(OFFICIAL.mainnet5).payment.hash,
};
const BASE_MAINNET = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
// An enterprise address carrying the type-00 vector's payment key hash,
// built from that published hash — no enterprise string is quoted from
// memory.
const ENTERPRISE_MAINNET = buildAddress('key', inspectAddress(BASE_MAINNET).payment.hash, null, '', 1).address;
const REWARD_MAINNET = 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw';
const BYRON = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';

test('all four official CIP-19 pointer vectors verify exactly against their published parts', () => {
  const cases = [
    ['key', 1, OFFICIAL.mainnet4, 4],
    ['script', 1, OFFICIAL.mainnet5, 5],
    ['key', 0, OFFICIAL.testnet4, 4],
    ['script', 0, OFFICIAL.testnet5, 5],
  ];
  for (const [cred, network, expected, type] of cases) {
    const r = verifyPointerAddress(expected, cred, HASH[cred], POINTER, network);
    assert.equal(r.match, true, expected);
    assert.equal(r.paymentMatch, true);
    assert.equal(r.pointerMatch, true);
    assert.equal(r.slotMatch, true);
    assert.equal(r.txIndexMatch, true);
    assert.equal(r.certIndexMatch, true);
    assert.equal(r.networkMatch, true);
    assert.equal(r.address, expected);
    assert.equal(r.builtAddress, expected);
    assert.equal(r.type, type);
    assert.equal(r.builtType, type);
    assert.equal(r.kind, 'Pointer');
    assert.equal(r.inputForm, 'bech32');
    assert.deepEqual(r.pointer, POINTER);
    assert.deepEqual(r.claimedPointer, POINTER);
  }
});

test('the hex form verifies against the same claim, with the form recorded', () => {
  const built = buildPointerAddress('key', HASH.key, POINTER, 1);
  const r = verifyPointerAddress(built.hex, 'key', HASH.key, POINTER, 1);
  assert.equal(r.match, true);
  assert.equal(r.inputForm, 'hex');
  // The canonical address reported is the checksummed Bech32 form.
  assert.equal(r.address, OFFICIAL.mainnet4);
  assert.equal(r.builtHex, built.hex);
});

test('an all-uppercase Bech32 claim verifies and is stated in canonical lowercase', () => {
  const r = verifyPointerAddress(OFFICIAL.testnet5.toUpperCase(), 'script', HASH.script, POINTER, 0);
  assert.equal(r.match, true);
  assert.equal(r.address, OFFICIAL.testnet5);
});

test('every built pointer address verifies against its own inputs across the coordinate grid', () => {
  const grid = [
    [0, 0, 0], [1, 1, 1], [127, 0, 5], [128, 3, 0],
    [2498243, 27, 3], [200_000_000, 999, 17], [Number.MAX_SAFE_INTEGER, 0, 0],
  ];
  for (const [slot, txIndex, certIndex] of grid) {
    for (const cred of ['key', 'script']) {
      for (const network of [0, 1]) {
        const built = buildPointerAddress(cred, HASH[cred], { slot, txIndex, certIndex }, network);
        const r = verifyPointerAddress(built.address, cred, HASH[cred], { slot, txIndex, certIndex }, network);
        assert.equal(r.match, true, `${cred}/${network} (${slot},${txIndex},${certIndex})`);
        assert.equal(r.builtAddress, built.address);
      }
    }
  }
});

test('a wrong payment hash differs on the payment position only', () => {
  const r = verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.script, POINTER, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, false);
  assert.equal(r.pointerMatch, true);
  assert.equal(r.networkMatch, true);
  assert.equal(r.payment.hash, HASH.key);
  assert.equal(r.claimedPayment.hash, HASH.script);
  assert.notEqual(r.builtAddress, r.address);
});

test('the right hash under the wrong credential kind differs on the payment position', () => {
  // Same 28 bytes, claimed as a script credential: header type 5, not 4 —
  // a hash-only comparison would pass this silently.
  const r = verifyPointerAddress(OFFICIAL.mainnet4, 'script', HASH.key, POINTER, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, false);
  assert.equal(r.pointerMatch, true);
  assert.equal(r.type, 4);
  assert.equal(r.builtType, 5);
});

test('each pointer coordinate differs on its own position alone', () => {
  // A pointer off by one coordinate names a different registration
  // certificate; the verdicts stay separate so the failed coordinate is
  // the one named.
  const bySlot = verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, { ...POINTER, slot: POINTER.slot + 1 }, 1);
  assert.equal(bySlot.match, false);
  assert.equal(bySlot.slotMatch, false);
  assert.equal(bySlot.txIndexMatch, true);
  assert.equal(bySlot.certIndexMatch, true);
  assert.equal(bySlot.pointerMatch, false);
  assert.equal(bySlot.paymentMatch, true);
  assert.equal(bySlot.networkMatch, true);
  const byTx = verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, { ...POINTER, txIndex: 28 }, 1);
  assert.equal(byTx.slotMatch, true);
  assert.equal(byTx.txIndexMatch, false);
  assert.equal(byTx.certIndexMatch, true);
  const byCert = verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, { ...POINTER, certIndex: 4 }, 1);
  assert.equal(byCert.slotMatch, true);
  assert.equal(byCert.txIndexMatch, true);
  assert.equal(byCert.certIndexMatch, false);
  assert.equal(byCert.pointer.certIndex, 3);
  assert.equal(byCert.claimedPointer.certIndex, 4);
});

test('a network difference alone differs on the network position and builds the cross-network twin', () => {
  const r = verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, POINTER, 0);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, true);
  assert.equal(r.pointerMatch, true);
  assert.equal(r.networkMatch, false);
  assert.equal(r.builtAddress, OFFICIAL.testnet4);
});

test('a flipped hex digit is a well-formed mismatch, not a refusal', () => {
  const built = buildPointerAddress('key', HASH.key, POINTER, 1);
  const hex = built.hex;
  const flipped = hex.slice(0, 10) + (hex[10] === '0' ? '1' : '0') + hex.slice(11);
  const r = verifyPointerAddress(flipped, 'key', HASH.key, POINTER, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, false);
  assert.equal(r.pointerMatch, true);
  assert.equal(r.inputForm, 'hex');
});

test('a flipped Bech32 character is refused on its checksum, not reported as a mismatch', () => {
  const b = OFFICIAL.mainnet4;
  const flipped = b.slice(0, 10) + (b[10] === 'q' ? 'p' : 'q') + b.slice(11);
  assert.throws(() => verifyPointerAddress(flipped, 'key', HASH.key, POINTER, 1), /checksum/);
});

test('base, enterprise, reward, Byron, and garbage candidates are refused, not mismatches', () => {
  assert.throws(() => verifyPointerAddress(BASE_MAINNET, 'key', HASH.key, POINTER, 1), /base address, not a pointer address/);
  assert.throws(() => verifyPointerAddress(BASE_MAINNET, 'key', HASH.key, POINTER, 1), /carries a stake credential, not a chain pointer/);
  assert.throws(() => verifyPointerAddress(ENTERPRISE_MAINNET, 'key', HASH.key, POINTER, 1), /enterprise address, not a pointer address/);
  assert.throws(() => verifyPointerAddress(ENTERPRISE_MAINNET, 'key', HASH.key, POINTER, 1), /no stake position at all/);
  assert.throws(() => verifyPointerAddress(REWARD_MAINNET, 'key', HASH.key, POINTER, 1), /addr or addr_test payment address/);
  assert.throws(() => verifyPointerAddress(BYRON, 'key', HASH.key, POINTER, 1), /./);
  assert.throws(() => verifyPointerAddress('not an address at all', 'key', HASH.key, POINTER, 1), /./);
});

test('malformed claims are refused with the builder’s own reasons', () => {
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'key', 'abcd', POINTER, 1), /exactly 28 bytes.*got 2 bytes/);
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'stake', HASH.key, POINTER, 1), /key hash or a script hash/);
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, POINTER, 2), /Network must be 0/);
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, { txIndex: 27, certIndex: 3 }, 1), /Slot is required/);
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, { slot: 1.5, txIndex: 27, certIndex: 3 }, 1), /Slot must be a non-negative integer/);
  assert.throws(() => verifyPointerAddress(OFFICIAL.mainnet4, 'key', HASH.key, null, 1), /chain pointer is required/i);
});

test('the address verifier’s pointer report now points at this verifier', async () => {
  // The two verifiers agree about the division of labour: verifyAddress
  // reports a pointer candidate’s stake position as the pointer itself,
  // and its UI copy sends the builder here to check the pointer claim.
  const r = verifyAddress(OFFICIAL.mainnet4, 'key', HASH.key, 'key', HASH.key, 1);
  assert.equal(r.stakeMatch, false);
  assert.deepEqual(r.pointer, POINTER);
  const app = await read('src/app.js');
  assert.match(app, /pointer verifier below the pointer builder/);
});

test('the network page wires the pointer verifier with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /verifyPointerAddress/);
  assert.match(app, /Verify a pointer address/);
  assert.match(app, /id="pointer-verify-address"/);
  assert.match(app, /id="pointer-verify-result"/);
  assert.match(app, /id="pointer-verify-slot"/);
  assert.match(app, /POINTER ADDRESS MATCHES/);
  assert.match(app, /does not prove the certificate the pointer names exists/);
  assert.match(app, /refused here rather than reported as a mismatch/);
});
