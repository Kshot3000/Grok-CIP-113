import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, parseRegistryTokens, parseRegistryNodesAll, registryWalkCheck, getRegistryNodesAll, REGISTRY_TERMINAL_NEXT } from '../src/services.js';
import { PREVIEW_REFERENCE } from '../src/config.js';

// Fixtures are the indexers' real /api/v1/registry/nodes/all responses,
// captured live on 2026-10-10: the tokens-endpoint groups (registry-tokens
// fixtures) with the ORIGIN node prepended — key '' (the empty
// bytestring), every logic / global-state field empty, next naming the
// first registered token. Preview: 5 tokens + origin; Mainnet: 3 + origin.
const SENTINEL = 'ff'.repeat(30);
const PARAMS_PV = { registryNodePolicyId: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a', programmableLogicBaseScriptHash: PREVIEW_REFERENCE.scriptHash };
const PARAMS_MN = { registryNodePolicyId: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075', programmableLogicBaseScriptHash: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838' };
const TOKENS_PV = [
  { key: '4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea', next: '8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e', mintingLogicScript: 'c69d5fcde26c893e85832a6b1c1d7735fc442da99173f5c35e875437', transferLogicScript: '6065c106ec3acd598416fb8c2a30103ad093136432001bb1c8df7b01', thirdPartyTransferLogicScript: '26e0ab3b4c1714854cab6bee42ec924ad97b938fa430614a06fb4376', unfrackingLogicScript: '', globalStatePolicyId: '622f404d9266032ec4461373897311a22df63fbf2bb4239758b81e02' },
  { key: '8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e', next: '8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04', mintingLogicScript: 'ee5a1836e13e0b8da451f40f5d52c5a1d886f1d8a045de502adde1f7', transferLogicScript: '3e9ff38e0543b03e298811e1396a1d93106ff16b6e901675a0b4f124', thirdPartyTransferLogicScript: '4e38fe6f1cb2a1596ae4010c05d2e4458158dbc513bc1764201a2aa8', unfrackingLogicScript: '', globalStatePolicyId: '804c1d2fa61bed013f808f3b47b023da74cb15d1456ac5e044d43b42' },
  { key: '8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04', next: 'ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2', mintingLogicScript: '174db21c54bfa8a7cd02bdc41f287cbb370df9e106cc1028fb1bb103', transferLogicScript: 'c255bcb38d8d5b22aa57308cf1cbaa9d3ee7ea2f373fb01fee18619e', thirdPartyTransferLogicScript: '321c2f48fea5bd016ef5f26a4d78d9b13c251193037e08b1a6bfc28a', unfrackingLogicScript: '', globalStatePolicyId: '489f8058d95cbd35d20ebcf199856c5780a858c25bb70209d21587ce' },
  { key: 'ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2', next: 'fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3', mintingLogicScript: '0efb02aa36b3e6167c3f450249c2f9bbaf2d49efe80b930e1fb8e11e', transferLogicScript: '108f11b59a5afbaac5451bd86e22f002ebafc23d93d01f542ce93f4e', thirdPartyTransferLogicScript: '24bb10207c62baeae9d83cfedcd515118c97fc7b3058f5c8006e49bf', unfrackingLogicScript: '', globalStatePolicyId: '150ee5da3e245ea055dcc11e324d9fae8b7c136d08b32f7e57b84663' },
  { key: 'fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3', next: SENTINEL, mintingLogicScript: '1fb1be91829d3438000b462c1caaa1f6b7dcf2a7bcd20ed3b7ccf78e', transferLogicScript: '7693691b6b7b1f1b3adf76900d177eb23b0c4fa341a6afbf14cc652f', thirdPartyTransferLogicScript: '005c11f180de619f7cf7fed7f7df112afe6fdb8ce8516b1a59324373', unfrackingLogicScript: '', globalStatePolicyId: '5ac411cfd57b6d6e0d673f03a441732bc724b299f3d828b600e3b231' },
];
const TOKENS_MN = [
  { key: '01c24df7941f8b5856762fcc8aa0bb61a8c24f0911ed6aef474034d0', next: 'b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8', mintingLogicScript: '4e9ba4785eebbeb77fe694c8451f1abec411f7774c09bbacfa3ba1ac', transferLogicScript: 'ddf0363f0d73f54778e792e16bad802df5fa50061319b1f01d280a37', thirdPartyTransferLogicScript: '446fc9584df8316cfab440c60d140e2007f236cdb65180917a374fb8', unfrackingLogicScript: '', globalStatePolicyId: '218ba0c5b7156b13c51e41096e34f0310823adf0e0d3fc70a741f3c2' },
  { key: 'b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8', next: 'ed5f6bb66712a157f0219978e8a17c5b4f9a7cb59d54714bd5984344', mintingLogicScript: 'f462a4e22e5b138c17d893d4e0811790f51f1231b8be4198313e08d0', transferLogicScript: '62b98b0894870aadfba1a7fd1b368c56aa91caa2701fb7e92a3f1bf1', thirdPartyTransferLogicScript: '1e17ac8b06f5f891d65923dee46e85a71e19deb401c8650e0401a3f0', unfrackingLogicScript: '', globalStatePolicyId: 'd2683a1b0b9bf3628db24fdf7cababb083084aec86a0cfd05b130ca3' },
  { key: 'ed5f6bb66712a157f0219978e8a17c5b4f9a7cb59d54714bd5984344', next: SENTINEL, mintingLogicScript: '708f442b9a2c48a40edcfcf84cff50eb059ec725e3a125aa1bf44718', transferLogicScript: 'c085c9c328a8a12ceeaf25bfd29cd1552b01a26d95682956da0cd7d0', thirdPartyTransferLogicScript: '87d71ef5f3ec494c21ec3d0f5804251be8afb2bff75a9ca02bdbe0ab', unfrackingLogicScript: '', globalStatePolicyId: '9c797108c48a6cef6354800921526526dde423ab86b735408eb160fe' },
];
const originNode = next => ({ key: '', next, mintingLogicScript: '', transferLogicScript: '', thirdPartyTransferLogicScript: '', unfrackingLogicScript: '', globalStatePolicyId: '' });
const WALK_PV = { protocolParams: PARAMS_PV, registryNodes: [originNode(TOKENS_PV[0].key), ...TOKENS_PV] };
const WALK_MN = { protocolParams: PARAMS_MN, registryNodes: [originNode(TOKENS_MN[0].key), ...TOKENS_MN] };
const GROUP_PV = { protocolParams: PARAMS_PV, registryNodes: TOKENS_PV };
const GROUP_MN = { protocolParams: PARAMS_MN, registryNodes: TOKENS_MN };
const PROTOCOLS_PV = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PARAMS_PV.registryNodePolicyId, progLogicScriptHash: PREVIEW_REFERENCE.scriptHash, tokenCount: 5, slot: 124284557, txHash: PREVIEW_REFERENCE.txHash }]);
const PROTOCOLS_MN = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PARAMS_MN.registryNodePolicyId, progLogicScriptHash: PARAMS_MN.programmableLogicBaseScriptHash, tokenCount: 3, slot: 199384339, txHash: 'bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72' }]);
const clone = v => JSON.parse(JSON.stringify(v));
const walkPv = () => parseRegistryNodesAll([clone(WALK_PV)])[0];
const tokensPv = () => parseRegistryTokens([clone(GROUP_PV)])[0];

test('parser accepts the live Preview and Mainnet walks, origin included', () => {
  const [pv] = parseRegistryNodesAll([clone(WALK_PV)]);
  assert.equal(pv.registryNodes.length, 6);
  assert.deepEqual(pv.registryNodes[0], originNode(TOKENS_PV[0].key));
  assert.deepEqual(Object.keys(pv.registryNodes[0]), ['key', 'next', 'mintingLogicScript', 'transferLogicScript', 'thirdPartyTransferLogicScript', 'unfrackingLogicScript', 'globalStatePolicyId']);
  // The walk's token nodes are exactly the tokens endpoint's nodes.
  assert.deepEqual(pv.registryNodes.slice(1), tokensPv().registryNodes);
  const [mn] = parseRegistryNodesAll([clone(WALK_MN)]);
  assert.equal(mn.registryNodes.length, 4);
  assert.equal(mn.registryNodes[3].next, SENTINEL);
  assert.equal(REGISTRY_TERMINAL_NEXT, SENTINEL);
});

test('parser canonicalises hex case across the walk, origin next included', () => {
  const upper = clone(WALK_PV);
  upper.registryNodes[0].next = upper.registryNodes[0].next.toUpperCase();
  upper.registryNodes[1].key = upper.registryNodes[1].key.toUpperCase();
  const [g] = parseRegistryNodesAll([upper]);
  assert.equal(g.registryNodes[0].next, TOKENS_PV[0].key);
  assert.equal(g.registryNodes[1].key, TOKENS_PV[0].key);
});

test('parser refuses a non-array response, malformed groups, and a group with no origin to walk from', () => {
  assert.throws(() => parseRegistryNodesAll(null), /Unexpected registry walk response/);
  assert.throws(() => parseRegistryNodesAll([null]), /Invalid registry walk group/);
  assert.throws(() => parseRegistryNodesAll([{ registryNodes: [originNode(SENTINEL)] }]), /protocol parameters/);
  assert.throws(() => parseRegistryNodesAll([{ protocolParams: { ...PARAMS_PV }, registryNodes: [] }]), /origin node is missing/);
  assert.throws(() => parseRegistryNodesAll([{ protocolParams: { ...PARAMS_PV }, registryNodes: {} }]), /origin node is missing/);
});

test('parser refuses an origin that carries logic — an origin with logic is not the origin', () => {
  const withMinting = clone(WALK_PV); withMinting.registryNodes[0].mintingLogicScript = 'ab'.repeat(28);
  assert.throws(() => parseRegistryNodesAll([withMinting]), /origin node carries a minting logic script/);
  const withGlobal = clone(WALK_PV); withGlobal.registryNodes[0].globalStatePolicyId = 'ab'.repeat(28);
  assert.throws(() => parseRegistryNodesAll([withGlobal]), /origin node carries a global state policy ID/);
  const badNext = clone(WALK_PV); badNext.registryNodes[0].next = 'ff'.repeat(29) + 'fe';
  assert.throws(() => parseRegistryNodesAll([badNext]), /next/);
});

test('parser refuses an empty key anywhere but the head, and malformed token nodes in a walk', () => {
  const midEmpty = clone(WALK_PV); midEmpty.registryNodes[2] = originNode(midEmpty.registryNodes[2].next);
  assert.throws(() => parseRegistryNodesAll([midEmpty]), /key/);
  const badKey = clone(WALK_PV); badKey.registryNodes[1].key = 'abcd';
  assert.throws(() => parseRegistryNodesAll([badKey]), /key/);
  const badField = clone(WALK_PV); badField.registryNodes[3].unfrackingLogicScript = 'ab'.repeat(29);
  assert.throws(() => parseRegistryNodesAll([badField]), /unfracking logic script/);
});

test('walk check passes on the live Preview and Mainnet walks', () => {
  const pv = registryWalkCheck(walkPv(), tokensPv(), PROTOCOLS_PV);
  assert.deepEqual(pv, { registryNodePolicyId: PARAMS_PV.registryNodePolicyId, nodeCount: 6, tokenCount: 5, hasOrigin: true, originCarriesNoLogic: true, originLinked: true, sorted: true, linked: true, terminatesAtSentinel: true, protocolFound: true, logicMatches: true, countMatches: true, tokensCompared: true, tokensAgree: true, ok: true });
  const mn = registryWalkCheck(parseRegistryNodesAll([clone(WALK_MN)])[0], parseRegistryTokens([clone(GROUP_MN)])[0], PROTOCOLS_MN);
  assert.equal(mn.ok, true);
  assert.equal(mn.nodeCount, 4);
});

test('walk check names a missing origin — the tokens list alone is not a walk', () => {
  const c = registryWalkCheck(tokensPv(), tokensPv(), PROTOCOLS_PV);
  assert.equal(c.hasOrigin, false);
  assert.equal(c.originLinked, false);
  assert.equal(c.ok, false);
});

test('walk check names an origin whose next does not name the first token', () => {
  const g = walkPv();
  g.registryNodes[0] = { ...g.registryNodes[0], next: g.registryNodes[2].key };
  const c = registryWalkCheck(g, tokensPv(), PROTOCOLS_PV);
  assert.equal(c.hasOrigin, true);
  assert.equal(c.originLinked, false);
  assert.equal(c.ok, false);
});

test('walk check names any node-for-node disagreement with the tokens read', () => {
  const oneField = tokensPv();
  oneField.registryNodes[1] = { ...oneField.registryNodes[1], transferLogicScript: 'aa'.repeat(28) };
  const c1 = registryWalkCheck(walkPv(), oneField, PROTOCOLS_PV);
  assert.equal(c1.tokensCompared, true); assert.equal(c1.tokensAgree, false); assert.equal(c1.ok, false);
  const oneShort = tokensPv();
  oneShort.registryNodes = oneShort.registryNodes.slice(0, 4);
  const c2 = registryWalkCheck(walkPv(), oneShort, PROTOCOLS_PV);
  assert.equal(c2.tokensAgree, false); assert.equal(c2.ok, false);
  const otherDeployment = parseRegistryTokens([clone(GROUP_MN)])[0];
  const c3 = registryWalkCheck(walkPv(), otherDeployment, PROTOCOLS_PV);
  assert.equal(c3.tokensCompared, false); assert.equal(c3.tokensAgree, null);
});

test('an uncompared tokens read is null, never a fabricated agreement', () => {
  const c = registryWalkCheck(walkPv(), null, PROTOCOLS_PV);
  assert.equal(c.tokensCompared, false);
  assert.equal(c.tokensAgree, null);
  assert.equal(c.ok, true);
});

test('an empty registry walks completely: origin terminating at the sentinel, count zero agreeing', () => {
  const empty = parseRegistryNodesAll([{ protocolParams: { ...PARAMS_PV }, registryNodes: [originNode(SENTINEL)] }])[0];
  const protocols0 = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PARAMS_PV.registryNodePolicyId, progLogicScriptHash: PREVIEW_REFERENCE.scriptHash, tokenCount: 0, slot: 124284557, txHash: PREVIEW_REFERENCE.txHash }]);
  const emptyTokens = parseRegistryTokens([{ protocolParams: { ...PARAMS_PV }, registryNodes: [] }])[0];
  const c = registryWalkCheck(empty, emptyTokens, protocols0);
  assert.deepEqual([c.nodeCount, c.tokenCount, c.originLinked, c.terminatesAtSentinel, c.tokensAgree, c.ok], [1, 0, true, true, true, true]);
  const dangling = registryWalkCheck({ protocolParams: { ...PARAMS_PV }, registryNodes: [originNode(TOKENS_PV[0].key)] }, emptyTokens, protocols0);
  assert.equal(dangling.originLinked, false);
  assert.equal(dangling.ok, false);
});

test('walk check inherits the chain verdicts: a broken token chain fails the walk', () => {
  const g = walkPv();
  [g.registryNodes[1], g.registryNodes[2]] = [g.registryNodes[2], g.registryNodes[1]];
  const c = registryWalkCheck(g, tokensPv(), PROTOCOLS_PV);
  assert.equal(c.sorted, false);
  assert.equal(c.ok, false);
  const noProtocol = registryWalkCheck(walkPv(), tokensPv(), PROTOCOLS_MN);
  assert.deepEqual([noProtocol.protocolFound, noProtocol.ok], [false, false]);
  assert.deepEqual([noProtocol.hasOrigin, noProtocol.originLinked], [true, true]);
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('getRegistryNodesAll reads the nodes/all endpoint keyed by the numeric protocol id', async () => {
  const stub = stubFetch(async () => ({ ok: true, json: async () => [clone(WALK_PV)] }));
  try {
    const res = await getRegistryNodesAll('preview', 1, [tokensPv()], PROTOCOLS_PV);
    assert.deepEqual(stub.seen, ['https://preview-indexer.programmabletokens.xyz/api/v1/registry/nodes/all?protocolParamsId=1']);
    assert.equal(res.groups[0].registryNodes.length, 6);
    assert.equal(res.walks[0].ok, true);
    assert.ok(Number.isFinite(res.fetchedAt));
  } finally { stub.restore(); }
});

test('getRegistryNodesAll refuses an unusable id before any fetch, and surfaces failures', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try {
    await assert.rejects(() => getRegistryNodesAll('preview', undefined, [], []), /protocol parameters ID/);
    await assert.rejects(() => getRegistryNodesAll('preview', -1, [], []), /protocol parameters ID/);
    await assert.rejects(() => getRegistryNodesAll('preview', 1.5, [], []), /protocol parameters ID/);
    await assert.rejects(() => getRegistryNodesAll('devnet', 1, [], []), /Unknown network/);
  } finally { stub.restore(); }
  const http = stubFetch(async () => ({ ok: false, status: 503, json: async () => [] }));
  try { await assert.rejects(() => getRegistryNodesAll('preview', 1, [], []), /HTTP 503/); }
  finally { http.restore(); }
});

test('app wires the full walk: origin row, walk verdict, honest partial failure, v1.94', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getRegistryNodesAll\(state\.network,p\.protocolParamsId/);
  assert.match(app, /Walk check passed/);
  assert.match(app, /Walk check FAILED/);
  assert.match(app, /Registry walk unavailable\.<\/strong>/);
  assert.match(app, /origin \(empty key\)/);
  assert.match(app, /WORKSPACE <span>v1\.94<\/span>/);
});
