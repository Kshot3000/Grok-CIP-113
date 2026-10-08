import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAddress, encodeBech32, decodeAddress, deriveSmartWallet, inspectRewardAddress, bytesToHex } from '../src/cardano.js';
import { summarizeWalletAddresses, connectCardano } from '../src/services.js';

// Deterministic credentials: payment 0x11, stake 0x22, other stake 0x33.
const PAY = Array(28).fill(0x11), STK = Array(28).fill(0x22), OTHER = Array(28).fill(0x33);
const STK_HEX = '22'.repeat(28), OTHER_HEX = '33'.repeat(28);
const addr = (type, network = 0, pay = PAY, stk = STK) =>
  encodeAddress(Uint8Array.from([(type << 4) | network, ...pay, ...(type < 4 ? stk : [])]));
const hexOf = (bech32) => bytesToHex(decodeAddress(bech32).bytes);
const rewardHex = (type = 14, network = 0, stk = STK) =>
  bytesToHex(Uint8Array.from([(type << 4) | network, ...stk]));

const change = addr(0, 0);                       // base, key/key, testnet
const enterprise = addr(6, 0);                   // enterprise, testnet
const smart = deriveSmartWallet(change, 'aa'.repeat(28), 0); // CIP-113 shape
const mainnetBase = addr(0, 1);                  // base, mainnet

test('reward inspector parses CIP-30 hex for key and script credentials', () => {
  const key = inspectRewardAddress(rewardHex(14, 0));
  assert.equal(key.credential, 'key');
  assert.equal(key.type, 14);
  assert.equal(key.network, 0);
  assert.equal(key.networkName, 'Testnet');
  assert.equal(key.hash, STK_HEX);
  assert.equal(key.byteLength, 29);
  assert.ok(key.address.startsWith('stake_test1'));
  const script = inspectRewardAddress(rewardHex(15, 1, OTHER));
  assert.equal(script.credential, 'script');
  assert.equal(script.network, 1);
  assert.equal(script.hash, OTHER_HEX);
  assert.ok(script.address.startsWith('stake1'));
});

test('reward inspector round-trips its own bech32 form', () => {
  const once = inspectRewardAddress(rewardHex(14, 0));
  const twice = inspectRewardAddress(once.address);
  assert.equal(twice.address, once.address);
  assert.equal(twice.hash, STK_HEX);
});

test('reward inspector rejects payment addresses and malformed input', () => {
  assert.throws(() => inspectRewardAddress(hexOf(change)), /reward address/); // 57-byte payment address
  assert.throws(() => inspectRewardAddress(rewardHex(14, 0).slice(0, 40)), /reward address/); // truncated
  assert.throws(() => inspectRewardAddress('not-an-address'), /stake/);
  assert.throws(() => inspectRewardAddress(42), /reward address/);
  const upper = encodeBech32('stake_test', Uint8Array.from([0xe0, ...STK]));
  const mixed = upper.slice(0, 8) + upper[8].toUpperCase() + upper.slice(9);
  assert.throws(() => inspectRewardAddress(mixed), /Mixed-case/);
});

test('summary counts unique used addresses, kinds, and the smart-wallet shape', () => {
  const s = summarizeWalletAddresses({
    changeAddress: change,
    usedAddresses: [hexOf(change), hexOf(enterprise), hexOf(smart), hexOf(change), hexOf(mainnetBase), 'garbage'],
    unusedAddresses: [hexOf(addr(6, 0, Array(28).fill(0x44)))],
    rewardAddresses: [rewardHex(14, 0)],
  }, 0);
  assert.equal(s.usedCount, 4);            // duplicate change counted once
  assert.equal(s.unusedCount, 1);
  assert.equal(s.baseCount, 3);            // change + smart + mainnet base
  assert.equal(s.enterpriseCount, 1);
  assert.equal(s.smartWalletShapeCount, 1);
  assert.equal(s.changeListedAsUsed, true);
  assert.equal(s.wrongNetwork, 1);         // the mainnet base address
  assert.equal(s.unreadable, 1);           // 'garbage'
  assert.equal(s.distinctStakeCredentials, 2); // change stake 0x22 + smart-wallet owner credential 0x11
  assert.equal(s.rewards.parsed, 1);
  assert.equal(s.rewards.stakeMatchesChange, true);
});

test('summary reports a differing reward credential and a change address not yet used', () => {
  const s = summarizeWalletAddresses({
    changeAddress: change,
    usedAddresses: [hexOf(enterprise)],
    rewardAddresses: [rewardHex(14, 0, OTHER), 'junk'],
  }, 0);
  assert.equal(s.changeListedAsUsed, false);
  assert.equal(s.smartWalletShapeCount, 0);
  assert.equal(s.rewards.parsed, 1);
  assert.equal(s.rewards.unreadable, 1);
  assert.equal(s.rewards.stakeMatchesChange, false);
});

test('summary keeps unavailable lists null instead of guessing counts', () => {
  const s = summarizeWalletAddresses({ changeAddress: change }, 0);
  assert.deepEqual(s.lists, { used: false, unused: false, rewards: false });
  assert.equal(s.usedCount, null);
  assert.equal(s.changeListedAsUsed, null);
  assert.equal(s.rewards, null);
  assert.equal(s.wrongNetwork, 0);
});

test('summary gives a null stake match for an enterprise change address', () => {
  const s = summarizeWalletAddresses({
    changeAddress: enterprise,
    rewardAddresses: [rewardHex(14, 0)],
  }, 0);
  assert.equal(s.change.stakeHash, null);
  assert.equal(s.rewards.stakeMatchesChange, null);
});

test('connect attaches an address book when the wallet offers the list methods', async () => {
  const provider = { name: 'Full wallet', enable: async () => ({
    getNetworkId: async () => 0,
    getChangeAddress: async () => change,
    getUsedAddresses: async () => [hexOf(change), hexOf(enterprise)],
    getUnusedAddresses: async () => [],
    getRewardAddresses: async () => [rewardHex(14, 0)],
  }) };
  const wallet = await connectCardano(provider, 'preview');
  assert.equal(wallet.addressBook.usedCount, 2);
  assert.equal(wallet.addressBook.unusedCount, 0);
  assert.equal(wallet.addressBook.rewards.stakeMatchesChange, true);
});

test('connect succeeds with no address book when the wallet offers no list methods', async () => {
  const provider = { name: 'Minimal wallet', enable: async () => ({
    getNetworkId: async () => 0,
    getChangeAddress: async () => change,
  }) };
  const wallet = await connectCardano(provider, 'preview');
  assert.equal(wallet.address, change);
  assert.equal(wallet.addressBook, null);
});

test('a failing list method leaves that list unavailable, never a failed connection', async () => {
  const provider = { name: 'Flaky wallet', enable: async () => ({
    getNetworkId: async () => 0,
    getChangeAddress: async () => change,
    getUsedAddresses: async () => { throw new Error('wallet declined'); },
    getRewardAddresses: async () => [rewardHex(14, 0)],
  }) };
  const wallet = await connectCardano(provider, 'preview');
  assert.equal(wallet.addressBook.lists.used, false);
  assert.equal(wallet.addressBook.usedCount, null);
  assert.equal(wallet.addressBook.lists.rewards, true);
  assert.equal(wallet.addressBook.rewards.parsed, 1);
});
