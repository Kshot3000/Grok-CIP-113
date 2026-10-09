import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, bytesToHex, decodeAddress, deriveSmartWallet, verifyAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Address verification: the checking half of buildAddress. A claimed
// address is compared POSITION BY POSITION against the credentials and
// network it is claimed to be built from — payment (hash AND kind),
// stake (hash AND kind), and network each get their own verdict, and a
// match is byte equality with the address rebuilt from the claims.
// Anchored externally, not self-derived: the official CIP-19 vectors
// verify against their PUBLISHED credentials (the type-00/01/02 vectors
// share the CIP-19 example key/script hashes below), and each component
// verdict is isolated by a claim differing in exactly that position.
const PAY_KEY = '9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e';
const STK_KEY = '337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251';
const SCRIPT = 'c37b1b5dc0669f1d3c61a6fddb2e8fde96be87b881c60bce8e8d542f';
const V0_MAIN = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const V1_MAIN = 'addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh';
const V2_MAIN = 'addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve';
const V0_TEST = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';
const POINTER4 = 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k';
const REWARD = 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw';
const BYRON = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';
const hex = (address) => bytesToHex(decodeAddress(address).bytes);

test('the official CIP-19 vectors verify exactly against their published credentials', () => {
  const cases = [
    [V0_MAIN, 'key', PAY_KEY, 'key', STK_KEY, 1, 0],
    [V1_MAIN, 'script', SCRIPT, 'key', STK_KEY, 1, 1],
    [V2_MAIN, 'key', PAY_KEY, 'script', SCRIPT, 1, 2],
    [V0_TEST, 'key', PAY_KEY, 'key', STK_KEY, 0, 0],
  ];
  for (const [addr, payCred, payHash, stkCred, stkHash, network, type] of cases) {
    const r = verifyAddress(addr, payCred, payHash, stkCred, stkHash, network);
    assert.equal(r.match, true, addr);
    assert.deepEqual(
      { paymentMatch: r.paymentMatch, stakeMatch: r.stakeMatch, networkMatch: r.networkMatch },
      { paymentMatch: true, stakeMatch: true, networkMatch: true },
    );
    assert.equal(r.builtAddress, addr);
    assert.equal(r.type, type);
  }
});

test('every built address verifies against its own inputs, in Bech32 and hex', () => {
  const combos = [
    ['key', 'key'], ['script', 'key'], ['key', 'script'], ['script', 'script'],
    ['key', null], ['script', null],
  ];
  for (const [pay, stk] of combos) {
    for (const network of [0, 1]) {
      const built = buildAddress(pay, '11'.repeat(28), stk, stk ? '22'.repeat(28) : null, network);
      const r = verifyAddress(built.address, pay, '11'.repeat(28), stk, stk ? '22'.repeat(28) : null, network);
      assert.equal(r.match, true, `${pay}/${stk}/${network}`);
      assert.equal(r.builtAddress, built.address);
      const fromHex = verifyAddress(hex(built.address), pay, '11'.repeat(28), stk, stk ? '22'.repeat(28) : null, network);
      assert.equal(fromHex.match, true);
      assert.equal(fromHex.address, built.address);
    }
  }
});

test('a wrong payment hash fails only the payment position', () => {
  const r = verifyAddress(V0_MAIN, 'key', '44'.repeat(28), 'key', STK_KEY, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, false);
  assert.equal(r.stakeMatch, true);
  assert.equal(r.networkMatch, true);
  // The claims are not left vague: what they actually build is shown.
  assert.equal(r.builtAddress, buildAddress('key', '44'.repeat(28), 'key', STK_KEY, 1).address);
  assert.notEqual(r.builtAddress, r.address);
});

test('the payment position is kind-sensitive: the right hash under the wrong kind differs', () => {
  // V1_MAIN's payment position carries the script hash; claiming the
  // same hash as a KEY credential describes a different address (type 2
  // stake arrangement aside, the header itself changes).
  const r = verifyAddress(V1_MAIN, 'key', SCRIPT, 'key', STK_KEY, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, false);
  assert.equal(r.stakeMatch, true);
  assert.equal(r.networkMatch, true);
});

test('a wrong stake hash — or the right hash under the wrong kind — fails only the stake position', () => {
  const wrongHash = verifyAddress(V0_MAIN, 'key', PAY_KEY, 'key', '55'.repeat(28), 1);
  assert.equal(wrongHash.match, false);
  assert.equal(wrongHash.paymentMatch, true);
  assert.equal(wrongHash.stakeMatch, false);
  assert.equal(wrongHash.networkMatch, true);
  const wrongKind = verifyAddress(V0_MAIN, 'key', PAY_KEY, 'script', STK_KEY, 1);
  assert.equal(wrongKind.match, false);
  assert.equal(wrongKind.paymentMatch, true);
  assert.equal(wrongKind.stakeMatch, false);
});

test('a base/enterprise disagreement fails only the stake position, in both directions', () => {
  const ent = buildAddress('key', PAY_KEY, null, null, 1).address;
  const claimedBase = verifyAddress(ent, 'key', PAY_KEY, 'key', STK_KEY, 1);
  assert.equal(claimedBase.match, false);
  assert.equal(claimedBase.paymentMatch, true);
  assert.equal(claimedBase.stakeMatch, false);
  assert.equal(claimedBase.networkMatch, true);
  const claimedEnt = verifyAddress(V0_MAIN, 'key', PAY_KEY, null, null, 1);
  assert.equal(claimedEnt.match, false);
  assert.equal(claimedEnt.paymentMatch, true);
  assert.equal(claimedEnt.stakeMatch, false);
  // And the enterprise address verifies exactly against the enterprise claim:
  // an empty stake position on both sides is a match, not a missing verdict.
  const exact = verifyAddress(ent, 'key', PAY_KEY, null, null, 1);
  assert.equal(exact.match, true);
  assert.equal(exact.stakeMatch, true);
  assert.equal(exact.kind, 'Enterprise');
});

test('a network difference alone blocks the match while every position agrees', () => {
  const r = verifyAddress(V0_TEST, 'key', PAY_KEY, 'key', STK_KEY, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, true);
  assert.equal(r.stakeMatch, true);
  assert.equal(r.networkMatch, false);
  // The claims build the mainnet twin of the testnet candidate.
  assert.equal(r.builtAddress, V0_MAIN);
});

test('a pointer candidate reports its pointer instead of a stake verdict', () => {
  const r = verifyAddress(POINTER4, 'key', PAY_KEY, 'key', STK_KEY, 1);
  assert.equal(r.match, false);
  assert.equal(r.paymentMatch, true);
  assert.equal(r.stakeMatch, false);
  assert.equal(r.networkMatch, true);
  assert.deepEqual(r.pointer, { slot: 2498243, txIndex: 27, certIndex: 3 });
  assert.equal(r.stake, null);
  assert.equal(r.kind, 'Pointer');
});

test('a CIP-113 smart wallet also verifies as the base address it is', () => {
  const owner = buildAddress('key', PAY_KEY, 'key', STK_KEY, 0).address;
  const smart = deriveSmartWallet(owner, SCRIPT, 0);
  // Its composition claim: script payment = base script hash, stake
  // position = the owner's payment credential (key kind, PAY_KEY hash).
  const r = verifyAddress(smart, 'script', SCRIPT, 'key', PAY_KEY, 0);
  assert.equal(r.match, true);
  assert.equal(r.smartWalletShape, true);
});

test('undecodable candidates and malformed claims are refused, never mismatches', () => {
  assert.throws(() => verifyAddress(REWARD, 'key', PAY_KEY, 'key', STK_KEY, 1), /Enter a Cardano addr or addr_test payment address/);
  assert.throws(() => verifyAddress(BYRON, 'key', PAY_KEY, 'key', STK_KEY, 1));
  assert.throws(() => verifyAddress('not an address', 'key', PAY_KEY, 'key', STK_KEY, 1));
  assert.throws(() => verifyAddress('', 'key', PAY_KEY, 'key', STK_KEY, 1));
  // Claim-side validation is the builder's own, messages included.
  assert.throws(() => verifyAddress(V0_MAIN, 'key', '11'.repeat(27), 'key', STK_KEY, 1), /Payment credential hash must be exactly 28 bytes.*got 27 bytes/);
  assert.throws(() => verifyAddress(V0_MAIN, 'key', PAY_KEY, null, STK_KEY, 1), /silently dropped/);
  assert.throws(() => verifyAddress(V0_MAIN, 'key', PAY_KEY, 'key', '', 1), /no stake hash was supplied/);
  assert.throws(() => verifyAddress(V0_MAIN, 'pointer', PAY_KEY, 'key', STK_KEY, 1), /Payment credential must be/);
  assert.throws(() => verifyAddress(V0_MAIN, 'key', PAY_KEY, 'key', STK_KEY, 2), /Network must be 0/);
});

test('uppercase claimed hashes verify the same as lowercase', () => {
  const r = verifyAddress(V0_MAIN, 'key', PAY_KEY.toUpperCase(), 'key', STK_KEY.toUpperCase(), 1);
  assert.equal(r.match, true);
  assert.equal(r.claimedPayment.hash, PAY_KEY);
  assert.equal(r.claimedStake.hash, STK_KEY);
});

test('the network page renders the address verifier in the inspector panel', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Verify an address/);
  assert.match(app, /address-verify-address/);
  assert.match(app, /address-verify-payment-hash/);
  assert.match(app, /address-verify-result/);
  assert.match(app, /addressVerifyPreview/);
  // Honesty copy travels with the feature: a match is composition only.
  assert.match(app, /does not prove anyone holds the payment key/);
  assert.match(app, /refused here rather than reported as a mismatch/);
  assert.match(app, /rebuilt and compared locally \(CIP-19\), position by position/);
});
