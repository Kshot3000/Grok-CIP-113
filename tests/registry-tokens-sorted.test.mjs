import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryProtocols, parseRegistryTokens, registryTokensSortedCheck, getRegistryTokensSorted } from '../src/services.js';

// Fixtures are the indexers' real responses, captured live on 2026-10-16:
// Preview /api/v1/registry/tokens/sorted?protocolParamsId=1, Preview
// /api/v1/registry/tokens, and Preview /api/v1/registry/protocols — one
// deployment's chain read three ways, which is exactly what the sorted
// cross-check compares. The endpoint requires its protocol parameters
// ID (it answers 400 without one); the plain tokens endpoint takes the
// ID optionally.
const SORTED_LIVE = [
 {
  "protocolParams": {
   "registryNodePolicyId": "e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a",
   "programmableLogicBaseScriptHash": "35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16"
  },
  "registryNodes": [
   {
    "key": "08277852eff0ca8b997b2d371f8aaf4af9f00f03823d46233053adac",
    "next": "4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea",
    "mintingLogicScript": "d17309a4c540c574b78b019d98f4b418b962c23be5e7683d3b5d2d41",
    "transferLogicScript": "d90293b2a799757b8433a737f1c6cb45f337f4aecf65bfba4607187f",
    "thirdPartyTransferLogicScript": "25ea5b6f9cf6a3b01a0375159c8d865e6225d1a30aa57b2ac5f330e9",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": ""
   },
   {
    "key": "4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea",
    "next": "8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e",
    "mintingLogicScript": "c69d5fcde26c893e85832a6b1c1d7735fc442da99173f5c35e875437",
    "transferLogicScript": "6065c106ec3acd598416fb8c2a30103ad093136432001bb1c8df7b01",
    "thirdPartyTransferLogicScript": "26e0ab3b4c1714854cab6bee42ec924ad97b938fa430614a06fb4376",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "622f404d9266032ec4461373897311a22df63fbf2bb4239758b81e02"
   },
   {
    "key": "8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e",
    "next": "8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04",
    "mintingLogicScript": "ee5a1836e13e0b8da451f40f5d52c5a1d886f1d8a045de502adde1f7",
    "transferLogicScript": "3e9ff38e0543b03e298811e1396a1d93106ff16b6e901675a0b4f124",
    "thirdPartyTransferLogicScript": "4e38fe6f1cb2a1596ae4010c05d2e4458158dbc513bc1764201a2aa8",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "804c1d2fa61bed013f808f3b47b023da74cb15d1456ac5e044d43b42"
   },
   {
    "key": "8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04",
    "next": "ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2",
    "mintingLogicScript": "174db21c54bfa8a7cd02bdc41f287cbb370df9e106cc1028fb1bb103",
    "transferLogicScript": "c255bcb38d8d5b22aa57308cf1cbaa9d3ee7ea2f373fb01fee18619e",
    "thirdPartyTransferLogicScript": "321c2f48fea5bd016ef5f26a4d78d9b13c251193037e08b1a6bfc28a",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "489f8058d95cbd35d20ebcf199856c5780a858c25bb70209d21587ce"
   },
   {
    "key": "ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2",
    "next": "fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3",
    "mintingLogicScript": "0efb02aa36b3e6167c3f450249c2f9bbaf2d49efe80b930e1fb8e11e",
    "transferLogicScript": "108f11b59a5afbaac5451bd86e22f002ebafc23d93d01f542ce93f4e",
    "thirdPartyTransferLogicScript": "24bb10207c62baeae9d83cfedcd515118c97fc7b3058f5c8006e49bf",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "150ee5da3e245ea055dcc11e324d9fae8b7c136d08b32f7e57b84663"
   },
   {
    "key": "fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3",
    "next": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "mintingLogicScript": "1fb1be91829d3438000b462c1caaa1f6b7dcf2a7bcd20ed3b7ccf78e",
    "transferLogicScript": "7693691b6b7b1f1b3adf76900d177eb23b0c4fa341a6afbf14cc652f",
    "thirdPartyTransferLogicScript": "005c11f180de619f7cf7fed7f7df112afe6fdb8ce8516b1a59324373",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "5ac411cfd57b6d6e0d673f03a441732bc724b299f3d828b600e3b231"
   }
  ]
 }
];
const TOKENS_LIVE = [
 {
  "protocolParams": {
   "registryNodePolicyId": "e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a",
   "programmableLogicBaseScriptHash": "35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16"
  },
  "registryNodes": [
   {
    "key": "08277852eff0ca8b997b2d371f8aaf4af9f00f03823d46233053adac",
    "next": "4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea",
    "mintingLogicScript": "d17309a4c540c574b78b019d98f4b418b962c23be5e7683d3b5d2d41",
    "transferLogicScript": "d90293b2a799757b8433a737f1c6cb45f337f4aecf65bfba4607187f",
    "thirdPartyTransferLogicScript": "25ea5b6f9cf6a3b01a0375159c8d865e6225d1a30aa57b2ac5f330e9",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": ""
   },
   {
    "key": "4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea",
    "next": "8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e",
    "mintingLogicScript": "c69d5fcde26c893e85832a6b1c1d7735fc442da99173f5c35e875437",
    "transferLogicScript": "6065c106ec3acd598416fb8c2a30103ad093136432001bb1c8df7b01",
    "thirdPartyTransferLogicScript": "26e0ab3b4c1714854cab6bee42ec924ad97b938fa430614a06fb4376",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "622f404d9266032ec4461373897311a22df63fbf2bb4239758b81e02"
   },
   {
    "key": "8f1cf338bc74b437f6e4361c077e62bf8ba0f608893bc1dde52ae68e",
    "next": "8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04",
    "mintingLogicScript": "ee5a1836e13e0b8da451f40f5d52c5a1d886f1d8a045de502adde1f7",
    "transferLogicScript": "3e9ff38e0543b03e298811e1396a1d93106ff16b6e901675a0b4f124",
    "thirdPartyTransferLogicScript": "4e38fe6f1cb2a1596ae4010c05d2e4458158dbc513bc1764201a2aa8",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "804c1d2fa61bed013f808f3b47b023da74cb15d1456ac5e044d43b42"
   },
   {
    "key": "8fef17bf2b5458d341f4c8dc28d7ae80cf41938b2abe90d78d97cf04",
    "next": "ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2",
    "mintingLogicScript": "174db21c54bfa8a7cd02bdc41f287cbb370df9e106cc1028fb1bb103",
    "transferLogicScript": "c255bcb38d8d5b22aa57308cf1cbaa9d3ee7ea2f373fb01fee18619e",
    "thirdPartyTransferLogicScript": "321c2f48fea5bd016ef5f26a4d78d9b13c251193037e08b1a6bfc28a",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "489f8058d95cbd35d20ebcf199856c5780a858c25bb70209d21587ce"
   },
   {
    "key": "ecfe3319f2162b7206f186bf47ce27592dd2e96f87c8f8c83c71e6a2",
    "next": "fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3",
    "mintingLogicScript": "0efb02aa36b3e6167c3f450249c2f9bbaf2d49efe80b930e1fb8e11e",
    "transferLogicScript": "108f11b59a5afbaac5451bd86e22f002ebafc23d93d01f542ce93f4e",
    "thirdPartyTransferLogicScript": "24bb10207c62baeae9d83cfedcd515118c97fc7b3058f5c8006e49bf",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "150ee5da3e245ea055dcc11e324d9fae8b7c136d08b32f7e57b84663"
   },
   {
    "key": "fade8905bc06f0f30b44175e3fc776c7233e41855adf8df1be7ab5d3",
    "next": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "mintingLogicScript": "1fb1be91829d3438000b462c1caaa1f6b7dcf2a7bcd20ed3b7ccf78e",
    "transferLogicScript": "7693691b6b7b1f1b3adf76900d177eb23b0c4fa341a6afbf14cc652f",
    "thirdPartyTransferLogicScript": "005c11f180de619f7cf7fed7f7df112afe6fdb8ce8516b1a59324373",
    "unfrackingLogicScript": "",
    "globalStatePolicyId": "5ac411cfd57b6d6e0d673f03a441732bc724b299f3d828b600e3b231"
   }
  ]
 }
];
const PROTOCOLS_LIVE = [
 {
  "protocolParamsId": 1,
  "registryNodePolicyId": "e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a",
  "progLogicScriptHash": "35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16",
  "tokenCount": 6,
  "slot": 124284557,
  "txHash": "8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9"
 }
];
const clone = v => JSON.parse(JSON.stringify(v));
const parsed = () => ({
  sorted: parseRegistryTokens(clone(SORTED_LIVE)),
  tokens: parseRegistryTokens(clone(TOKENS_LIVE)),
  protocols: parseRegistryProtocols(clone(PROTOCOLS_LIVE)),
});

test('the live sorted fixture parses through the tokens parser, validate-once', () => {
  const { sorted } = parsed();
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].registryNodes.length, 6);
  assert.equal(sorted[0].protocolParams.registryNodePolicyId, PROTOCOLS_LIVE[0].registryNodePolicyId);
  assert.equal(sorted[0].registryNodes[0].key, '08277852eff0ca8b997b2d371f8aaf4af9f00f03823d46233053adac');
});

test('registryTokensSortedCheck verifies the live read: order claimed, order proven, reads agreeing', () => {
  const { sorted, tokens, protocols } = parsed();
  const c = registryTokensSortedCheck(sorted, 1, tokens, protocols);
  assert.deepEqual(c, { protocolParamsId: 1, registryNodePolicyId: PROTOCOLS_LIVE[0].registryNodePolicyId, deploymentListed: true, groupFound: true, nodeCount: 6, sorted: true, linked: true, terminatesAtSentinel: true, protocolFound: true, logicMatches: true, countMatches: true, tokensCompared: true, tokensAgree: true, ok: true });
});

test('registryTokensSortedCheck fails by name when the returned order is not the claimed order', () => {
  const { tokens, protocols } = parsed();
  const raw = clone(SORTED_LIVE);
  raw[0].registryNodes.reverse();
  const c = registryTokensSortedCheck(parseRegistryTokens(raw), 1, tokens, protocols);
  assert.equal(c.groupFound, true);
  assert.equal(c.sorted, false);
  assert.equal(c.ok, false);
});

test('registryTokensSortedCheck fails when a sorted node disagrees with the tokens read in one field', () => {
  const { tokens, protocols } = parsed();
  const raw = clone(SORTED_LIVE);
  raw[0].registryNodes[2].transferLogicScript = '0'.repeat(56);
  const c = registryTokensSortedCheck(parseRegistryTokens(raw), 1, tokens, protocols);
  assert.equal(c.tokensCompared, true);
  assert.equal(c.tokensAgree, false);
  assert.equal(c.ok, false);
});

test('registryTokensSortedCheck fails when the sorted answer carries no group for the deployment', () => {
  const { tokens, protocols } = parsed();
  const c = registryTokensSortedCheck([], 1, tokens, protocols);
  assert.equal(c.deploymentListed, true);
  assert.equal(c.groupFound, false);
  assert.equal(c.nodeCount, 0);
  assert.equal(c.ok, false);
});

test('registryTokensSortedCheck verifies nothing for an unlisted deployment ID', () => {
  const { sorted, tokens, protocols } = parsed();
  const c = registryTokensSortedCheck(sorted, 999, tokens, protocols);
  assert.equal(c.deploymentListed, false);
  assert.equal(c.registryNodePolicyId, null);
  assert.equal(c.groupFound, false);
  assert.equal(c.tokensAgree, null);
  assert.equal(c.ok, false);
});

test('registryTokensSortedCheck leaves the tokens verdict null when that read never ran', () => {
  const { sorted, protocols } = parsed();
  const c = registryTokensSortedCheck(sorted, 1, null, protocols);
  assert.equal(c.tokensCompared, false);
  assert.equal(c.tokensAgree, null);
  assert.equal(c.ok, true);
});

test('registryTokensSortedCheck fails when the deployments count disagrees with the sorted nodes', () => {
  const { sorted, tokens } = parsed();
  const protocols = parseRegistryProtocols(clone(PROTOCOLS_LIVE).map(p => ({ ...p, tokenCount: 7 })));
  const c = registryTokensSortedCheck(sorted, 1, tokens, protocols);
  assert.equal(c.countMatches, false);
  assert.equal(c.ok, false);
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const okJson = v => ({ ok: true, json: async () => v });

test('getRegistryTokensSorted reads the keyed sorted endpoint and cross-checks', async () => {
  const stub = stubFetch(async url => {
    assert.match(url, /registry\/tokens\/sorted\?protocolParamsId=1$/);
    return okJson(clone(SORTED_LIVE));
  });
  try {
    const { tokens, protocols } = parsed();
    const r = await getRegistryTokensSorted('preview', 1, tokens, protocols);
    assert.equal(r.network, 'preview');
    assert.equal(r.protocolParamsId, 1);
    assert.equal(r.check.ok, true);
    assert.equal(stub.seen.length, 1);
  } finally { stub.restore(); }
});

test('getRegistryTokensSorted refuses a bad protocol parameters ID before any fetch', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try {
    for (const bad of [-1, 1.5, NaN, '1', null, undefined]) {
      await assert.rejects(() => getRegistryTokensSorted('preview', bad, null, []), /protocol parameters ID/);
    }
    assert.equal(stub.seen.length, 0);
  } finally { stub.restore(); }
});

test('getRegistryTokensSorted refuses an unknown network before any fetch', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try { await assert.rejects(() => getRegistryTokensSorted('devnet', 1, null, []), /Unknown network/); }
  finally { stub.restore(); }
});

test('getRegistryTokensSorted surfaces an indexer failure instead of a sorted list', async () => {
  const http = stubFetch(async () => ({ ok: false, status: 400, json: async () => ({}) }));
  try { await assert.rejects(() => getRegistryTokensSorted('preview', 1, null, []), /HTTP 400/); }
  finally { http.restore(); }
  const lying = stubFetch(async () => okJson(clone(SORTED_LIVE).map(g => ({ ...g, registryNodes: g.registryNodes.map((n, i) => i === 0 ? { ...n, next: 'abcd' } : n) }))));
  try { await assert.rejects(() => getRegistryTokensSorted('preview', 1, null, []), /registry node record: next/); }
  finally { lying.restore(); }
});

test('app wires the sorted read: keyed reads, verdict lines, honest unavailable state, v1\\.210', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getRegistryTokensSorted\(state\.network,p\.protocolParamsId,toks\?\.groups\?\?null,reg\.protocols\)/);
  assert.match(app, /Registered tokens, sorted by the indexer/);
  assert.match(app, /Sorted tokens check passed/);
  assert.match(app, /Sorted tokens check FAILED/);
  assert.match(app, /Sorted tokens unavailable\.<\/strong>/);
  assert.match(app, /WORKSPACE <span>v1\.231<\/span>/);
});
