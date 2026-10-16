import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, parseProtocolParamsLatest, protocolParamsLatestCheck, getProtocolParamsLatest } from '../src/services.js';

// Fixtures are the indexers' real responses, captured live on 2026-10-16:
// Preview /api/v1/protocol-params/latest and Preview
// /api/v1/registry/protocols — the same standing parameters read two
// ways, which is exactly what the latest-parameters cross-check compares.
// Note the live createdAt shape: a seven-part array, not the ISO string
// the indexer's own API schema names — the parser accepts both.
const LATEST_LIVE = {
  "id": 1,
  "registryNodePolicyId": "e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a",
  "progLogicScriptHash": "35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16",
  "transferCred": "5fe7c82a32a69e5839e9da77e1e9992c1e55f7d372c3d58d8f744ef7",
  "thirdPartyCred": "4c601638f4ee5ad3ba71d4d1b8a0b24b9117b7b3a679c66a96dfb7c6",
  "programmableLogicGlobalCred": "3b212b37b1a1fb334539c42e7473376a7fc15b60c26ae0fd4d06279e",
  "issuanceLogicCred": "621131d2df1acfdad5928a34572834cde904502441d6d41c642a10f6",
  "unfrackingCred": "2798c1fcdc5f2b2b4ab9a72ce68add485d81915c5430e4ac79afc87b",
  "upgradeCred": "03322dd0912f1c36b67cce2aa5cebe8ff1dde6c7dbf365206b07e2fd",
  "pendingUpgradeCred": null,
  "maxInlineDatumBytes": 1024,
  "txHash": "8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9",
  "slot": 124284557,
  "blockHeight": 4717846,
  "createdAt": [2026, 10, 2, 12, 12, 31, 261472757]
};
const PROTOCOLS_LIVE = [{
  "protocolParamsId": 1,
  "registryNodePolicyId": "e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a",
  "progLogicScriptHash": "35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16",
  "tokenCount": 6,
  "slot": 124284557,
  "txHash": "8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9"
}];
const clone = v => JSON.parse(JSON.stringify(v));

test('parseProtocolParamsLatest parses the live Preview record whole', () => {
  const L = parseProtocolParamsLatest(clone(LATEST_LIVE));
  assert.equal(L.id, 1);
  assert.equal(L.registryNodePolicyId, LATEST_LIVE.registryNodePolicyId);
  assert.equal(L.transferCred, LATEST_LIVE.transferCred);
  assert.equal(L.thirdPartyCred, LATEST_LIVE.thirdPartyCred);
  assert.equal(L.programmableLogicGlobalCred, LATEST_LIVE.programmableLogicGlobalCred);
  assert.equal(L.issuanceLogicCred, LATEST_LIVE.issuanceLogicCred);
  assert.equal(L.unfrackingCred, LATEST_LIVE.unfrackingCred);
  assert.equal(L.upgradeCred, LATEST_LIVE.upgradeCred);
  assert.equal(L.pendingUpgradeCred, null);
  assert.equal(L.maxInlineDatumBytes, 1024);
  assert.equal(L.slot, 124284557);
  assert.equal(L.blockHeight, 4717846);
  assert.equal(L.createdAt, '2026-10-02T12:12:31.261Z');
});

test('parseProtocolParamsLatest accepts the ISO string shape the schema names', () => {
  const v = clone(LATEST_LIVE); v.createdAt = '2026-10-02T12:12:31.261Z';
  assert.equal(parseProtocolParamsLatest(v).createdAt, '2026-10-02T12:12:31.261Z');
});

test('parseProtocolParamsLatest accepts a nominated pending upgrade credential', () => {
  const v = clone(LATEST_LIVE); v.pendingUpgradeCred = LATEST_LIVE.upgradeCred.toUpperCase();
  assert.equal(parseProtocolParamsLatest(v).pendingUpgradeCred, LATEST_LIVE.upgradeCred);
});

test('parseProtocolParamsLatest refuses a non-record and a missing ID', () => {
  assert.throws(() => parseProtocolParamsLatest(null), /Unexpected latest protocol parameters/);
  assert.throws(() => parseProtocolParamsLatest([clone(LATEST_LIVE)]), /Unexpected latest protocol parameters/);
  const v = clone(LATEST_LIVE); delete v.id;
  assert.throws(() => parseProtocolParamsLatest(v), /protocol parameters ID/);
  const f = clone(LATEST_LIVE); f.id = 1.5;
  assert.throws(() => parseProtocolParamsLatest(f), /protocol parameters ID/);
});

test('parseProtocolParamsLatest refuses any malformed credential', () => {
  for (const field of ['registryNodePolicyId', 'progLogicScriptHash', 'transferCred', 'thirdPartyCred', 'programmableLogicGlobalCred', 'issuanceLogicCred', 'unfrackingCred', 'upgradeCred']) {
    const v = clone(LATEST_LIVE); v[field] = 'zz' + v[field].slice(2);
    assert.throws(() => parseProtocolParamsLatest(v), /Invalid latest protocol parameters record/, field);
    const e = clone(LATEST_LIVE); e[field] = '';
    assert.throws(() => parseProtocolParamsLatest(e), /Invalid latest protocol parameters record/, field);
  }
  const p = clone(LATEST_LIVE); p.pendingUpgradeCred = 42;
  assert.throws(() => parseProtocolParamsLatest(p), /pending upgrade credential/);
  const q = clone(LATEST_LIVE); q.pendingUpgradeCred = 'abcd';
  assert.throws(() => parseProtocolParamsLatest(q), /pending upgrade credential/);
});

test('parseProtocolParamsLatest refuses bad sizes, hashes, slots, and times', () => {
  const a = clone(LATEST_LIVE); a.maxInlineDatumBytes = -1;
  assert.throws(() => parseProtocolParamsLatest(a), /maximum inline datum size/);
  const b = clone(LATEST_LIVE); b.txHash = 'abcd';
  assert.throws(() => parseProtocolParamsLatest(b), /deployment transaction/);
  const c = clone(LATEST_LIVE); c.slot = -5;
  assert.throws(() => parseProtocolParamsLatest(c), /slot/);
  const d = clone(LATEST_LIVE); d.blockHeight = 1.25;
  assert.throws(() => parseProtocolParamsLatest(d), /block height/);
  const e = clone(LATEST_LIVE); e.createdAt = 'not a time';
  assert.throws(() => parseProtocolParamsLatest(e), /creation time/);
  const f = clone(LATEST_LIVE); f.createdAt = [2026, 13, 2, 12, 12, 31, 0];
  assert.throws(() => parseProtocolParamsLatest(f), /creation time/);
  const g = clone(LATEST_LIVE); g.createdAt = 1792140560;
  assert.throws(() => parseProtocolParamsLatest(g), /creation time/);
});

test('protocolParamsLatestCheck agrees with the live deployments record field for field', () => {
  const L = parseProtocolParamsLatest(clone(LATEST_LIVE));
  const protocols = parseRegistryProtocols(clone(PROTOCOLS_LIVE));
  const c = protocolParamsLatestCheck(L, protocols);
  assert.deepEqual(c, { protocolParamsId: 1, compared: true, listed: true, agrees: true, ok: true });
});

test('protocolParamsLatestCheck fails by name when a shared field disagrees', () => {
  const L = parseProtocolParamsLatest(clone(LATEST_LIVE));
  for (const patch of [{ slot: L.slot + 1 }, { txHash: '0'.repeat(64) }, { registryNodePolicyId: '0'.repeat(56) }, { progLogicScriptHash: '0'.repeat(56) }]) {
    const protocols = parseRegistryProtocols(clone(PROTOCOLS_LIVE).map(p => ({ ...p, ...patch })));
    const c = protocolParamsLatestCheck(L, protocols);
    assert.equal(c.listed, true);
    assert.equal(c.agrees, false);
    assert.equal(c.ok, false);
  }
});

test('protocolParamsLatestCheck fails when no deployment carries the latest ID', () => {
  const L = parseProtocolParamsLatest(clone(LATEST_LIVE));
  const protocols = parseRegistryProtocols(clone(PROTOCOLS_LIVE).map(p => ({ ...p, protocolParamsId: 2 })));
  const c = protocolParamsLatestCheck(L, protocols);
  assert.equal(c.compared, true);
  assert.equal(c.listed, false);
  assert.equal(c.agrees, false);
  assert.equal(c.ok, false);
});

test('protocolParamsLatestCheck leaves every verdict null when uncompared', () => {
  const L = parseProtocolParamsLatest(clone(LATEST_LIVE));
  const c = protocolParamsLatestCheck(L, null);
  assert.deepEqual(c, { protocolParamsId: 1, compared: false, listed: null, agrees: null, ok: true });
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const okJson = v => ({ ok: true, json: async () => v });

test('getProtocolParamsLatest reads the latest endpoint and cross-checks', async () => {
  const stub = stubFetch(async url => {
    assert.match(url, /protocol-params\/latest$/);
    return okJson(clone(LATEST_LIVE));
  });
  try {
    const protocols = parseRegistryProtocols(clone(PROTOCOLS_LIVE));
    const r = await getProtocolParamsLatest('preview', protocols);
    assert.equal(r.network, 'preview');
    assert.equal(r.latest.id, 1);
    assert.equal(r.check.ok, true);
    assert.equal(stub.seen.length, 1);
  } finally { stub.restore(); }
});

test('getProtocolParamsLatest refuses an unknown network before any fetch', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try { await assert.rejects(() => getProtocolParamsLatest('devnet', []), /Unknown network/); }
  finally { stub.restore(); }
});

test('getProtocolParamsLatest surfaces an indexer failure instead of parameters', async () => {
  const http = stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  try { await assert.rejects(() => getProtocolParamsLatest('preview', []), /HTTP 503/); }
  finally { http.restore(); }
  const lying = stubFetch(async () => okJson({ ...clone(LATEST_LIVE), transferCred: 'abcd' }));
  try { await assert.rejects(() => getProtocolParamsLatest('preview', []), /transfer credential/); }
  finally { lying.restore(); }
});

test('app wires the latest parameters: read, verdict lines, honest unavailable state, v1\\.209', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getProtocolParamsLatest\(state\.network,reg\.protocols\)/);
  assert.match(app, /Latest protocol parameters/);
  assert.match(app, /Latest parameters check passed/);
  assert.match(app, /Latest parameters check FAILED/);
  assert.match(app, /Latest protocol parameters unavailable\.<\/strong>/);
  assert.match(app, /No pending upgrade nominated/);
  assert.match(app, /WORKSPACE <span>v1\.210<\/span>/);
});
