import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkWalletReadiness, WALLET_READINESS_VERDICTS } from '../src/domain.js';

// CIP-113 wallet readiness (spec: "Implementing programmable tokens in
// wallets and dApps", with "Address Derivation", "Balance Queries",
// "Identifying Programmable Tokens", and "Transaction History", re-read
// 2026-10-11): a wallet supporting programmable tokens MUST implement
// balance queries and transaction history — both at the user's smart
// wallet address — and identifies a programmable token by checking its
// policy ID as a key in the registry. Native transfers are optional.
const ready = () => ({
  derivation: 'base-plus-stake',
  stakeSource: 'payment',
  balanceSource: 'smart-wallet',
  historySource: 'smart-wallet',
  identification: 'registry-key',
  nativeTransfers: 'does-not-build',
});

test('a wallet meeting every duty is ready — without building native transfers, which are optional', () => {
  const v = checkWalletReadiness(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), WALLET_READINESS_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { derivesSmartWallet: true, balanceQueries: true, historyTracks: true, identifiesViaRegistry: true });
  assert.equal(v.buildsNativeTransfers, false);
});

test('building native transfers is reported, never scored: it neither required nor able to rescue a MUST', () => {
  const withNative = checkWalletReadiness({ ...ready(), nativeTransfers: 'builds' });
  assert.equal(withNative.valid, true);
  assert.equal(withNative.buildsNativeTransfers, true);
  const failing = checkWalletReadiness({ ...ready(), nativeTransfers: 'builds', balanceSource: 'ordinary-address' });
  assert.equal(failing.valid, false);
  assert.equal(failing.buildsNativeTransfers, true);
});

test('the stake source is reported, never scored: payment, staking, and either all conform', () => {
  for (const stakeSource of ['payment', 'staking', 'either']) {
    const v = checkWalletReadiness({ ...ready(), stakeSource });
    assert.equal(v.valid, true);
    assert.equal(v.stakeSource, stakeSource);
  }
});

test('derivation: a wallet that never derives the smart-wallet address is not ready', () => {
  const v = checkWalletReadiness({ ...ready(), derivation: 'ordinary-address-only', stakeSource: 'none' });
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-ready');
  assert.equal(v.verdicts.derivesSmartWallet, false);
  assert.equal(v.verdicts.balanceQueries, true);
});

test('balance queries at the ordinary address fail the duty: programmable tokens never live there', () => {
  const v = checkWalletReadiness({ ...ready(), balanceSource: 'ordinary-address' });
  assert.equal(v.verdicts.balanceQueries, false);
  assert.equal(v.valid, false);
  const none = checkWalletReadiness({ ...ready(), balanceSource: 'none' });
  assert.equal(none.verdicts.balanceQueries, false);
});

test('history at the ordinary address fails the duty, independently of balances', () => {
  const v = checkWalletReadiness({ ...ready(), historySource: 'ordinary-address' });
  assert.equal(v.verdicts.historyTracks, false);
  assert.equal(v.verdicts.balanceQueries, true);
  assert.equal(v.valid, false);
});

test('identification by hardcoded list is not the registry check and fails the duty', () => {
  const v = checkWalletReadiness({ ...ready(), identification: 'hardcoded-list' });
  assert.equal(v.verdicts.identifiesViaRegistry, false);
  assert.equal(v.valid, false);
  const none = checkWalletReadiness({ ...ready(), identification: 'none' });
  assert.equal(none.verdicts.identifiesViaRegistry, false);
});

test('each duty fails independently: the four verdicts are separate positions', () => {
  const cases = [
    [{ derivation: 'none', stakeSource: 'none' }, 'derivesSmartWallet'],
    [{ balanceSource: 'none' }, 'balanceQueries'],
    [{ historySource: 'none' }, 'historyTracks'],
    [{ identification: 'none' }, 'identifiesViaRegistry'],
  ];
  for (const [patch, key] of cases) {
    const v = checkWalletReadiness({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('refusal discipline: unknown or missing fields are refused, never scored in part', () => {
  assert.throws(() => checkWalletReadiness({ ...ready(), minting: 'builds' }), /unknown field "minting"/);
  assert.throws(() => checkWalletReadiness({ ...ready(), thirdParty: 'builds' }), /unknown field "thirdParty"/);
  const missing = ready();
  delete missing.identification;
  assert.throws(() => checkWalletReadiness(missing), /missing its "identification"/);
  assert.throws(() => checkWalletReadiness(null), /must be an object/);
  assert.throws(() => checkWalletReadiness([]), /must be an object/);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkWalletReadiness({ ...ready(), derivation: 'derived' }), /derivation must be one of/i);
  assert.throws(() => checkWalletReadiness({ ...ready(), stakeSource: 'seed-phrase' }), /stake source must be one of/i);
  assert.throws(() => checkWalletReadiness({ ...ready(), balanceSource: 'blockfrost' }), /balance source must be one of/i);
  assert.throws(() => checkWalletReadiness({ ...ready(), historySource: 'blockfrost' }), /history source must be one of/i);
  assert.throws(() => checkWalletReadiness({ ...ready(), identification: 'token-metadata' }), /identification method must be one of/i);
  assert.throws(() => checkWalletReadiness({ ...ready(), nativeTransfers: 'sometimes' }), /native transfers field must be one of/i);
});

test('refusal discipline: a base-plus-stake derivation naming no stake source cannot be read', () => {
  assert.throws(() => checkWalletReadiness({ ...ready(), stakeSource: 'none' }), /names no stake source/);
});

test('refusal discipline: a stake source named with no smart-wallet derivation claimed names nothing', () => {
  assert.throws(() => checkWalletReadiness({ ...ready(), derivation: 'none' }), /no smart-wallet derivation is claimed/);
  assert.throws(() => checkWalletReadiness({ ...ready(), derivation: 'ordinary-address-only' }), /no smart-wallet derivation is claimed/);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkWalletReadiness(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the wallet readiness checker: panel, verdicts, honest boundary, v1.236', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkWalletReadiness/);
  assert.match(app, /wallet-readiness-derivation/);
  assert.match(app, /wallet-readiness-result/);
  assert.match(app, /WALLET READINESS · LOCAL MODEL/);
  assert.match(app, /REPORTED, NEVER SCORED/);
  assert.match(app, /inspected no wallet, read no registry, and no chain state/);
  assert.match(app, /v1\.236/);
});
