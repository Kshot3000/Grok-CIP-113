import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateSupplyChange, toUnits, MAX_ASSET } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 PRA · 6 decimals · cap 10,000

test('issuer mint raises the modeled supply exactly, past float precision', () => {
  const r = simulateSupplyChange(RWA, { action: 'mint', actor: 'issuer', amount: '250000.5' });
  assert.equal(r.invalid, false);
  assert.equal(r.allowed, true);
  assert.equal(r.supplyBeforeBaseUnits, '1000000000000');
  assert.equal(r.amountBaseUnits, '250000500000');
  assert.equal(r.supplyAfterBaseUnits, '1250000500000');
  assert.ok(r.checks.every(c => c.pass));
});

test('issuer burn lowers the modeled supply; burning the whole supply ends at zero', () => {
  const part = simulateSupplyChange(RWA, { action: 'burn', actor: 'issuer', amount: '400000' });
  assert.equal(part.allowed, true);
  assert.equal(part.supplyAfterBaseUnits, '600000000000');
  const all = simulateSupplyChange(RWA, { action: 'burn', actor: 'issuer', amount: '1000000' });
  assert.equal(all.allowed, true);
  assert.equal(all.supplyAfterBaseUnits, '0');
});

test('a burn larger than the issued supply is blocked and reports no negative supply', () => {
  const r = simulateSupplyChange(RWA, { action: 'burn', actor: 'issuer', amount: '1000000.000001' });
  assert.equal(r.allowed, false);
  assert.equal(r.supplyAfterBaseUnits, null);
  const check = r.checks.find(c => c.name === 'Sufficient current supply');
  assert.equal(check.pass, false);
  assert.match(check.detail, /cannot destroy more than was issued/);
});

test('a non-issuer cannot mint or burn in the generic issuance model', () => {
  for (const action of ['mint', 'burn']) {
    const r = simulateSupplyChange(RWA, { action, actor: 'other', amount: '10' });
    assert.equal(r.allowed, false);
    assert.equal(r.checks.find(c => c.name === 'Issuance authority').pass, false);
  }
});

test('a mint that would pass the signed 64-bit ceiling is blocked, with exact arithmetic', () => {
  // Ceiling is 9,223,372,036,854,775,807 base units. RWA supply is 1e12 base
  // units, so a mint of 9,223,371,036,854,775,807 base units (at 6 decimals)
  // lands exactly on the ceiling and a single base unit more passes it.
  const atCeiling = simulateSupplyChange(RWA, { action: 'mint', actor: 'issuer', amount: '9223371036854.775807' });
  assert.equal(atCeiling.supplyAfterBaseUnits, MAX_ASSET.toString());
  assert.equal(atCeiling.allowed, true);
  const past = simulateSupplyChange(RWA, { action: 'mint', actor: 'issuer', amount: '9223371036854.775808' });
  assert.equal(past.allowed, false);
  assert.equal(past.checks.find(c => c.name === 'Int64 ceiling headroom').pass, false);
});

test('the per-transfer cap does not gate issuance: a mint above the cap still applies', () => {
  // RWA's transfer cap is 10,000 PRA; issuance is not a transfer, so the
  // generic model must not apply the cap to a mint.
  const r = simulateSupplyChange(RWA, { action: 'mint', actor: 'issuer', amount: '50000' });
  assert.equal(r.allowed, true);
  assert.ok(!r.checks.some(c => c.name === 'Transfer limit'));
});

test('invalid actions, actors, and amounts return the invalid shape, never a result', () => {
  for (const input of [
    { action: 'airdrop', actor: 'issuer', amount: '10' },
    { action: 'mint', actor: 'holder', amount: '10' },
    { action: 'mint', actor: 'issuer', amount: '0' },
    { action: 'mint', actor: 'issuer', amount: '-5' },
    { action: 'mint', actor: 'issuer', amount: '1.0000001' },
    null,
    'mint',
  ]) {
    const r = simulateSupplyChange(RWA, input);
    assert.equal(r.invalid, true, JSON.stringify(input));
    assert.equal(r.allowed, false);
    assert.equal(r.supplyAfterBaseUnits, null);
  }
  const badDesign = simulateSupplyChange({ ...RWA, supply: '0' }, { action: 'mint', actor: 'issuer', amount: '10' });
  assert.equal(badDesign.invalid, true);
});

test('a 0-decimal design mints and burns in whole tokens only', () => {
  const ticket = fromTemplate('ticket'); // 5,000 PTIX · 0 decimals
  const r = simulateSupplyChange(ticket, { action: 'mint', actor: 'issuer', amount: '250' });
  assert.equal(r.allowed, true);
  assert.equal(r.supplyAfterBaseUnits, '5250');
  const frac = simulateSupplyChange(ticket, { action: 'mint', actor: 'issuer', amount: '0.5' });
  assert.equal(frac.invalid, true);
});

test('app wiring: the Test step renders the supply lab and clears its result on design edits', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /simulateSupplyChange/);
  assert.match(app, /data-action="supply-simulate"/);
  assert.match(app, /Supply lab/);
  assert.match(app, /not a Foundation substandard module/);
  assert.match(app, /No tokens are minted or burned/);
});
