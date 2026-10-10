import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, registryReferenceCheck, getRegistry } from '../src/services.js';
import { CONFIG, NETWORKS, PREVIEW_REFERENCE } from '../src/config.js';

// Fixtures are the indexers' real /api/v1/registry/protocols responses,
// captured live on 2026-10-10. Preview's record is the pinned reference
// deployment itself, so its txHash and programmable-logic hash are written
// from PREVIEW_REFERENCE — the cross-check below then proves the live
// shape and the pin agree, instead of two hand-copied copies agreeing.
const PREVIEW_ROW = {
  protocolParamsId: 1,
  registryNodePolicyId: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a',
  progLogicScriptHash: PREVIEW_REFERENCE.scriptHash,
  tokenCount: 5,
  slot: 124284557,
  txHash: PREVIEW_REFERENCE.txHash,
};
const PREPROD_ROW = {
  protocolParamsId: 1,
  registryNodePolicyId: '3083d387537f9318b6ff5aeab7de5f5629d26495319b8fafd409222a',
  progLogicScriptHash: 'be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3',
  tokenCount: 16,
  slot: 135258970,
  txHash: 'f4118e53fc0fac1dddf96c6dcc3b4670265f25558d9943feb4ee564488f5c896',
};
const MAINNET_ROW = {
  protocolParamsId: 1,
  registryNodePolicyId: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075',
  progLogicScriptHash: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838',
  tokenCount: 3,
  slot: 199384339,
  txHash: 'bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72',
};

test('parser accepts the live-shaped records from all three indexers', () => {
  for (const row of [PREVIEW_ROW, PREPROD_ROW, MAINNET_ROW]) {
    const [r] = parseRegistryProtocols([row]);
    assert.equal(r.protocolParamsId, 1);
    assert.equal(r.registryNodePolicyId, row.registryNodePolicyId);
    assert.equal(r.progLogicScriptHash, row.progLogicScriptHash);
    assert.equal(r.tokenCount, row.tokenCount);
    assert.equal(r.slot, row.slot);
    assert.equal(r.txHash, row.txHash);
    assert.deepEqual(Object.keys(r), ['protocolParamsId', 'registryNodePolicyId', 'progLogicScriptHash', 'tokenCount', 'slot', 'txHash']);
  }
  assert.deepEqual(parseRegistryProtocols([]), []);
});

test('parser canonicalises hex case instead of refusing the same record', () => {
  const upper = { ...MAINNET_ROW, registryNodePolicyId: MAINNET_ROW.registryNodePolicyId.toUpperCase(), progLogicScriptHash: MAINNET_ROW.progLogicScriptHash.toUpperCase(), txHash: MAINNET_ROW.txHash.toUpperCase() };
  const [r] = parseRegistryProtocols([upper]);
  assert.equal(r.registryNodePolicyId, MAINNET_ROW.registryNodePolicyId);
  assert.equal(r.progLogicScriptHash, MAINNET_ROW.progLogicScriptHash);
  assert.equal(r.txHash, MAINNET_ROW.txHash);
});

test('parser refuses a non-array response and non-record rows', () => {
  assert.throws(() => parseRegistryProtocols(null), /Unexpected registry response/);
  assert.throws(() => parseRegistryProtocols({}), /Unexpected registry response/);
  assert.throws(() => parseRegistryProtocols([null]), /Invalid registry deployment record/);
  assert.throws(() => parseRegistryProtocols([['x']]), /Invalid registry deployment record/);
});

test('parser refuses unreadable counts and identifiers, naming the field', () => {
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, protocolParamsId: -1 }]), /protocol parameters ID/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, protocolParamsId: 1.5 }]), /protocol parameters ID/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, tokenCount: -1 }]), /token count/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, tokenCount: '5' }]), /token count/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, slot: -1 }]), /slot/);
  const noSlot = { ...PREVIEW_ROW }; delete noSlot.slot;
  assert.throws(() => parseRegistryProtocols([noSlot]), /slot/);
});

test('parser refuses malformed hex in any identifier position', () => {
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, registryNodePolicyId: 'e5b3' }]), /registry node policy ID/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, registryNodePolicyId: 'zz'.repeat(28) }]), /registry node policy ID/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, progLogicScriptHash: PREVIEW_REFERENCE.txHash }]), /programmable logic script hash/);
  assert.throws(() => parseRegistryProtocols([{ ...PREVIEW_ROW, txHash: PREVIEW_REFERENCE.scriptHash }]), /deployment transaction/);
});

test('one malformed record refuses the whole response, never a partial list', () => {
  assert.throws(() => parseRegistryProtocols([PREVIEW_ROW, { ...PREPROD_ROW, tokenCount: -1 }]), /token count/);
});

test('Preview cross-check passes on the live record for the pinned deployment', () => {
  const check = registryReferenceCheck('preview', parseRegistryProtocols([PREVIEW_ROW]));
  assert.deepEqual(check, { present: true, scriptHashMatches: true, txHash: PREVIEW_REFERENCE.txHash });
});

test('Preview cross-check names a listed deployment whose logic hash moved', () => {
  const moved = { ...PREVIEW_ROW, progLogicScriptHash: 'aa'.repeat(28) };
  const check = registryReferenceCheck('preview', parseRegistryProtocols([moved]));
  assert.equal(check.present, true);
  assert.equal(check.scriptHashMatches, false);
});

test('Preview cross-check reports the pinned deployment absent, never passes it', () => {
  const check = registryReferenceCheck('preview', parseRegistryProtocols([PREPROD_ROW]));
  assert.deepEqual(check, { present: false, scriptHashMatches: false, txHash: PREVIEW_REFERENCE.txHash });
  assert.equal(registryReferenceCheck('preview', []).present, false);
});

test('networks without a pin run no check — null, not a pass', () => {
  assert.equal(registryReferenceCheck('preprod', parseRegistryProtocols([PREPROD_ROW])), null);
  assert.equal(registryReferenceCheck('mainnet', parseRegistryProtocols([MAINNET_ROW])), null);
});

test('every network names its own Foundation indexer over HTTPS, and the old stub is gone', () => {
  assert.equal(NETWORKS.preview.registryApi, 'https://preview-indexer.programmabletokens.xyz');
  assert.equal(NETWORKS.preprod.registryApi, 'https://preprod-indexer.programmabletokens.xyz');
  assert.equal(NETWORKS.mainnet.registryApi, 'https://mainnet-indexer.programmabletokens.xyz');
  assert.equal('registryApi' in CONFIG, false);
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('getRegistry reads the selected network’s indexer and returns the checked view', async () => {
  const stub = stubFetch(async () => ({ ok: true, json: async () => [PREVIEW_ROW] }));
  try {
    const reg = await getRegistry('preview');
    assert.deepEqual(stub.seen, ['https://preview-indexer.programmabletokens.xyz/api/v1/registry/protocols']);
    assert.equal(reg.network, 'preview');
    assert.equal(reg.indexer, 'https://preview-indexer.programmabletokens.xyz');
    assert.equal(reg.protocols[0].tokenCount, 5);
    assert.equal(reg.reference.scriptHashMatches, true);
    assert.ok(Number.isFinite(reg.fetchedAt));
  } finally { stub.restore(); }
});

test('getRegistry on mainnet carries no reference verdict', async () => {
  const stub = stubFetch(async () => ({ ok: true, json: async () => [MAINNET_ROW] }));
  try {
    const reg = await getRegistry('mainnet');
    assert.equal(reg.reference, null);
    assert.equal(reg.protocols[0].registryNodePolicyId, MAINNET_ROW.registryNodePolicyId);
  } finally { stub.restore(); }
});

test('getRegistry refuses an unknown network before any fetch', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try { await assert.rejects(() => getRegistry('devnet'), /Unknown network/); }
  finally { stub.restore(); }
});

test('getRegistry surfaces HTTP failure and malformed payloads as errors, never as empty data', async () => {
  const http = stubFetch(async () => ({ ok: false, status: 503, json: async () => [] }));
  try { await assert.rejects(() => getRegistry('preview'), /HTTP 503/); }
  finally { http.restore(); }
  const bad = stubFetch(async () => ({ ok: true, json: async () => [{ ...PREVIEW_ROW, tokenCount: -1 }] }));
  try { await assert.rejects(() => getRegistry('preview'), /token count/); }
  finally { bad.restore(); }
});

test('app wires the live registry browser: network-aware read, cross-check copy, honest failure state', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getRegistry\(state\.network\)/);
  assert.match(app, /LIVE INDEXER/);
  assert.match(app, /Cross-check passed/);
  assert.match(app, /Cross-check failed/);
  assert.match(app, /Registry unavailable\.<\/strong>/);
  assert.match(app, /id="registry-results" aria-live="polite"/);
  assert.match(app, /WORKSPACE <span>v1\.99<\/span>/);
  assert.doesNotMatch(app, /INDEXER NOT CONNECTED/);
  assert.doesNotMatch(app, /Read configured registry/);
});
