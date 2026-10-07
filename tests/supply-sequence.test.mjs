import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateSupplySequence, MAX_ASSET } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 PRA · 6 decimals

test('a chained mint/burn schedule lands on the exact final supply', () => {
  const r = simulateSupplySequence(RWA, [
    { action: 'mint', actor: 'issuer', amount: '250000' },
    { action: 'burn', actor: 'issuer', amount: '100000' },
    { action: 'mint', actor: 'issuer', amount: '50000.5' },
  ]);
  assert.equal(r.invalid, false);
  assert.equal(r.appliedCount, 3);
  assert.equal(r.initialSupplyBaseUnits, '1000000000000');
  assert.equal(r.finalSupplyBaseUnits, '1200000500000');
  assert.equal(r.netChangeBaseUnits, '200000500000');
  assert.deepEqual(r.steps.map(s => s.supplyAfterBaseUnits), ['1250000000000', '1150000000000', '1200000500000']);
});

test('a blocked oversize burn leaves the supply intact for a later smaller burn', () => {
  const r = simulateSupplySequence(RWA, [
    { action: 'burn', actor: 'issuer', amount: '2000000' },
    { action: 'burn', actor: 'issuer', amount: '400000' },
  ]);
  assert.equal(r.steps[0].allowed, false);
  assert.equal(r.steps[0].supplyAfterBaseUnits, '1000000000000');
  assert.match(r.steps[0].checks.find(c => c.name === 'Sufficient current supply').detail, /earlier steps in the sequence count/);
  assert.equal(r.steps[1].allowed, true);
  assert.equal(r.finalSupplyBaseUnits, '600000000000');
  assert.equal(r.appliedCount, 1);
});

test('a burn creates ceiling headroom a later mint can use', () => {
  // Mint exactly to the ceiling, burn 1 PRA, mint 1 PRA back to the ceiling.
  const toCeiling = '9223371036854.775807'; // lands exactly on MAX_ASSET from RWA supply
  const r = simulateSupplySequence(RWA, [
    { action: 'mint', actor: 'issuer', amount: toCeiling },
    { action: 'mint', actor: 'issuer', amount: '1' },
    { action: 'burn', actor: 'issuer', amount: '1' },
    { action: 'mint', actor: 'issuer', amount: '1' },
  ]);
  assert.equal(r.steps[0].allowed, true);
  assert.equal(r.steps[0].supplyAfterBaseUnits, MAX_ASSET.toString());
  assert.equal(r.steps[1].allowed, false); // no headroom left
  assert.equal(r.steps[2].allowed, true);
  assert.equal(r.steps[3].allowed, true); // headroom recreated by the burn
  assert.equal(r.finalSupplyBaseUnits, MAX_ASSET.toString());
});

test('non-issuer steps are blocked mid-sequence without moving the supply', () => {
  const r = simulateSupplySequence(RWA, [
    { action: 'mint', actor: 'other', amount: '10000' },
    { action: 'mint', actor: 'issuer', amount: '10000' },
    { action: 'burn', actor: 'other', amount: '5000' },
    { action: 'burn', actor: 'issuer', amount: '5000' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, true, false, true]);
  assert.equal(r.finalSupplyBaseUnits, '1005000000000');
  assert.equal(r.netChangeBaseUnits, '5000000000');
});

test('burning the whole supply then minting restarts from zero exactly', () => {
  const r = simulateSupplySequence(RWA, [
    { action: 'burn', actor: 'issuer', amount: '1000000' },
    { action: 'mint', actor: 'issuer', amount: '1' },
  ]);
  assert.equal(r.steps[0].supplyAfterBaseUnits, '0');
  assert.equal(r.finalSupplyBaseUnits, '1000000');
});

test('an unrepresentable amount is a blocked step, not a thrown sequence', () => {
  const r = simulateSupplySequence(RWA, [
    { action: 'mint', actor: 'issuer', amount: '1.0000001' },
    { action: 'mint', actor: 'issuer', amount: '10' },
    { action: 'airdrop', actor: 'issuer', amount: '10' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, true, false]);
  assert.equal(r.steps[0].checks[0].name, 'Valid amount');
  assert.equal(r.steps[2].checks[0].name, 'Known supply change');
  assert.equal(r.finalSupplyBaseUnits, '1000010000000');
});

test('sequence shape is enforced: 1-12 steps, object steps, valid design', () => {
  assert.throws(() => simulateSupplySequence(RWA, []), /between 1 and 12/);
  assert.throws(() => simulateSupplySequence(RWA, Array(13).fill({ action: 'mint', actor: 'issuer', amount: '1' })), /between 1 and 12/);
  assert.throws(() => simulateSupplySequence(RWA, ['mint']), /must describe/);
  assert.throws(() => simulateSupplySequence(RWA, 'mint'), /between 1 and 12/);
  const bad = simulateSupplySequence({ ...RWA, supply: '0' }, [{ action: 'mint', actor: 'issuer', amount: '1' }]);
  assert.equal(bad.invalid, true);
  assert.deepEqual(bad.steps, []);
});

test('a 0-decimal design sequences in whole tokens only', () => {
  const ticket = fromTemplate('ticket'); // 5,000 PTIX · 0 decimals
  const r = simulateSupplySequence(ticket, [
    { action: 'mint', actor: 'issuer', amount: '250' },
    { action: 'burn', actor: 'issuer', amount: '50' },
  ]);
  assert.equal(r.finalSupplyBaseUnits, '5200');
  assert.equal(r.netChangeBaseUnits, '200');
});

test('app wiring: the Test step renders the supply sequence lab with presets and clears on design edits', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /simulateSupplySequence/);
  assert.match(app, /data-action="supply-seq-simulate"/);
  assert.match(app, /Supply sequence/);
  assert.match(app, /data-supply-seq-preset/);
  assert.match(app, /no on-chain supply is read/);
});
