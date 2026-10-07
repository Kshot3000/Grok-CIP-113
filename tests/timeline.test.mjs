import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateTimeline, MAX_ASSET, MAX_TIMELINE_STEPS } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 PRA · 6 decimals · cap 10,000 · allowlist + eligibility on
const sum = balances => Object.values(balances).reduce((a, v) => a + BigInt(v), 0n).toString();

test('mint, distribute, burn: one running state lands exactly, balances sum to supply', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '50000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' },
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '30000' },
  ]);
  assert.equal(r.invalid, false);
  assert.equal(r.appliedCount, 4);
  assert.equal(r.initialSupplyBaseUnits, '1000000000000');
  assert.equal(r.finalSupplyBaseUnits, '1020000000000');
  assert.equal(r.netChangeBaseUnits, '20000000000');
  assert.equal(r.transferredBaseUnits, '20000000000');
  assert.deepEqual(r.balances, { issuer: '1000000000000', approved: '20000000000', pending: '0', blocked: '0' });
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
  // Minted tokens enter at the issuer: the mint step's supply move is visible.
  assert.equal(r.steps[0].supplyBeforeBaseUnits, '1000000000000');
  assert.equal(r.steps[0].supplyAfterBaseUnits, '1050000000000');
  // A transfer leaves the supply unchanged.
  assert.equal(r.steps[1].supplyBeforeBaseUnits, r.steps[1].supplyAfterBaseUnits);
});

test('a burn of tokens already distributed is blocked on the issuer balance, not the supply', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' },
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '995000' },
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '5000' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, false, true]);
  const blocked = r.steps[1];
  assert.equal(blocked.checks.find(c => c.name === 'Issuance authority').pass, true);
  assert.equal(blocked.checks.find(c => c.name === 'Sufficient current supply').pass, true);
  const bal = blocked.checks.find(c => c.name === 'Issuer balance');
  assert.equal(bal.pass, false);
  assert.match(bal.detail, /not the issuer’s to burn/);
  assert.equal(blocked.supplyAfterBaseUnits, blocked.supplyBeforeBaseUnits);
  assert.equal(r.finalSupplyBaseUnits, '995000000000');
  assert.deepEqual(r.balances, { issuer: '985000000000', approved: '10000000000', pending: '0', blocked: '0' });
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('denials mid-timeline change nothing and later steps still evaluate', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'supply', action: 'mint', actor: 'other', amount: '10000' },
    { kind: 'transfer', from: 'issuer', to: 'pending', amount: '100' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
    { kind: 'supply', action: 'burn', actor: 'other', amount: '50' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, false, true, false]);
  assert.equal(r.steps[1].checks.find(c => c.name === 'Transfer access').pass, false);
  assert.equal(r.steps[1].checks.find(c => c.name === 'Eligibility requirement').pass, false);
  assert.equal(r.finalSupplyBaseUnits, '1000000000000');
  assert.equal(r.netChangeBaseUnits, '0');
  assert.equal(r.transferredBaseUnits, '100000000');
  assert.equal(r.balances.approved, '100000000');
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('burning the whole holding, then re-minting, restarts distribution from zero', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '1000000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '1000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '500' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, false, true, true]);
  assert.equal(r.steps[0].supplyAfterBaseUnits, '0');
  assert.equal(r.steps[1].checks.find(c => c.name === 'Sender balance').pass, false);
  assert.equal(r.finalSupplyBaseUnits, '1000000000');
  assert.deepEqual(r.balances, { issuer: '500000000', approved: '500000000', pending: '0', blocked: '0' });
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('the per-transfer cap gates transfers in a timeline but never issuance', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '50000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '20000' },
  ]);
  assert.equal(r.steps[0].allowed, true); // 50,000 mint is far over the 10,000 cap — and applies
  assert.equal(r.steps[1].allowed, false);
  assert.equal(r.steps[1].checks.find(c => c.name === 'Transfer limit').pass, false);
  assert.equal(r.steps[1].checks.find(c => c.name === 'Sender balance').pass, true);
});

test('an issuer pause blocks transfer steps but not supply steps', () => {
  const paused = { ...RWA, paused: true };
  const r = simulateTimeline(paused, [
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '1000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
  ]);
  assert.equal(r.steps[0].allowed, true);
  assert.equal(r.steps[1].allowed, false);
  assert.equal(r.steps[1].checks.find(c => c.name === 'Issuer controls').pass, false);
  assert.equal(r.finalSupplyBaseUnits, '1001000000000');
});

test('the int64 ceiling binds inside a timeline and transfers still work at the ceiling', () => {
  const toCeiling = '9223371036854.775807'; // lands exactly on MAX_ASSET from RWA supply
  const r = simulateTimeline(RWA, [
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: toCeiling },
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '1' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '1' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, false, true]);
  assert.equal(r.finalSupplyBaseUnits, MAX_ASSET.toString());
  assert.equal(r.balances.approved, '1000000');
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('unknown kinds, unknown accounts, and bad amounts are blocked steps, not thrown timelines', () => {
  const r = simulateTimeline(RWA, [
    { kind: 'airdrop', amount: '10' },
    { kind: 'transfer', from: 'stranger', to: 'approved', amount: '10' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '1.0000001' },
    { kind: 'supply', action: 'airdrop', actor: 'issuer', amount: '10' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, false, false, false, true]);
  assert.equal(r.steps[0].checks[0].name, 'Known timeline step');
  assert.equal(r.steps[1].checks[0].name, 'Known accounts');
  assert.equal(r.steps[2].checks[0].name, 'Valid amount');
  assert.equal(r.steps[3].checks[0].name, 'Known supply change');
  assert.equal(r.balances.approved, '10000000');
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('timeline shape is enforced: 1-12 steps, object steps, valid design', () => {
  assert.equal(MAX_TIMELINE_STEPS, 12);
  assert.throws(() => simulateTimeline(RWA, []), /between 1 and 12/);
  assert.throws(() => simulateTimeline(RWA, Array(13).fill({ kind: 'supply', action: 'mint', actor: 'issuer', amount: '1' })), /between 1 and 12/);
  assert.throws(() => simulateTimeline(RWA, ['mint']), /must describe/);
  assert.throws(() => simulateTimeline(RWA, 'mint'), /between 1 and 12/);
  const bad = simulateTimeline({ ...RWA, supply: '0' }, [{ kind: 'supply', action: 'mint', actor: 'issuer', amount: '1' }]);
  assert.equal(bad.invalid, true);
  assert.deepEqual(bad.steps, []);
});

test('a 0-decimal design timelines in whole tokens only', () => {
  const ticket = fromTemplate('ticket'); // 5,000 PTIX · 0 decimals · cap 4 · open access
  const r = simulateTimeline(ticket, [
    { kind: 'supply', action: 'mint', actor: 'issuer', amount: '250' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '4' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '5' },
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '250' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, false, true]);
  assert.equal(r.finalSupplyBaseUnits, '5000');
  assert.deepEqual(r.balances, { issuer: '4996', approved: '4', pending: '0', blocked: '0' });
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('app wiring: the Test step renders the timeline lab with presets and the one-state boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /simulateTimeline/);
  assert.match(app, /data-action="timeline-simulate"/);
  assert.match(app, /Timeline lab/);
  assert.match(app, /data-timeline-preset/);
  assert.match(app, /balances always sum to the modeled supply/);
  assert.match(app, /no wallet or on-chain state is read/);
});
