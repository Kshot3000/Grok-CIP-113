import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, parseRegistryTokens, registryChainCheck, getRegistryTokens, REGISTRY_TERMINAL_NEXT } from '../src/services.js';
import { PREVIEW_REFERENCE } from '../src/config.js';

// Fixtures are the indexers' real /api/v1/registry/tokens responses,
// captured live on 2026-10-10 (Preview: 5 registered tokens, Mainnet: 3).
// Preview's group names the pinned reference deployment's policy and base
// hash, written from PREVIEW_REFERENCE where the values coincide, so the
// chain cross-check below proves the live shape and the pin agree.
const SENTINEL = 'ff'.repeat(30);
const PREVIEW_GROUP = {
  protocolParams: { registryNodePolicyId: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a', programmableLogicBaseScriptHash: PREVIEW_REFERENCE.scriptHash },
  registryNodes: [
    { key: '4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea', next: '8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e', mintingLogicScript: 'c69d5fcde26c893e85832a6b1c1d7735fc442da99173f5c35e875437', transferLogicScript: '6065c106ec3acd598416fb8c2a30103ad093136432001bb1c8df7b01', thirdPartyTransferLogicScript: '26e0ab3b4c1714854cab6bee42ec924ad97b938fa430614a06fb4376', unfrackingLogicScript: '', globalStatePolicyId: '622f404d9266032ec4461373897311a22df63fbf2bb4239758b81e02' },
    { key: '8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e', next: '8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04', mintingLogicScript: 'ee5a1836e13e0b8da451f40f5d52c5a1d886f1d8a045de502adde1f7', transferLogicScript: '3e9ff38e0543b03e298811e1396a1d93106ff16b6e901675a0b4f124', thirdPartyTransferLogicScript: '4e38fe6f1cb2a1596ae4010c05d2e4458158dbc513bc1764201a2aa8', unfrackingLogicScript: '', globalStatePolicyId: '804c1d2fa61bed013f808f3b47b023da74cb15d1456ac5e044d43b42' },
    { key: '8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04', next: 'ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2', mintingLogicScript: '174db21c54bfa8a7cd02bdc41f287cbb370df9e106cc1028fb1bb103', transferLogicScript: 'c255bcb38d8d5b22aa57308cf1cbaa9d3ee7ea2f373fb01fee18619e', thirdPartyTransferLogicScript: '321c2f48fea5bd016ef5f26a4d78d9b13c251193037e08b1a6bfc28a', unfrackingLogicScript: '', globalStatePolicyId: '489f8058d95cbd35d20ebcf199856c5780a858c25bb70209d21587ce' },
    { key: 'ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2', next: 'fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3', mintingLogicScript: '0efb02aa36b3e6167c3f450249c2f9bbaf2d49efe80b930e1fb8e11e', transferLogicScript: '108f11b59a5afbaac5451bd86e22f002ebafc23d93d01f542ce93f4e', thirdPartyTransferLogicScript: '24bb10207c62baeae9d83cfedcd515118c97fc7b3058f5c8006e49bf', unfrackingLogicScript: '', globalStatePolicyId: '150ee5da3e245ea055dcc11e324d9fae8b7c136d08b32f7e57b84663' },
    { key: 'fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3', next: SENTINEL, mintingLogicScript: '1fb1be91829d3438000b462c1caaa1f6b7dcf2a7bcd20ed3b7ccf78e', transferLogicScript: '7693691b6b7b1f1b3adf76900d177eb23b0c4fa341a6afbf14cc652f', thirdPartyTransferLogicScript: '005c11f180de619f7cf7fed7f7df112afe6fdb8ce8516b1a59324373', unfrackingLogicScript: '', globalStatePolicyId: '5ac411cfd57b6d6e0d673f03a441732bc724b299f3d828b600e3b231' },
  ],
};
const MAINNET_GROUP = {
  protocolParams: { registryNodePolicyId: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075', programmableLogicBaseScriptHash: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838' },
  registryNodes: [
    { key: '01c24df7941f8b5856762fcc8aa0bb61a8c24f0911ed6aef474034d0', next: 'b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8', mintingLogicScript: '4e9ba4785eebbeb77fe694c8451f1abec411f7774c09bbacfa3ba1ac', transferLogicScript: 'ddf0363f0d73f54778e792e16bad802df5fa50061319b1f01d280a37', thirdPartyTransferLogicScript: '446fc9584df8316cfab440c60d140e2007f236cdb65180917a374fb8', unfrackingLogicScript: '', globalStatePolicyId: '218ba0c5b7156b13c51e41096e34f0310823adf0e0d3fc70a741f3c2' },
    { key: 'b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8', next: 'ed5f6bb66712a157f0219978e8a17c5b4f9a7cb59d54714bd5984344', mintingLogicScript: 'f462a4e22e5b138c17d893d4e0811790f51f1231b8be4198313e08d0', transferLogicScript: '62b98b0894870aadfba1a7fd1b368c56aa91caa2701fb7e92a3f1bf1', thirdPartyTransferLogicScript: '1e17ac8b06f5f891d65923dee46e85a71e19deb401c8650e0401a3f0', unfrackingLogicScript: '', globalStatePolicyId: 'd2683a1b0b9bf3628db24fdf7cababb083084aec86a0cfd05b130ca3' },
    { key: 'ed5f6bb66712a157f0219978e8a17c5b4f9a7cb59d54714bd5984344', next: SENTINEL, mintingLogicScript: '708f442b9a2c48a40edcfcf84cff50eb059ec725e3a125aa1bf44718', transferLogicScript: 'c085c9c328a8a12ceeaf25bfd29cd1552b01a26d95682956da0cd7d0', thirdPartyTransferLogicScript: '87d71ef5f3ec494c21ec3d0f5804251be8afb2bff75a9ca02bdbe0ab', unfrackingLogicScript: '', globalStatePolicyId: '9c797108c48a6cef6354800921526526dde423ab86b735408eb160fe' },
  ],
};
// One real Preprod node (of 16): non-empty unfracking script, empty
// global-state policy — the two variable fields in their other positions.
const PREPROD_NODE = { key: '523103dff865f8f5fcd9e6b10666b30f3b1c0b08cba5214ed17dc295', next: '5568d71be0b1614f2942f0efbfd98c4d01a2eabe1d97ddf65b92ef86', mintingLogicScript: '875c6f9827060da8b5b53adaa6afeca00692e592dae884b063569c22', transferLogicScript: '02f93ebf7dc6fec17f47021965edcbdbccb34a29663d43b678e31f5d', thirdPartyTransferLogicScript: '02f93ebf7dc6fec17f47021965edcbdbccb34a29663d43b678e31f5d', unfrackingLogicScript: '02f93ebf7dc6fec17f47021965edcbdbccb34a29663d43b678e31f5d', globalStatePolicyId: '' };

const PREVIEW_PROTOCOLS = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PREVIEW_GROUP.protocolParams.registryNodePolicyId, progLogicScriptHash: PREVIEW_REFERENCE.scriptHash, tokenCount: 5, slot: 124284557, txHash: PREVIEW_REFERENCE.txHash }]);
const MAINNET_PROTOCOLS = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: MAINNET_GROUP.protocolParams.registryNodePolicyId, progLogicScriptHash: MAINNET_GROUP.protocolParams.programmableLogicBaseScriptHash, tokenCount: 3, slot: 199384339, txHash: 'bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72' }]);
const clone = v => JSON.parse(JSON.stringify(v));

test('the terminal constant is the 30-byte sentinel the datum model uses', () => {
  assert.equal(REGISTRY_TERMINAL_NEXT, SENTINEL);
  assert.equal(REGISTRY_TERMINAL_NEXT.length, 60);
});

test('parser accepts the live-shaped groups from Preview and Mainnet', () => {
  const [pv] = parseRegistryTokens([clone(PREVIEW_GROUP)]);
  assert.equal(pv.registryNodes.length, 5);
  assert.deepEqual(Object.keys(pv), ['protocolParams', 'registryNodes']);
  assert.deepEqual(Object.keys(pv.registryNodes[0]), ['key', 'next', 'mintingLogicScript', 'transferLogicScript', 'thirdPartyTransferLogicScript', 'unfrackingLogicScript', 'globalStatePolicyId']);
  assert.equal(pv.registryNodes[4].next, SENTINEL);
  const [mn] = parseRegistryTokens([clone(MAINNET_GROUP)]);
  assert.equal(mn.registryNodes.length, 3);
  assert.deepEqual(parseRegistryTokens([]), []);
});

test('parser accepts the variable fields in both positions (empty is a meaning)', () => {
  const group = { protocolParams: { ...PREVIEW_GROUP.protocolParams }, registryNodes: [clone(PREPROD_NODE)] };
  const [g] = parseRegistryTokens([group]);
  assert.equal(g.registryNodes[0].unfrackingLogicScript, PREPROD_NODE.unfrackingLogicScript);
  assert.equal(g.registryNodes[0].globalStatePolicyId, '');
  const [pv] = parseRegistryTokens([clone(PREVIEW_GROUP)]);
  assert.equal(pv.registryNodes[0].unfrackingLogicScript, '');
  assert.equal(pv.registryNodes[0].globalStatePolicyId.length, 56);
});

test('parser canonicalises hex case, the terminal sentinel included', () => {
  const upper = clone(PREVIEW_GROUP);
  upper.registryNodes[0].key = upper.registryNodes[0].key.toUpperCase();
  upper.registryNodes[4].next = 'FF'.repeat(30);
  const [g] = parseRegistryTokens([upper]);
  assert.equal(g.registryNodes[0].key, PREVIEW_GROUP.registryNodes[0].key);
  assert.equal(g.registryNodes[4].next, SENTINEL);
});

test('parser refuses a non-array response and malformed groups, naming the field', () => {
  assert.throws(() => parseRegistryTokens(null), /Unexpected registry tokens response/);
  assert.throws(() => parseRegistryTokens([null]), /Invalid registry token group/);
  assert.throws(() => parseRegistryTokens([{ registryNodes: [] }]), /protocol parameters/);
  assert.throws(() => parseRegistryTokens([{ protocolParams: { registryNodePolicyId: 'e5b3', programmableLogicBaseScriptHash: PREVIEW_REFERENCE.scriptHash }, registryNodes: [] }]), /registry node policy ID/);
  assert.throws(() => parseRegistryTokens([{ protocolParams: { registryNodePolicyId: PREVIEW_GROUP.protocolParams.registryNodePolicyId, programmableLogicBaseScriptHash: PREVIEW_REFERENCE.txHash }, registryNodes: [] }]), /programmable logic base script hash/);
  assert.throws(() => parseRegistryTokens([{ protocolParams: { ...PREVIEW_GROUP.protocolParams }, registryNodes: {} }]), /registry nodes/);
});

test('parser refuses malformed nodes, naming the field', () => {
  const bad = (mutate) => { const g = clone(PREVIEW_GROUP); mutate(g.registryNodes[1]); return [g]; };
  assert.throws(() => parseRegistryTokens(bad(n => { n.key = 'abcd'; })), /key/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.key = 'zz'.repeat(28); })), /key/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.next = ''; })), /next/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.next = 'ff'.repeat(29) + 'fe'; })), /next/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.next = 'ab'.repeat(30); })), /next/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.mintingLogicScript = 'ab'; })), /minting logic script/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.transferLogicScript = 'zz'.repeat(28); })), /transfer logic script/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.thirdPartyTransferLogicScript = undefined; })), /third-party logic script/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.unfrackingLogicScript = 'ab'.repeat(29); })), /unfracking logic script/);
  assert.throws(() => parseRegistryTokens(bad(n => { n.globalStatePolicyId = 'ab'.repeat(27); })), /global state policy ID/);
});

test('one malformed node refuses the whole response, never a partial chain', () => {
  const g = clone(MAINNET_GROUP); g.registryNodes[2].key = 'x';
  assert.throws(() => parseRegistryTokens([clone(PREVIEW_GROUP), g]), /key/);
});

test('chain check passes on the live Preview and Mainnet chains', () => {
  const pv = registryChainCheck(parseRegistryTokens([clone(PREVIEW_GROUP)])[0], PREVIEW_PROTOCOLS);
  assert.deepEqual(pv, { registryNodePolicyId: PREVIEW_GROUP.protocolParams.registryNodePolicyId, nodeCount: 5, sorted: true, linked: true, terminatesAtSentinel: true, protocolFound: true, logicMatches: true, countMatches: true, ok: true });
  const mn = registryChainCheck(parseRegistryTokens([clone(MAINNET_GROUP)])[0], MAINNET_PROTOCOLS);
  assert.equal(mn.ok, true);
  assert.equal(mn.nodeCount, 3);
});

test('chain check names an unsorted or duplicated key list', () => {
  const swapped = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  [swapped.registryNodes[0], swapped.registryNodes[1]] = [swapped.registryNodes[1], swapped.registryNodes[0]];
  const c1 = registryChainCheck(swapped, PREVIEW_PROTOCOLS);
  assert.equal(c1.sorted, false); assert.equal(c1.ok, false);
  const dup = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  dup.registryNodes[1] = { ...dup.registryNodes[1], key: dup.registryNodes[0].key };
  assert.equal(registryChainCheck(dup, PREVIEW_PROTOCOLS).sorted, false);
});

test('chain check names a broken link while the keys still sort', () => {
  const g = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  g.registryNodes[1] = { ...g.registryNodes[1], next: g.registryNodes[3].key };
  const c = registryChainCheck(g, PREVIEW_PROTOCOLS);
  assert.equal(c.sorted, true); assert.equal(c.linked, false); assert.equal(c.ok, false);
});

test('chain check names a last node that does not terminate at the sentinel', () => {
  const g = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  g.registryNodes[4] = { ...g.registryNodes[4], next: g.registryNodes[0].key };
  const c = registryChainCheck(g, PREVIEW_PROTOCOLS);
  assert.equal(c.terminatesAtSentinel, false); assert.equal(c.ok, false);
});

test('chain check names count and logic disagreements with the deployments list', () => {
  const g = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  const wrongCount = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PREVIEW_GROUP.protocolParams.registryNodePolicyId, progLogicScriptHash: PREVIEW_REFERENCE.scriptHash, tokenCount: 4, slot: 124284557, txHash: PREVIEW_REFERENCE.txHash }]);
  const c1 = registryChainCheck(g, wrongCount);
  assert.equal(c1.countMatches, false); assert.equal(c1.logicMatches, true); assert.equal(c1.ok, false);
  const wrongLogic = parseRegistryProtocols([{ protocolParamsId: 1, registryNodePolicyId: PREVIEW_GROUP.protocolParams.registryNodePolicyId, progLogicScriptHash: 'aa'.repeat(28), tokenCount: 5, slot: 124284557, txHash: PREVIEW_REFERENCE.txHash }]);
  const c2 = registryChainCheck(g, wrongLogic);
  assert.equal(c2.logicMatches, false); assert.equal(c2.countMatches, true); assert.equal(c2.ok, false);
});

test('a chain with no matching deployment keeps its chain verdicts and fails the cross-check', () => {
  const g = parseRegistryTokens([clone(PREVIEW_GROUP)])[0];
  const c = registryChainCheck(g, MAINNET_PROTOCOLS);
  assert.deepEqual([c.sorted, c.linked, c.terminatesAtSentinel], [true, true, true]);
  assert.deepEqual([c.protocolFound, c.logicMatches, c.countMatches, c.ok], [false, false, false, false]);
});

test('an empty group verifies nothing — no vacuous pass', () => {
  const c = registryChainCheck({ protocolParams: { ...PREVIEW_GROUP.protocolParams }, registryNodes: [] }, PREVIEW_PROTOCOLS);
  assert.deepEqual([c.sorted, c.linked, c.terminatesAtSentinel, c.ok], [false, false, false, false]);
  assert.equal(c.nodeCount, 0);
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('getRegistryTokens reads the tokens endpoint and returns the checked groups', async () => {
  const stub = stubFetch(async () => ({ ok: true, json: async () => [clone(PREVIEW_GROUP)] }));
  try {
    const res = await getRegistryTokens('preview', PREVIEW_PROTOCOLS);
    assert.deepEqual(stub.seen, ['https://preview-indexer.programmabletokens.xyz/api/v1/registry/tokens']);
    assert.equal(res.groups[0].registryNodes.length, 5);
    assert.equal(res.chains[0].ok, true);
    assert.ok(Number.isFinite(res.fetchedAt));
  } finally { stub.restore(); }
});

test('getRegistryTokens refuses an unknown network before any fetch, and surfaces failures', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try { await assert.rejects(() => getRegistryTokens('devnet', []), /Unknown network/); }
  finally { stub.restore(); }
  const http = stubFetch(async () => ({ ok: false, status: 503, json: async () => [] }));
  try { await assert.rejects(() => getRegistryTokens('preview', PREVIEW_PROTOCOLS), /HTTP 503/); }
  finally { http.restore(); }
  const bad = clone(PREVIEW_GROUP); bad.registryNodes[0].key = 'nope';
  const malformed = stubFetch(async () => ({ ok: true, json: async () => [bad] }));
  try { await assert.rejects(() => getRegistryTokens('preview', PREVIEW_PROTOCOLS), /key/); }
  finally { malformed.restore(); }
});

test('app wires the registered-tokens read: chain verdict, honest partial failure, v1.98', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getRegistryTokens\(state\.network,reg\.protocols\)/);
  assert.match(app, /Chain check passed/);
  assert.match(app, /Chain check FAILED/);
  assert.match(app, /Registered tokens unavailable\.<\/strong>/);
  assert.match(app, /Unfracking forbidden \(empty script\)/);
  assert.match(app, /WORKSPACE <span>v1\.98<\/span>/);
});
