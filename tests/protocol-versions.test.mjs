import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, parseProtocolParamVersions, protocolVersionsCheck, getProtocolParamVersions } from '../src/services.js';
import { PREVIEW_REFERENCE } from '../src/config.js';

// Fixtures are the indexers' real /api/v1/protocol-params/versions
// responses, captured live on 2026-10-10: one version per network today,
// each standing as its deployment's default, each agreeing field for
// field with that network's /registry/protocols record.
const VERSION_PV = { registryNodePolicyId: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a', progLogicScriptHash: PREVIEW_REFERENCE.scriptHash, txHash: PREVIEW_REFERENCE.txHash, slot: 124284557, timestamp: 1790940557, default: true };
const VERSION_PP = { registryNodePolicyId: '3083d387537f9318b6ff5aeab7de5f5629d26495319b8fafd409222a', progLogicScriptHash: 'be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3', txHash: 'f4118e53fc0fac1dddf96c6dcc3b4670265f25558d9943feb4ee564488f5c896', slot: 135258970, timestamp: 1790942170, default: true };
const VERSION_MN = { registryNodePolicyId: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075', progLogicScriptHash: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838', txHash: 'bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72', slot: 199384339, timestamp: 1790950630, default: true };
const protocolsFor = v => parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: v.registryNodePolicyId, progLogicScriptHash: v.progLogicScriptHash, tokenCount: 0, slot: v.slot, txHash: v.txHash }]);
const clone = v => JSON.parse(JSON.stringify(v));
const versions = (...rows) => parseProtocolParamVersions(rows.map(clone));

test('parser accepts the live version lists for all three networks', () => {
  for (const raw of [VERSION_PV, VERSION_PP, VERSION_MN]) {
    const [v] = parseProtocolParamVersions([clone(raw)]);
    assert.deepEqual(v, raw);
    assert.deepEqual(Object.keys(v), ['registryNodePolicyId', 'progLogicScriptHash', 'txHash', 'slot', 'timestamp', 'default']);
  }
});

test('parser canonicalises hex case in every hash field', () => {
  const upper = clone(VERSION_PV);
  upper.registryNodePolicyId = upper.registryNodePolicyId.toUpperCase();
  upper.progLogicScriptHash = upper.progLogicScriptHash.toUpperCase();
  upper.txHash = upper.txHash.toUpperCase();
  const [v] = parseProtocolParamVersions([upper]);
  assert.deepEqual(v, VERSION_PV);
});

test('parser refuses a non-array response and malformed records, field by field', () => {
  assert.throws(() => parseProtocolParamVersions({}), /Unexpected protocol versions response/);
  assert.throws(() => parseProtocolParamVersions([null]), /Invalid protocol version record\./);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, registryNodePolicyId: 'ab'.repeat(10) }]), /registry node policy ID/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, progLogicScriptHash: 'zz' + VERSION_PV.progLogicScriptHash.slice(2) }]), /programmable logic script hash/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, txHash: VERSION_PV.txHash.slice(0, 56) }]), /deployment transaction/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, slot: -1 }]), /slot/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, slot: 1.5 }]), /slot/);
  const { timestamp, ...noTime } = VERSION_PV;
  assert.throws(() => parseProtocolParamVersions([noTime]), /timestamp/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, timestamp: 0 }]), /timestamp/);
});

test('parser refuses a default flag that is not a real boolean', () => {
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, default: 'true' }]), /default flag/);
  assert.throws(() => parseProtocolParamVersions([{ ...VERSION_PV, default: 1 }]), /default flag/);
  const { default: _d, ...noDefault } = VERSION_PV;
  assert.throws(() => parseProtocolParamVersions([noDefault]), /default flag/);
});

test('the live histories pass every check against the live deployments lists', () => {
  for (const raw of [VERSION_PV, VERSION_PP, VERSION_MN]) {
    const c = protocolVersionsCheck(versions(raw), protocolsFor(raw));
    assert.equal(c.ok, true);
    assert.equal(c.versionCount, 1);
    assert.equal(c.exactlyOneDefault, true);
    assert.equal(c.uniqueDeployments, true);
    assert.equal(c.slotsInOrder, true);
    assert.equal(c.defaultTxHash, raw.txHash);
    assert.equal(c.defaultCompared, true);
    assert.equal(c.defaultListed, true);
    assert.equal(c.defaultAgrees, true);
  }
});

test('an empty history verifies nothing — no vacuous pass', () => {
  const c = protocolVersionsCheck([], []);
  assert.equal(c.ok, false);
  assert.equal(c.versionCount, 0);
  assert.equal(c.exactlyOneDefault, false);
  assert.equal(c.uniqueDeployments, false);
  assert.equal(c.slotsInOrder, false);
  assert.equal(c.defaultTxHash, null);
});

test('a synthetic three-version upgrade history passes: one default, ascending slots, default agrees', () => {
  const v1 = { ...VERSION_PV, txHash: 'aa'.repeat(32), slot: 100, timestamp: 1700000000, default: false };
  const v2 = { ...VERSION_PV, txHash: 'bb'.repeat(32), slot: 200, timestamp: 1750000000, default: false };
  const c = protocolVersionsCheck(versions(v1, v2, VERSION_PV), protocolsFor(VERSION_PV));
  assert.equal(c.ok, true);
  assert.equal(c.versionCount, 3);
  assert.equal(c.defaultCount, 1);
});

test('zero defaults and two defaults both fail — the standing version must be unambiguous', () => {
  const none = protocolVersionsCheck(versions({ ...VERSION_PV, default: false }), protocolsFor(VERSION_PV));
  assert.equal(none.exactlyOneDefault, false);
  assert.equal(none.ok, false);
  assert.equal(none.defaultTxHash, null);
  const two = protocolVersionsCheck(versions(VERSION_PV, { ...VERSION_PP, slot: VERSION_PV.slot + 1 }), protocolsFor(VERSION_PV));
  assert.equal(two.defaultCount, 2);
  assert.equal(two.exactlyOneDefault, false);
  assert.equal(two.ok, false);
});

test('a deployment listed twice fails, however tidy each record looks', () => {
  const dup = protocolVersionsCheck(versions(VERSION_PV, { ...VERSION_PV, default: false, slot: VERSION_PV.slot + 5 }), protocolsFor(VERSION_PV));
  assert.equal(dup.uniqueDeployments, false);
  assert.equal(dup.ok, false);
});

test('a history out of slot order fails; equal slots do not', () => {
  const later = { ...VERSION_PV, txHash: 'cc'.repeat(32), slot: VERSION_PV.slot + 10, default: false };
  const out = protocolVersionsCheck(versions(later, VERSION_PV), protocolsFor(VERSION_PV));
  assert.equal(out.slotsInOrder, false);
  assert.equal(out.ok, false);
  const sameSlot = protocolVersionsCheck(versions({ ...later, slot: VERSION_PV.slot }, VERSION_PV), protocolsFor(VERSION_PV));
  assert.equal(sameSlot.slotsInOrder, true);
});

test('a standing default missing from the deployments list fails the cross-check, not the history verdicts', () => {
  const c = protocolVersionsCheck(versions(VERSION_PV), protocolsFor(VERSION_MN));
  assert.equal(c.exactlyOneDefault, true);
  assert.equal(c.defaultCompared, true);
  assert.equal(c.defaultListed, false);
  assert.equal(c.defaultAgrees, false);
  assert.equal(c.ok, false);
});

test('a standing default whose logic hash moved against the deployments list fails agreement', () => {
  const moved = protocolsFor(VERSION_PV).map(p => ({ ...p, progLogicScriptHash: 'dd'.repeat(28) }));
  const c = protocolVersionsCheck(versions(VERSION_PV), moved);
  assert.equal(c.defaultListed, true);
  assert.equal(c.defaultAgrees, false);
  assert.equal(c.ok, false);
  const movedSlot = protocolsFor(VERSION_PV).map(p => ({ ...p, slot: p.slot + 1 }));
  assert.equal(protocolVersionsCheck(versions(VERSION_PV), movedSlot).defaultAgrees, false);
});

test('with no deployments list supplied the agreement is null — not compared, never a fabricated pass', () => {
  const c = protocolVersionsCheck(versions(VERSION_PV), null);
  assert.equal(c.defaultCompared, false);
  assert.equal(c.defaultListed, null);
  assert.equal(c.defaultAgrees, null);
  assert.equal(c.ok, true);
});

test('getProtocolParamVersions refuses an unknown network before any fetch', async () => {
  await assert.rejects(() => getProtocolParamVersions('devnet', []), /Unknown network/);
});

test('app wires the versions read: verdict, honest partial failure, v1.101', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getProtocolParamVersions\(state\.network,reg\.protocols\)/);
  assert.match(app, /Version check passed/);
  assert.match(app, /Version check FAILED/);
  assert.match(app, /Protocol versions unavailable\.<\/strong>/);
  assert.match(app, /Protocol parameter versions/);
  assert.match(app, /WORKSPACE <span>v1\.101<\/span>/);
});
