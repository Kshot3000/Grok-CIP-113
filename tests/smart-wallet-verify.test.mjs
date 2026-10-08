import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, bytesToHex, decodeAddress, deriveSmartWallet, verifySmartWallet } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Smart-wallet verification: the checking half of deriveSmartWallet.
// A claimed smart wallet, a claimed owner, and a claimed base script
// hash are re-derived and compared POSITION BY POSITION — shape, base
// script (payment position), owner (stake position, kind included),
// and network each get their own verdict, so a mismatch names which
// claim failed. A match is byte equality with the re-derived address.
// The derivation it checks against is itself anchored by the existing
// inspector / builder suites on the CIP-113 construction; here every
// component verdict is isolated by a candidate that differs in exactly
// that position and no other.
const PAY = '11'.repeat(28);
const STK = '22'.repeat(28);
const SCRIPT = 'ab'.repeat(28);
const OWNER = buildAddress('key', PAY, 'key', STK, 0).address;
const SMART = deriveSmartWallet(OWNER, SCRIPT, 0);
// Official CIP-19 pointer vector (type 4, mainnet) — no stake credential.
const POINTER = 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k';
const hex = (address) => bytesToHex(decodeAddress(address).bytes);

test('a derived smart wallet verifies exactly against its own owner and base script', () => {
  const r = verifySmartWallet(SMART, OWNER, SCRIPT);
  assert.equal(r.match, true);
  assert.deepEqual(
    { shape: r.shape, networkMatch: r.networkMatch, baseScriptMatch: r.baseScriptMatch, ownerMatch: r.ownerMatch },
    { shape: true, networkMatch: true, baseScriptMatch: true, ownerMatch: true },
  );
  assert.equal(r.derivedAddress, SMART);
  assert.equal(r.address, SMART);
  assert.equal(r.type, 1);
});

test('a script owner\u2019s smart wallet (header type 3) verifies exactly too', () => {
  const scriptOwner = buildAddress('script', '33'.repeat(28), 'key', '44'.repeat(28), 0).address;
  const smart3 = deriveSmartWallet(scriptOwner, SCRIPT, 0);
  const r = verifySmartWallet(smart3, scriptOwner, SCRIPT);
  assert.equal(r.match, true);
  assert.equal(r.type, 3);
  assert.equal(r.ownerCredential, 'script');
});

test('verification accepts the hex form of either address, as CIP-30 returns them', () => {
  assert.equal(verifySmartWallet(hex(SMART), OWNER, SCRIPT).match, true);
  assert.equal(verifySmartWallet(SMART, hex(OWNER), SCRIPT).match, true);
  const both = verifySmartWallet(hex(SMART), hex(OWNER), SCRIPT);
  assert.equal(both.match, true);
  assert.equal(both.address, SMART);
});

test('a wrong base script fails only the base-script position', () => {
  const other = 'cd'.repeat(28);
  const r = verifySmartWallet(SMART, OWNER, other);
  assert.equal(r.match, false);
  assert.equal(r.baseScriptMatch, false);
  assert.equal(r.ownerMatch, true);
  assert.equal(r.networkMatch, true);
  assert.equal(r.shape, true);
  // The claims are not left vague: what they actually derive is shown.
  assert.equal(r.derivedAddress, deriveSmartWallet(OWNER, other, 0));
  assert.notEqual(r.derivedAddress, r.address);
});

test('a wrong owner fails only the owner position', () => {
  const otherOwner = buildAddress('key', '55'.repeat(28), 'key', STK, 0).address;
  const r = verifySmartWallet(SMART, otherOwner, SCRIPT);
  assert.equal(r.match, false);
  assert.equal(r.ownerMatch, false);
  assert.equal(r.baseScriptMatch, true);
  assert.equal(r.networkMatch, true);
  assert.equal(r.derivedAddress, deriveSmartWallet(otherOwner, SCRIPT, 0));
});

test('the owner position is kind-sensitive: the right hash under the wrong kind differs', () => {
  // A type-3 candidate carries the owner's payment HASH in its stake
  // position, but as a script credential — derivation from a key owner
  // produces a type-1 address, so hash equality alone must not pass.
  const kindSwapped = buildAddress('script', SCRIPT, 'script', PAY, 0).address;
  const r = verifySmartWallet(kindSwapped, OWNER, SCRIPT);
  assert.equal(r.stake.hash, PAY);
  assert.equal(r.stake.credential, 'script');
  assert.equal(r.ownerMatch, false);
  assert.equal(r.baseScriptMatch, true);
  assert.equal(r.match, false);
});

test('an ordinary base address is not a smart-wallet shape and does not verify', () => {
  const r = verifySmartWallet(OWNER, OWNER, SCRIPT);
  assert.equal(r.shape, false);
  assert.equal(r.baseScriptMatch, false);
  assert.equal(r.ownerMatch, false);
  assert.equal(r.match, false);
});

test('an enterprise script address matches the script position but has no owner position', () => {
  // Informative, not just false: the payment position really is the
  // claimed script — what is missing is any stake credential at all.
  const enterprise = buildAddress('script', SCRIPT, null, null, 0).address;
  const r = verifySmartWallet(enterprise, OWNER, SCRIPT);
  assert.equal(r.shape, false);
  assert.equal(r.baseScriptMatch, true);
  assert.equal(r.stake, null);
  assert.equal(r.ownerMatch, false);
  assert.equal(r.match, false);
});

test('a pointer address carries no owner position and does not verify', () => {
  const mainnetOwner = buildAddress('key', PAY, 'key', STK, 1).address;
  const r = verifySmartWallet(POINTER, mainnetOwner, SCRIPT);
  assert.equal(r.shape, false);
  assert.equal(r.stake, null);
  assert.equal(r.ownerMatch, false);
  assert.equal(r.networkMatch, true);
  assert.equal(r.match, false);
});

test('a network difference alone blocks the match, and no address is derived across networks', () => {
  const mainnetOwner = buildAddress('key', PAY, 'key', STK, 1).address;
  const r = verifySmartWallet(SMART, mainnetOwner, SCRIPT);
  // Every position that CAN agree does — network is the sole failure.
  assert.equal(r.shape, true);
  assert.equal(r.baseScriptMatch, true);
  assert.equal(r.ownerMatch, true);
  assert.equal(r.networkMatch, false);
  assert.equal(r.derivedAddress, null);
  assert.equal(r.match, false);
});

test('a mainnet smart wallet verifies on mainnet', () => {
  const mainnetOwner = buildAddress('key', PAY, 'key', STK, 1).address;
  const smartMain = deriveSmartWallet(mainnetOwner, SCRIPT, 1);
  const r = verifySmartWallet(smartMain, mainnetOwner, SCRIPT);
  assert.equal(r.match, true);
  assert.equal(r.networkName, 'Mainnet');
});

test('undecodable claims are refused, not reported as mismatches', () => {
  // A reward address is not a payment address at all.
  assert.throws(() => verifySmartWallet('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', OWNER, SCRIPT), /Shelley payment address|addr or addr_test/);
  // A Byron address likewise.
  assert.throws(() => verifySmartWallet('Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi', OWNER, SCRIPT));
  // A base script hash that is not exactly 28 bytes.
  assert.throws(() => verifySmartWallet(SMART, OWNER, 'ab'.repeat(27)), /exactly 56 hexadecimal characters/);
  assert.throws(() => verifySmartWallet(SMART, OWNER, 'zz'.repeat(28)), /exactly 56 hexadecimal characters/);
  // A garbage owner.
  assert.throws(() => verifySmartWallet(SMART, 'not-an-address', SCRIPT));
});

test('the network page wires the verifier with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Verify a smart-wallet address/);
  assert.match(app, /verify-form/);
  assert.match(app, /verify-result/);
  assert.match(app, /verifySmartWallet/);
  assert.match(app, /a mismatch names which claim failed/);
  // A match is a derivation fact, never a deployment or registry claim.
  assert.match(app, /does not prove the base script is deployed/);
  assert.match(app, /Nothing was looked up on chain/);
});
