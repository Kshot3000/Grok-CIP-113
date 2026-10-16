import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkVaultIntegration, VAULT_INTEGRATION_VERDICTS } from '../src/domain.js';

// CIP-113 yield aggregators and vaults (spec: "Implementing programmable
// tokens in DeFi protocols", "Yield Aggregators and Vaults", re-read
// 2026-10-11): vaults manage programmable tokens by receiving deposits at
// the vault's smart wallet address, moving tokens between protocols with
// proper validation on each transfer, and sending withdrawals to users'
// smart wallet addresses. The subsection states NO MUST and NO SHOULD —
// the three practices are listed descriptively, so this checker judges
// following the listed practices and never calls them duties.
const ready = () => ({
  depositDestination: 'vault-smart-wallet',
  transferValidation: 'applies',
  withdrawalDestination: 'user-smart-wallet',
});

test('a vault following all three listed practices is ready, in the disclosed descriptive sense', () => {
  const v = checkVaultIntegration(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), VAULT_INTEGRATION_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { depositsToVaultSmartWallet: true, interProtocolTransfersValidated: true, withdrawalsToUserSmartWallet: true });
});

test('deposits received anywhere but the vault’s own smart wallet fail the first listed practice', () => {
  for (const depositDestination of ['vault-ordinary-address', 'user-smart-wallet']) {
    const v = checkVaultIntegration({ ...ready(), depositDestination });
    assert.equal(v.verdicts.depositsToVaultSmartWallet, false, depositDestination);
    assert.equal(v.valid, false, depositDestination);
    assert.equal(v.status, 'not-ready');
  }
});

test('a deposit left at the user’s smart wallet is not received by the vault at all', () => {
  const v = checkVaultIntegration({ ...ready(), depositDestination: 'user-smart-wallet' });
  assert.equal(v.verdicts.depositsToVaultSmartWallet, false);
  assert.equal(v.verdicts.withdrawalsToUserSmartWallet, true);
});

test('skipping validation on inter-protocol transfers fails the second listed practice, however deposits and withdrawals are handled', () => {
  const v = checkVaultIntegration({ ...ready(), transferValidation: 'skipped' });
  assert.equal(v.verdicts.interProtocolTransfersValidated, false);
  assert.equal(v.verdicts.depositsToVaultSmartWallet, true);
  assert.equal(v.verdicts.withdrawalsToUserSmartWallet, true);
  assert.equal(v.valid, false);
});

test('withdrawals sent anywhere but the user’s smart wallet fail the third listed practice', () => {
  for (const withdrawalDestination of ['user-ordinary-address', 'vault-smart-wallet']) {
    const v = checkVaultIntegration({ ...ready(), withdrawalDestination });
    assert.equal(v.verdicts.withdrawalsToUserSmartWallet, false, withdrawalDestination);
    assert.equal(v.valid, false, withdrawalDestination);
  }
});

test('a withdrawal still sitting at the vault’s own smart wallet has not been sent to the user', () => {
  const v = checkVaultIntegration({ ...ready(), withdrawalDestination: 'vault-smart-wallet' });
  assert.equal(v.verdicts.withdrawalsToUserSmartWallet, false);
  assert.equal(v.verdicts.depositsToVaultSmartWallet, true);
});

test('each scored position fails independently: the verdicts are separate positions', () => {
  const cases = [
    [{ depositDestination: 'vault-ordinary-address' }, 'depositsToVaultSmartWallet'],
    [{ transferValidation: 'skipped' }, 'interProtocolTransfersValidated'],
    [{ withdrawalDestination: 'user-ordinary-address' }, 'withdrawalsToUserSmartWallet'],
  ];
  for (const [patch, key] of cases) {
    const v = checkVaultIntegration({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('the same address value is judged by whose it is: the user’s smart wallet fails as a deposit destination and passes as a withdrawal destination', () => {
  const asDeposit = checkVaultIntegration({ ...ready(), depositDestination: 'user-smart-wallet' });
  assert.equal(asDeposit.verdicts.depositsToVaultSmartWallet, false);
  const asWithdrawal = checkVaultIntegration(ready());
  assert.equal(asWithdrawal.withdrawalDestination, 'user-smart-wallet');
  assert.equal(asWithdrawal.verdicts.withdrawalsToUserSmartWallet, true);
  const vaultAsWithdrawal = checkVaultIntegration({ ...ready(), withdrawalDestination: 'vault-smart-wallet' });
  assert.equal(vaultAsWithdrawal.verdicts.withdrawalsToUserSmartWallet, false);
  const vaultAsDeposit = checkVaultIntegration(ready());
  assert.equal(vaultAsDeposit.verdicts.depositsToVaultSmartWallet, true);
});

test('refusal discipline: unknown or missing fields are refused, never scored in part', () => {
  assert.throws(() => checkVaultIntegration({ ...ready(), apy: 'variable' }), /unknown field "apy"/);
  assert.throws(() => checkVaultIntegration({ ...ready(), strategy: 'looping' }), /unknown field "strategy"/);
  const missing = ready();
  delete missing.transferValidation;
  assert.throws(() => checkVaultIntegration(missing), /missing its "transferValidation"/);
  assert.throws(() => checkVaultIntegration(null), /must be an object/);
  assert.throws(() => checkVaultIntegration([]), /must be an object/);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkVaultIntegration({ ...ready(), depositDestination: 'pool' }), /deposit destination must be one of/i);
  assert.throws(() => checkVaultIntegration({ ...ready(), transferValidation: 'sometimes' }), /transfer validation field must be one of/i);
  assert.throws(() => checkVaultIntegration({ ...ready(), withdrawalDestination: 'pool' }), /withdrawal destination must be one of/i);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkVaultIntegration(claim);
  assert.deepEqual(claim, snapshot);
});

test('a vault following none of the listed practices is not ready on any position', () => {
  const v = checkVaultIntegration({ depositDestination: 'user-smart-wallet', transferValidation: 'skipped', withdrawalDestination: 'vault-smart-wallet' });
  assert.deepEqual(Object.values(v.verdicts), [false, false, false]);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-ready');
});

test('the entered profile is carried through unchanged in the result', () => {
  const v = checkVaultIntegration(ready());
  assert.equal(v.depositDestination, 'vault-smart-wallet');
  assert.equal(v.transferValidation, 'applies');
  assert.equal(v.withdrawalDestination, 'user-smart-wallet');
});

test('app wires the vault integration checker: panel, verdicts, descriptive-grade disclosure, honest boundary, v1.203', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkVaultIntegration/);
  assert.match(app, /vault-integration-deposit/);
  assert.match(app, /vault-integration-result/);
  assert.match(app, /VAULT INTEGRATION · LOCAL MODEL/);
  assert.match(app, /DESCRIPTIVE, NO MUST/);
  assert.match(app, /imposes no MUST in this subsection/);
  assert.match(app, /inspected no vault, read no registry, and no chain state/);
  assert.match(app, /v1\.203/);
});
