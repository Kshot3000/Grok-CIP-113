import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDexIntegration, DEX_INTEGRATION_VERDICTS } from '../src/domain.js';

// CIP-113 DEX integration (spec: "Implementing programmable tokens in
// DeFi protocols", "DEX Integration", re-read 2026-10-11): LP tokens
// involving programmable tokens MUST be sent to the user's smart wallet
// address; swaps MUST include the transferLogicScript withdrawal (via
// withdraw-zero) and the relevant registryNode as reference input;
// batchers CAN process swaps by including all required reference inputs.
const ready = () => ({
  lpDestination: 'smart-wallet',
  swapTransferLogic: 'included',
  swapRegistryRef: 'included',
  batcher: 'none',
  batcherRefInputs: 'not-applicable',
});

test('a DEX meeting every duty is ready — with no batcher, which is not a duty', () => {
  const v = checkDexIntegration(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), DEX_INTEGRATION_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { lpToSmartWallet: true, swapInvokesTransferLogic: true, swapReferencesRegistry: true, batcherReferencesAll: null });
  assert.equal(v.hasBatcher, false);
  assert.equal(v.batchesTransfers, false);
});

test('the batcher verdict is null with no batcher in play: no batcher names nothing to judge', () => {
  const v = checkDexIntegration(ready());
  assert.equal(v.verdicts.batcherReferencesAll, null);
  const withBatcher = checkDexIntegration({ ...ready(), batcher: 'batches', batcherRefInputs: 'all' });
  assert.equal(withBatcher.verdicts.batcherReferencesAll, true);
  assert.equal(withBatcher.valid, true);
});

test('batching is reported, never scored: batching and one-at-a-time are both ready when the reference inputs are all included', () => {
  for (const batcher of ['batches', 'single']) {
    const v = checkDexIntegration({ ...ready(), batcher, batcherRefInputs: 'all' });
    assert.equal(v.valid, true, batcher);
    assert.equal(v.hasBatcher, true);
    assert.equal(v.batchesTransfers, batcher === 'batches');
  }
});

test('a batcher cannot rescue a failed MUST, and its presence alone scores nothing', () => {
  const failing = checkDexIntegration({ ...ready(), batcher: 'batches', batcherRefInputs: 'all', lpDestination: 'ordinary-address' });
  assert.equal(failing.valid, false);
  assert.equal(failing.verdicts.batcherReferencesAll, true);
});

test('a batcher including only some reference inputs fails its one scored condition', () => {
  for (const batcherRefInputs of ['partial', 'none']) {
    const v = checkDexIntegration({ ...ready(), batcher: 'batches', batcherRefInputs });
    assert.equal(v.verdicts.batcherReferencesAll, false, batcherRefInputs);
    assert.equal(v.valid, false, batcherRefInputs);
    assert.equal(v.verdicts.lpToSmartWallet, true);
  }
});

test('LP tokens sent anywhere but the user’s smart wallet fail the liquidity duty', () => {
  for (const lpDestination of ['ordinary-address', 'pool-address']) {
    const v = checkDexIntegration({ ...ready(), lpDestination });
    assert.equal(v.verdicts.lpToSmartWallet, false, lpDestination);
    assert.equal(v.valid, false, lpDestination);
    assert.equal(v.status, 'not-ready');
  }
});

test('the two swap halves fail independently: either can be omitted without the other', () => {
  const noLogic = checkDexIntegration({ ...ready(), swapTransferLogic: 'omitted' });
  assert.equal(noLogic.verdicts.swapInvokesTransferLogic, false);
  assert.equal(noLogic.verdicts.swapReferencesRegistry, true);
  assert.equal(noLogic.valid, false);
  const noRegistry = checkDexIntegration({ ...ready(), swapRegistryRef: 'omitted' });
  assert.equal(noRegistry.verdicts.swapReferencesRegistry, false);
  assert.equal(noRegistry.verdicts.swapInvokesTransferLogic, true);
  assert.equal(noRegistry.valid, false);
});

test('each scored position fails independently: the verdicts are separate positions', () => {
  const cases = [
    [{ lpDestination: 'pool-address' }, 'lpToSmartWallet'],
    [{ swapTransferLogic: 'omitted' }, 'swapInvokesTransferLogic'],
    [{ swapRegistryRef: 'omitted' }, 'swapReferencesRegistry'],
    [{ batcher: 'single', batcherRefInputs: 'partial' }, 'batcherReferencesAll'],
  ];
  for (const [patch, key] of cases) {
    const v = checkDexIntegration({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('refusal discipline: unknown or missing fields are refused, never scored in part', () => {
  assert.throws(() => checkDexIntegration({ ...ready(), lending: 'supported' }), /unknown field "lending"/);
  assert.throws(() => checkDexIntegration({ ...ready(), custody: 'held' }), /unknown field "custody"/);
  const missing = ready();
  delete missing.swapRegistryRef;
  assert.throws(() => checkDexIntegration(missing), /missing its "swapRegistryRef"/);
  assert.throws(() => checkDexIntegration(null), /must be an object/);
  assert.throws(() => checkDexIntegration([]), /must be an object/);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkDexIntegration({ ...ready(), lpDestination: 'user' }), /LP destination must be one of/i);
  assert.throws(() => checkDexIntegration({ ...ready(), swapTransferLogic: 'called' }), /swap transfer logic field must be one of/i);
  assert.throws(() => checkDexIntegration({ ...ready(), swapRegistryRef: 'attached' }), /swap registry reference field must be one of/i);
  assert.throws(() => checkDexIntegration({ ...ready(), batcher: 'always' }), /batcher mode must be one of/i);
  assert.throws(() => checkDexIntegration({ ...ready(), batcher: 'batches', batcherRefInputs: 'most' }), /batcher reference inputs field must be one of/i);
});

test('refusal discipline: batcher reference inputs named where no batcher is claimed cannot be read', () => {
  assert.throws(() => checkDexIntegration({ ...ready(), batcherRefInputs: 'all' }), /no batcher is claimed/);
  assert.throws(() => checkDexIntegration({ ...ready(), batcherRefInputs: 'partial' }), /no batcher is claimed/);
});

test('refusal discipline: a claimed batcher naming its reference inputs not-applicable cannot be read', () => {
  assert.throws(() => checkDexIntegration({ ...ready(), batcher: 'batches' }), /not-applicable/);
  assert.throws(() => checkDexIntegration({ ...ready(), batcher: 'single' }), /not-applicable/);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkDexIntegration(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the DEX integration checker: panel, verdicts, honest boundary, v1.139', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkDexIntegration/);
  assert.match(app, /dex-integration-lp/);
  assert.match(app, /dex-integration-result/);
  assert.match(app, /DEX INTEGRATION · LOCAL MODEL/);
  assert.match(app, /REPORTED, NEVER SCORED/);
  assert.match(app, /inspected no DEX, read no registry, and no chain state/);
  assert.match(app, /v1\.139/);
});
