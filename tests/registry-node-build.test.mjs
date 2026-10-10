import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegistryNodeDatum, checkRegistryNodeDatum, REGISTRY_NODE_FIELD_ORDER, REGISTRY_SENTINEL_NEXT, REGISTRY_ORIGIN_NODE } from '../src/domain.js';

// Registry node datum building — the producing half of
// checkRegistryNodeDatum: the one artifact PRISM could judge but never
// produce. The builder judges its input with the checker itself
// (validate-once), so a datum the checker would fail is refused with
// the failing fields named, never built in part; a datum it builds is
// returned canonically in the checker's own shape AND serialized under
// the spec's field names in the spec's load-bearing order.
const KEY = '33'.repeat(28), NEXT = '55'.repeat(28);
const MINT = 'aa'.repeat(28), TRANSFER = 'bb'.repeat(28), THIRD = 'cc'.repeat(28), HOOK = 'dd'.repeat(28);
const script = hash => ({ kind: 'script', hash });
const pubkey = hash => ({ kind: 'pubkey', hash });
const tokenNode = (over = {}) => ({
  key: KEY, next: NEXT,
  minting: script(MINT), transfer: script(TRANSFER), thirdParty: script(THIRD),
  unfracking: pubkey(''), globalStateCs: '', ...over,
});

test('a well-formed token node builds, in the checker shape and in spec field names and order', () => {
  const b = buildRegistryNodeDatum(tokenNode());
  assert.deepEqual(b.datum, tokenNode());
  assert.deepEqual(Object.keys(b.datum), ['key', 'next', 'minting', 'transfer', 'thirdParty', 'unfracking', 'globalStateCs']);
  assert.deepEqual(Object.keys(b.serialized), [...REGISTRY_NODE_FIELD_ORDER]);
  assert.deepEqual(b.serialized, {
    key: KEY, next: NEXT,
    minting_logic_script: script(MINT), transfer_logic_script: script(TRANSFER),
    third_party_logic_script: script(THIRD), unfracking_logic_script: pubkey(''),
    global_state_cs: '',
  });
  assert.deepEqual(Object.keys(b.serialized.minting_logic_script), ['kind', 'hash']);
  assert.equal(b.kind, 'token');
  assert.equal(b.unfrackingMode, 'forbidden');
  assert.equal(b.globalState, 'none');
  assert.deepEqual([...b.fieldOrder], [...REGISTRY_NODE_FIELD_ORDER]);
});

test('the return carries exactly the datum, its serialization, and the checker summary — no encoding, no NFT, nothing else', () => {
  const b = buildRegistryNodeDatum(tokenNode());
  assert.deepEqual(Object.keys(b), ['datum', 'serialized', 'fieldOrder', 'kind', 'unfrackingMode', 'globalState']);
});

test('builder and checker can never disagree: every built datum re-checks valid, field for field', () => {
  for (const input of [tokenNode(), tokenNode({ unfracking: script(HOOK), globalStateCs: 'ee'.repeat(28) }), tokenNode({ next: REGISTRY_SENTINEL_NEXT }), REGISTRY_ORIGIN_NODE]) {
    const b = buildRegistryNodeDatum(input);
    const r = checkRegistryNodeDatum(b.datum);
    assert.equal(r.valid, true);
    assert.equal(r.kind, b.kind);
    assert.equal(r.unfrackingMode, b.unfrackingMode);
    assert.equal(r.globalState, b.globalState);
    assert.equal(b.serialized.key, r.fields.key.value);
    assert.equal(b.serialized.next, r.fields.next.value);
    assert.equal(b.serialized.minting_logic_script.hash, r.fields.minting.hash);
    assert.equal(b.serialized.global_state_cs, r.fields.globalStateCs.value);
  }
});

test('uppercase and whitespace-padded input builds to the same canonical datum', () => {
  const messy = tokenNode({
    key: '  ' + KEY.toUpperCase() + ' ', next: NEXT.toUpperCase(),
    minting: script(MINT.toUpperCase()), unfracking: pubkey('  '),
  });
  const b = buildRegistryNodeDatum(messy);
  assert.deepEqual(b.datum, tokenNode());
  assert.deepEqual(b.serialized, buildRegistryNodeDatum(tokenNode()).serialized);
});

test('the origin inputs build exactly the canonical origin node', () => {
  const b = buildRegistryNodeDatum({
    key: '', next: REGISTRY_SENTINEL_NEXT,
    minting: pubkey(''), transfer: pubkey(''), thirdParty: pubkey(''), unfracking: pubkey(''), globalStateCs: '',
  });
  assert.equal(b.kind, 'origin');
  assert.deepEqual(b.datum, {
    key: '', next: REGISTRY_SENTINEL_NEXT,
    minting: pubkey(''), transfer: pubkey(''), thirdParty: pubkey(''), unfracking: pubkey(''), globalStateCs: '',
  });
  assert.deepEqual(b.datum, JSON.parse(JSON.stringify(REGISTRY_ORIGIN_NODE)));
  assert.equal(b.serialized.key, '');
  assert.equal(b.serialized.next, 'ff'.repeat(30));
});

test('the terminal sentinel builds as next, including after an all-0xff key', () => {
  const last = buildRegistryNodeDatum(tokenNode({ next: REGISTRY_SENTINEL_NEXT }));
  assert.equal(last.serialized.next, REGISTRY_SENTINEL_NEXT);
  const ff = buildRegistryNodeDatum(tokenNode({ key: 'ff'.repeat(28), next: REGISTRY_SENTINEL_NEXT }));
  assert.equal(ff.kind, 'token');
});

test('the unfracking credential selects the built mode: signature-gated or script-delegated', () => {
  const gated = buildRegistryNodeDatum(tokenNode({ unfracking: pubkey(HOOK) }));
  assert.equal(gated.unfrackingMode, 'signature-gated');
  assert.deepEqual(gated.serialized.unfracking_logic_script, pubkey(HOOK));
  const delegated = buildRegistryNodeDatum(tokenNode({ unfracking: script(HOOK) }));
  assert.equal(delegated.unfrackingMode, 'script-delegated');
  assert.deepEqual(delegated.serialized.unfracking_logic_script, script(HOOK));
});

test('a 28-byte global_state_cs builds as present', () => {
  const b = buildRegistryNodeDatum(tokenNode({ globalStateCs: 'ee'.repeat(28) }));
  assert.equal(b.globalState, 'present');
  assert.equal(b.serialized.global_state_cs, 'ee'.repeat(28));
});

test('a key that is not 28 bytes is refused, naming the key field in the checker words', () => {
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ key: '33'.repeat(27) })), /not built[\s\S]*key — 27 bytes — a policy ID is 28 bytes/);
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ key: '33'.repeat(29) })), /key — 29 bytes/);
});

test('a next that does not sort strictly after the key is refused on chain order alone', () => {
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ next: KEY })), /chain order — next does not sort strictly after key/);
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ next: '11'.repeat(28) })), /chain order/);
  // The same datum's fields are individually fine — only the order fails.
  const r = checkRegistryNodeDatum(tokenNode({ next: KEY }));
  assert.equal(r.fields.key.ok, true);
  assert.equal(r.fields.next.ok, true);
  assert.equal(r.chainOrdered, false);
});

test('an empty script credential and a wrong-length global state are refused, each naming its field', () => {
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ minting: script('') })), /minting_logic_script — empty script credential/);
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ globalStateCs: 'ee'.repeat(10) })), /global_state_cs — 10 bytes/);
  // Several failing fields are all named in one refusal, never built in part.
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ minting: script(''), globalStateCs: 'ee'.repeat(10) })), /minting_logic_script[\s\S]*global_state_cs/);
});

test('an empty key in a non-origin shape is refused — it is a broken token node, not an origin node', () => {
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ key: '' })), /key — empty — only the canonical origin node/);
});

test('an unreadable datum is refused on the checker terms, never built', () => {
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ key: 'zz'.repeat(28) })), /even number of hexadecimal/);
  assert.throws(() => buildRegistryNodeDatum({ ...tokenNode(), cbor: '84a0' }), /unknown field "cbor"/);
  const missing = tokenNode(); delete missing.transfer;
  assert.throws(() => buildRegistryNodeDatum(missing), /missing its "transfer" field/);
  assert.throws(() => buildRegistryNodeDatum(tokenNode({ minting: { kind: 'native', hash: MINT } })), /kind must be pubkey or script/);
  assert.throws(() => buildRegistryNodeDatum(null), /must be an object/);
});

test('app wires the datum builder into the registry node panel, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /buildRegistryNodeDatum/);
  assert.match(app, /registry-node-built/);
  assert.match(app, /BUILT DATUM/);
  assert.match(app, /Building is not registering/);
  assert.match(app, /NOT BUILT/);
  assert.match(app, /v1.90/);
});
