import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkLendingIntegration, LENDING_INTEGRATION_VERDICTS } from '../src/domain.js';

// CIP-113 lending integration (spec: "Implementing programmable tokens in
// DeFi protocols", "Lending Protocols", re-read 2026-10-11): protocols
// receive tokens at a smart wallet address they control, and
// transferLogicScript validation applies during deposit/withdrawal;
// liquidation transactions MUST include proper registry proofs; protocols
// SHOULD verify the substandard before accepting tokens.
const ready = () => ({
  collateralDestination: 'protocol-smart-wallet',
  depositTransferLogic: 'applies',
  withdrawalTransferLogic: 'applies',
  liquidationRegistryProofs: 'included',
  substandardVerification: 'verified',
});

test('a lending protocol meeting every duty is ready', () => {
  const v = checkLendingIntegration(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), LENDING_INTEGRATION_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { collateralToProtocolSmartWallet: true, depositInvokesTransferLogic: true, withdrawalInvokesTransferLogic: true, liquidationIncludesRegistryProofs: true });
  assert.equal(v.substandardVerified, true);
});

test('substandard verification is reported, never scored: a protocol ready on every MUST is ready without it, because the spec’s word is SHOULD', () => {
  const v = checkLendingIntegration({ ...ready(), substandardVerification: 'not-verified' });
  assert.equal(v.valid, true);
  assert.equal(v.status, 'ready');
  assert.equal(v.substandardVerified, false);
  assert.deepEqual(Object.values(v.verdicts), [true, true, true, true]);
});

test('verifying the substandard cannot rescue a failed MUST', () => {
  const failing = checkLendingIntegration({ ...ready(), collateralDestination: 'protocol-ordinary-address' });
  assert.equal(failing.valid, false);
  assert.equal(failing.substandardVerified, true);
});

test('collateral received anywhere but a smart wallet the protocol controls fails the collateral duty', () => {
  for (const collateralDestination of ['protocol-ordinary-address', 'user-smart-wallet']) {
    const v = checkLendingIntegration({ ...ready(), collateralDestination });
    assert.equal(v.verdicts.collateralToProtocolSmartWallet, false, collateralDestination);
    assert.equal(v.valid, false, collateralDestination);
    assert.equal(v.status, 'not-ready');
  }
});

test('the deposit and withdrawal positions fail independently: the logic can apply at one moment and be skipped at the other', () => {
  const noDeposit = checkLendingIntegration({ ...ready(), depositTransferLogic: 'skipped' });
  assert.equal(noDeposit.verdicts.depositInvokesTransferLogic, false);
  assert.equal(noDeposit.verdicts.withdrawalInvokesTransferLogic, true);
  assert.equal(noDeposit.valid, false);
  const noWithdrawal = checkLendingIntegration({ ...ready(), withdrawalTransferLogic: 'skipped' });
  assert.equal(noWithdrawal.verdicts.withdrawalInvokesTransferLogic, false);
  assert.equal(noWithdrawal.verdicts.depositInvokesTransferLogic, true);
  assert.equal(noWithdrawal.valid, false);
});

test('a liquidation omitting registry proofs fails the liquidation duty', () => {
  const v = checkLendingIntegration({ ...ready(), liquidationRegistryProofs: 'omitted' });
  assert.equal(v.verdicts.liquidationIncludesRegistryProofs, false);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.collateralToProtocolSmartWallet, true);
});

test('each scored position fails independently: the verdicts are separate positions', () => {
  const cases = [
    [{ collateralDestination: 'user-smart-wallet' }, 'collateralToProtocolSmartWallet'],
    [{ depositTransferLogic: 'skipped' }, 'depositInvokesTransferLogic'],
    [{ withdrawalTransferLogic: 'skipped' }, 'withdrawalInvokesTransferLogic'],
    [{ liquidationRegistryProofs: 'omitted' }, 'liquidationIncludesRegistryProofs'],
  ];
  for (const [patch, key] of cases) {
    const v = checkLendingIntegration({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('refusal discipline: unknown or missing fields are refused, never scored in part', () => {
  assert.throws(() => checkLendingIntegration({ ...ready(), custody: 'held' }), /unknown field "custody"/);
  assert.throws(() => checkLendingIntegration({ ...ready(), interestRate: 'fixed' }), /unknown field "interestRate"/);
  const missing = ready();
  delete missing.liquidationRegistryProofs;
  assert.throws(() => checkLendingIntegration(missing), /missing its "liquidationRegistryProofs"/);
  assert.throws(() => checkLendingIntegration(null), /must be an object/);
  assert.throws(() => checkLendingIntegration([]), /must be an object/);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkLendingIntegration({ ...ready(), collateralDestination: 'vault' }), /collateral destination must be one of/i);
  assert.throws(() => checkLendingIntegration({ ...ready(), depositTransferLogic: 'sometimes' }), /deposit transfer logic field must be one of/i);
  assert.throws(() => checkLendingIntegration({ ...ready(), withdrawalTransferLogic: 'sometimes' }), /withdrawal transfer logic field must be one of/i);
  assert.throws(() => checkLendingIntegration({ ...ready(), liquidationRegistryProofs: 'attached' }), /liquidation registry proofs field must be one of/i);
  assert.throws(() => checkLendingIntegration({ ...ready(), substandardVerification: 'audited' }), /substandard verification field must be one of/i);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkLendingIntegration(claim);
  assert.deepEqual(claim, snapshot);
});

test('a protocol failing every duty is not ready on any position', () => {
  const v = checkLendingIntegration({ collateralDestination: 'user-smart-wallet', depositTransferLogic: 'skipped', withdrawalTransferLogic: 'skipped', liquidationRegistryProofs: 'omitted', substandardVerification: 'not-verified' });
  assert.deepEqual(Object.values(v.verdicts), [false, false, false, false]);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-ready');
});

test('the entered profile is carried through unchanged in the result', () => {
  const v = checkLendingIntegration(ready());
  assert.equal(v.collateralDestination, 'protocol-smart-wallet');
  assert.equal(v.depositTransferLogic, 'applies');
  assert.equal(v.withdrawalTransferLogic, 'applies');
  assert.equal(v.liquidationRegistryProofs, 'included');
  assert.equal(v.substandardVerification, 'verified');
});

test('app wires the lending integration checker: panel, verdicts, honest boundary, v1.222', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkLendingIntegration/);
  assert.match(app, /lending-integration-collateral/);
  assert.match(app, /lending-integration-result/);
  assert.match(app, /LENDING INTEGRATION · LOCAL MODEL/);
  assert.match(app, /REPORTED, NEVER SCORED/);
  assert.match(app, /inspected no lending protocol, read no registry, and no chain state/);
  assert.match(app, /v1\.222/);
});
