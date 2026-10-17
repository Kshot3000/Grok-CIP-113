import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRegistryTokens, parseRegisteredFlag, parseRegistryToken, registryLookupCheck, getRegistryToken } from '../src/services.js';

// Fixtures are the indexers' real responses, captured live on 2026-10-16:
// Preview /api/v1/registry/token/{policyId} for the first registered
// token in the Preview tokens list, and that list's own group (the first
// two nodes) — the same token read two ways, which is exactly what the
// lookup cross-check compares. The is-registered answers are the live
// answers for this policy (true) and for the all-zero policy (false).
const NODE_LIVE = {
  "key": "08277852eff0ca8b997b2d371f8aaf4af9f00f03823d46233053adac",
  "next": "4f5355228dc27ff4e88f4606f31bdc481982b8a69ff35da49ab44cea",
  "mintingLogicScript": "d17309a4c540c574b78b019d98f4b418b962c23be5e7683d3b5d2d41",
  "transferLogicScript": "d90293b2a799757b8433a737f1c6cb45f337f4aecf65bfba4607187f",
  "thirdPartyTransferLogicScript": "25ea5b6f9cf6a3b01a0375159c8d865e6225d1a30aa57b2ac5f330e9",
  "unfrackingLogicScript": "",
  "globalStatePolicyId": ""
};
const GROUP_LIVE = {
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
    }
  ]
};
const POLICY = NODE_LIVE.key;
const ABSENT = '00'.repeat(28);
const clone = v => JSON.parse(JSON.stringify(v));
const group = () => parseRegistryTokens([clone(GROUP_LIVE)])[0];
const lookupRegistered = () => ({ policyId: POLICY, registered: true, node: parseRegistryToken(clone(NODE_LIVE), POLICY) });
const lookupAbsent = () => ({ policyId: ABSENT, registered: false, node: null });

test('flag parser accepts exactly the two live answers and nothing looser', () => {
  assert.equal(parseRegisteredFlag({ registered: true }), true);
  assert.equal(parseRegisteredFlag({ registered: false }), false);
  assert.throws(() => parseRegisteredFlag(null), /Unexpected registration answer/);
  assert.throws(() => parseRegisteredFlag(true), /Unexpected registration answer/);
  assert.throws(() => parseRegisteredFlag([{ registered: true }]), /Unexpected registration answer/);
  assert.throws(() => parseRegisteredFlag({}), /registered flag/);
  assert.throws(() => parseRegisteredFlag({ registered: 'true' }), /registered flag/);
  assert.throws(() => parseRegisteredFlag({ registered: 1 }), /registered flag/);
});

test('token parser accepts the live node, canonicalises case, and keeps the tokens-parser field order', () => {
  const node = parseRegistryToken(clone(NODE_LIVE), POLICY);
  assert.deepEqual(node, NODE_LIVE);
  assert.deepEqual(Object.keys(node), ['key', 'next', 'mintingLogicScript', 'transferLogicScript', 'thirdPartyTransferLogicScript', 'unfrackingLogicScript', 'globalStatePolicyId']);
  const upper = clone(NODE_LIVE); upper.key = upper.key.toUpperCase(); upper.next = upper.next.toUpperCase();
  assert.deepEqual(parseRegistryToken(upper, POLICY.toUpperCase()), NODE_LIVE);
});

test('token parser refuses a node answering to a different policy than the one looked up', () => {
  assert.throws(() => parseRegistryToken(clone(NODE_LIVE), ABSENT), /different policy/);
  const swapped = clone(NODE_LIVE); swapped.key = GROUP_LIVE.registryNodes[1].key;
  assert.throws(() => parseRegistryToken(swapped, POLICY), /different policy/);
});

test('token parser refuses the origin shape and malformed nodes, and an unusable expected policy', () => {
  const origin = { key: '', next: POLICY, mintingLogicScript: '', transferLogicScript: '', thirdPartyTransferLogicScript: '', unfrackingLogicScript: '', globalStatePolicyId: '' };
  assert.throws(() => parseRegistryToken(origin, POLICY), /key/);
  const badNext = clone(NODE_LIVE); badNext.next = 'ff'.repeat(29) + 'fe';
  assert.throws(() => parseRegistryToken(badNext, POLICY), /next/);
  const badField = clone(NODE_LIVE); badField.unfrackingLogicScript = 'ab'.repeat(29);
  assert.throws(() => parseRegistryToken(badField, POLICY), /unfracking logic script/);
  assert.throws(() => parseRegistryToken(null, POLICY), /Invalid registry node record/);
  assert.throws(() => parseRegistryToken(clone(NODE_LIVE), 'abcd'), /56 hexadecimal/);
});

test('lookup check passes when the flag, the node, and the tokens list all agree', () => {
  const c = registryLookupCheck(lookupRegistered(), [group()]);
  assert.deepEqual(c, { policyId: POLICY, registered: true, hasNode: true, compared: true, presentInTokens: true, nodeAgrees: true, flagAgrees: true, ok: true });
  const absent = registryLookupCheck(lookupAbsent(), [group()]);
  assert.deepEqual([absent.presentInTokens, absent.nodeAgrees, absent.flagAgrees, absent.ok], [false, null, true, true]);
});

test('lookup check fails when the flag and the tokens list answer differently', () => {
  const listedButFlagSaysNo = registryLookupCheck({ policyId: POLICY, registered: false, node: null }, [group()]);
  assert.deepEqual([listedButFlagSaysNo.presentInTokens, listedButFlagSaysNo.flagAgrees, listedButFlagSaysNo.ok], [true, false, false]);
  const flagSaysYesButUnlisted = registryLookupCheck(lookupRegistered(), [parseRegistryTokens([{ protocolParams: GROUP_LIVE.protocolParams, registryNodes: [GROUP_LIVE.registryNodes[1]] }])[0]]);
  assert.deepEqual([flagSaysYesButUnlisted.presentInTokens, flagSaysYesButUnlisted.flagAgrees, flagSaysYesButUnlisted.ok], [false, false, false]);
});

test('lookup check fails on any field disagreement between the two reads of the node', () => {
  const other = group();
  other.registryNodes[0] = { ...other.registryNodes[0], transferLogicScript: 'aa'.repeat(28) };
  const c = registryLookupCheck(lookupRegistered(), [other]);
  assert.deepEqual([c.presentInTokens, c.nodeAgrees, c.flagAgrees, c.ok], [true, false, true, false]);
});

test('an uncompared tokens read is null, never a fabricated agreement', () => {
  const c = registryLookupCheck(lookupRegistered(), null);
  assert.deepEqual([c.compared, c.presentInTokens, c.nodeAgrees, c.flagAgrees, c.ok], [false, null, null, null, true]);
  const absent = registryLookupCheck(lookupAbsent(), null);
  assert.deepEqual([absent.compared, absent.flagAgrees, absent.ok], [false, null, true]);
});

test('a registered verdict with no node read is never ok', () => {
  const c = registryLookupCheck({ policyId: POLICY, registered: true, node: null }, [group()]);
  assert.equal(c.hasNode, false);
  assert.equal(c.ok, false);
});

function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => { seen.push(String(url)); return handler(String(url), options); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const okJson = v => ({ ok: true, json: async () => v });

test('getRegistryToken reads the flag first, then the node, for a registered policy', async () => {
  const stub = stubFetch(async url => url.includes('is-registered') ? okJson({ registered: true }) : okJson(clone(NODE_LIVE)));
  try {
    const res = await getRegistryToken('preview', POLICY.toUpperCase(), [group()]);
    assert.deepEqual(stub.seen, [`https://preview-indexer.programmabletokens.xyz/api/v1/registry/is-registered/${POLICY}`, `https://preview-indexer.programmabletokens.xyz/api/v1/registry/token/${POLICY}`]);
    assert.equal(res.registered, true);
    assert.deepEqual(res.node, NODE_LIVE);
    assert.equal(res.policyId, POLICY);
    assert.equal(res.check.ok, true);
    assert.ok(Number.isFinite(res.fetchedAt));
  } finally { stub.restore(); }
});

test('getRegistryToken makes no second fetch for an unregistered policy', async () => {
  const stub = stubFetch(async () => okJson({ registered: false }));
  try {
    const res = await getRegistryToken('preview', ABSENT, [group()]);
    assert.deepEqual(stub.seen, [`https://preview-indexer.programmabletokens.xyz/api/v1/registry/is-registered/${ABSENT}`]);
    assert.deepEqual([res.registered, res.node, res.check.ok], [false, null, true]);
  } finally { stub.restore(); }
});

test('getRegistryToken refuses an unusable policy or network before any fetch', async () => {
  const stub = stubFetch(async () => { throw new Error('must not fetch'); });
  try {
    await assert.rejects(() => getRegistryToken('preview', 'abcd'), /56 hexadecimal/);
    await assert.rejects(() => getRegistryToken('preview', ''), /56 hexadecimal/);
    await assert.rejects(() => getRegistryToken('devnet', POLICY), /Unknown network/);
  } finally { stub.restore(); }
});

test('getRegistryToken surfaces an indexer failure instead of a verdict', async () => {
  const http = stubFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  try { await assert.rejects(() => getRegistryToken('preview', POLICY), /HTTP 503/); }
  finally { http.restore(); }
  const lying = stubFetch(async url => url.includes('is-registered') ? okJson({ registered: true }) : okJson({ ...clone(NODE_LIVE), key: GROUP_LIVE.registryNodes[1].key }));
  try { await assert.rejects(() => getRegistryToken('preview', POLICY), /different policy/); }
  finally { lying.restore(); }
});

test('app wires the lookup: input, action, verdict lines, honest unavailable state, v1\.236', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /id="registry-lookup-policy"/);
  assert.match(app, /data-action="registry-lookup"/);
  assert.match(app, /getRegistryToken\(state\.network/);
  assert.match(app, /Lookup check passed/);
  assert.match(app, /Lookup check FAILED/);
  assert.match(app, /Registry lookup unavailable\.<\/strong>/);
  assert.match(app, /is not registered in this indexer/);
  assert.match(app, /WORKSPACE <span>v1\.236<\/span>/);
});
