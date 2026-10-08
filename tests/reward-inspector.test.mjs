import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAddress, buildRewardAddress, deriveRewardAddress, inspectRewardAddress } from '../src/cardano.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// The standalone reward (stake) address inspector: the decoder the wallet
// address book uses internally, exposed on the Network page so a builder
// can paste a stake / stake_test address — or the hex form CIP-30 returns
// reward addresses in — and read the CIP-19 credential it names. Anchored
// externally on the four official CIP-19 reward test vectors (header types
// 14 and 15, mainnet and testnet), whose credentials are the stake key and
// the script from the CIP's own vector set.
const KEY_HASH = '337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251';
const SCRIPT_HASH = 'c37b1b5dc0669f1d3c61a6fddb2e8fde96be87b881c60bce8e8d542f';
const VECTORS = [
  { address: 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', type: 14, credential: 'key', hash: KEY_HASH, network: 1, networkName: 'Mainnet', hex: 'e1' + KEY_HASH },
  { address: 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5', type: 15, credential: 'script', hash: SCRIPT_HASH, network: 1, networkName: 'Mainnet', hex: 'f1' + SCRIPT_HASH },
  { address: 'stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gssrtvn', type: 14, credential: 'key', hash: KEY_HASH, network: 0, networkName: 'Testnet', hex: 'e0' + KEY_HASH },
  { address: 'stake_test17rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcljw6kf', type: 15, credential: 'script', hash: SCRIPT_HASH, network: 0, networkName: 'Testnet', hex: 'f0' + SCRIPT_HASH },
];
const withoutForm = ({ inputForm, ...rest }) => rest;

test('all four official CIP-19 reward vectors decode to the published credentials', () => {
  for (const v of VECTORS) {
    const info = inspectRewardAddress(v.address);
    assert.equal(info.address, v.address, v.address);
    assert.equal(info.hex, v.hex);
    assert.equal(info.type, v.type);
    assert.equal(info.credential, v.credential);
    assert.equal(info.hash, v.hash);
    assert.equal(info.network, v.network);
    assert.equal(info.networkName, v.networkName);
    assert.equal(info.byteLength, 29);
    assert.equal(info.inputForm, 'bech32');
  }
});

test('the vector credentials are the base vectors’ stake credentials', () => {
  // CIP-19's type-00 base vectors carry the stake key in their stake
  // position; the type-02 vectors carry the script. Deriving from the
  // published base addresses must land exactly on the published reward
  // vectors — three published artefacts agreeing, not a self-derivation.
  assert.equal(deriveRewardAddress('addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x').address, VECTORS[0].address);
  assert.equal(deriveRewardAddress('addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve').address, VECTORS[1].address);
  assert.equal(deriveRewardAddress('addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae').address, VECTORS[2].address);
  assert.equal(deriveRewardAddress('addr_test1yz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shsf5r8qx').address, VECTORS[3].address);
});

test('building from a vector’s credential reproduces the vector exactly', () => {
  for (const v of VECTORS) {
    assert.equal(buildRewardAddress(v.credential, v.hash, v.network).address, v.address);
  }
});

test('the hex form inspects identically apart from the recorded form', () => {
  for (const v of VECTORS) {
    const viaHex = inspectRewardAddress(v.hex);
    assert.equal(viaHex.inputForm, 'hex');
    // The canonical address reported is the checksummed Bech32 form.
    assert.equal(viaHex.address, v.address);
    assert.deepEqual(withoutForm(viaHex), withoutForm(inspectRewardAddress(v.address)), v.address);
  }
});

test('uppercase hex is canonicalised to the same reward address', () => {
  const info = inspectRewardAddress(VECTORS[0].hex.toUpperCase());
  assert.equal(info.address, VECTORS[0].address);
  assert.equal(info.inputForm, 'hex');
});

test('hex has no checksum: a changed digit decodes to a different credential instead of failing', () => {
  const hex = VECTORS[0].hex;
  const flipped = hex.slice(0, 10) + (hex[10] === '0' ? '1' : '0') + hex.slice(11);
  const info = inspectRewardAddress(flipped);
  assert.notEqual(info.hash, KEY_HASH);
  const b = VECTORS[0].address;
  assert.throws(() => inspectRewardAddress(b.slice(0, 10) + (b[10] === 'q' ? 'p' : 'q') + b.slice(11)), /checksum/);
});

test('odd-length hex is refused as hex, not misread as Bech32', () => {
  assert.throws(() => inspectRewardAddress(VECTORS[0].hex + 'a'), /even number of characters/);
  assert.throws(() => inspectRewardAddress(VECTORS[0].hex.slice(0, -1)), /even number of characters/);
});

test('payment addresses are refused in both encodings', () => {
  const built = buildAddress('key', '11'.repeat(28), 'key', '22'.repeat(28), 0);
  assert.throws(() => inspectRewardAddress(built.address), /stake or stake_test/);
  assert.throws(() => inspectRewardAddress(built.hex), /header type 14 or 15/);
});

test('wrong header types and network nibbles in hex are refused', () => {
  assert.throws(() => inspectRewardAddress('01' + KEY_HASH), /header type 14 or 15/); // type 0, 29 bytes
  assert.throws(() => inspectRewardAddress('61' + KEY_HASH), /header type 14 or 15/); // enterprise type 6
  assert.throws(() => inspectRewardAddress('ef' + KEY_HASH), /header type 14 or 15/); // type 14, network 15
});

test('truncated, overlong, and non-string inputs are refused', () => {
  assert.throws(() => inspectRewardAddress(VECTORS[0].hex.slice(0, 40)), /header type 14 or 15/);
  assert.throws(() => inspectRewardAddress(VECTORS[0].hex + '00'), /header type 14 or 15/);
  assert.throws(() => inspectRewardAddress('not-an-address'), /stake/);
  assert.throws(() => inspectRewardAddress(''), /stake|reward/);
  assert.throws(() => inspectRewardAddress(42), /reward address/);
});

test('mixed-case Bech32 is refused', () => {
  const a = VECTORS[2].address;
  const mixed = a.slice(0, 12) + a[12].toUpperCase() + a.slice(13);
  assert.throws(() => inspectRewardAddress(mixed), /Mixed-case/);
});

test('the network page wires the reward inspector with its honesty copy', async () => {
  const app = await read('src/app.js');
  assert.match(app, /Inspect a reward \(stake\) address/);
  assert.match(app, /reward-inspect-form/);
  assert.match(app, /rewardInspectResultView/);
  assert.match(app, /LOCAL INSPECTOR/);
  // Registration / delegation are chain state the decode cannot see.
  assert.match(app, /Whether this credential is registered or delegated is chain state/);
  assert.match(app, /a mistyped character would decode to a different stake credential/);
});
