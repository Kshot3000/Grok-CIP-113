import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistryNodeDatum, REGISTRY_NODE_FIELD_ORDER, REGISTRY_SENTINEL_NEXT, REGISTRY_ORIGIN_NODE } from '../src/domain.js';

// CIP-113 RegistryNode datum checking, per the spec's "RegistryNode datum"
// section and the Foundation reference implementation's registry_node
// module (cardano-foundation/cip113-programmable-tokens, lib/registry_node.ak),
// which pins the two values the spec prose leaves ambiguous: the origin
// node's key is the EMPTY bytestring, and the terminal `next` sentinel is
// THIRTY bytes of 0xff — deliberately not 28, so it sorts strictly after
// every 28-byte policy ID under Plutus bytestring comparison (byte by
// byte; the longer string is greater when the shared prefix is equal).
const KEY = '33'.repeat(28), NEXT = '55'.repeat(28);
const MINT = 'aa'.repeat(28), TRANSFER = 'bb'.repeat(28), THIRD = 'cc'.repeat(28), HOOK = 'dd'.repeat(28);
const script = hash => ({ kind: 'script', hash });
const pubkey = hash => ({ kind: 'pubkey', hash });
const tokenNode = (over = {}) => ({
  key: KEY, next: NEXT,
  minting: script(MINT), transfer: script(TRANSFER), thirdParty: script(THIRD),
  unfracking: pubkey(''), globalStateCs: '', ...over,
});

test('the field order is the spec order, and it is load-bearing', () => {
  assert.deepEqual([...REGISTRY_NODE_FIELD_ORDER], ['key', 'next', 'minting_logic_script', 'transfer_logic_script', 'third_party_logic_script', 'unfracking_logic_script', 'global_state_cs']);
  const r = checkRegistryNodeDatum(tokenNode());
  assert.deepEqual([...r.fieldOrder], [...REGISTRY_NODE_FIELD_ORDER]);
});

test('the canonical origin node from the reference implementation checks valid', () => {
  // lib/registry_node.ak: origin key #"" , next = sentinel, all four logic
  // fields the empty verification key, global_state_cs #"".
  assert.equal(REGISTRY_ORIGIN_NODE.key, '');
  assert.equal(REGISTRY_ORIGIN_NODE.next, 'ff'.repeat(30));
  const r = checkRegistryNodeDatum(REGISTRY_ORIGIN_NODE);
  assert.equal(r.valid, true);
  assert.equal(r.kind, 'origin');
  assert.equal(r.chainOrdered, true);
  assert.equal(r.unfrackingMode, 'forbidden');
  assert.equal(r.globalState, 'none');
  assert.ok(Object.values(r.fields).every(f => f.ok));
});

test('a well-formed token node checks valid, with least-permission unfracking read from the empty credential', () => {
  const r = checkRegistryNodeDatum(tokenNode());
  assert.equal(r.valid, true);
  assert.equal(r.kind, 'token');
  assert.equal(r.fields.key.detail, '28-byte policy ID');
  assert.equal(r.fields.next.detail, '28-byte successor key');
  assert.equal(r.unfrackingMode, 'forbidden');
  assert.equal(r.globalState, 'none');
});

test('the unfracking credential alone selects the mode: signature-gated or script-delegated', () => {
  assert.equal(checkRegistryNodeDatum(tokenNode({ unfracking: pubkey(HOOK) })).unfrackingMode, 'signature-gated');
  const delegated = checkRegistryNodeDatum(tokenNode({ unfracking: script(HOOK) }));
  assert.equal(delegated.unfrackingMode, 'script-delegated');
  assert.equal(delegated.valid, true);
});

test('a 28-byte global_state_cs is present, and any other non-empty length fails only that field', () => {
  const present = checkRegistryNodeDatum(tokenNode({ globalStateCs: 'ee'.repeat(28) }));
  assert.equal(present.valid, true);
  assert.equal(present.globalState, 'present');
  const bad = checkRegistryNodeDatum(tokenNode({ globalStateCs: 'ee'.repeat(10) }));
  assert.equal(bad.valid, false);
  assert.equal(bad.globalState, null);
  assert.equal(bad.fields.globalStateCs.ok, false);
  assert.equal(bad.fields.key.ok, true);
  assert.equal(bad.fields.minting.ok, true);
});

test('the terminal sentinel is a valid next, including after an all-0xff key', () => {
  assert.equal(REGISTRY_SENTINEL_NEXT.length, 60); // 30 bytes, not 28
  const last = checkRegistryNodeDatum(tokenNode({ next: REGISTRY_SENTINEL_NEXT }));
  assert.equal(last.valid, true);
  assert.match(last.fields.next.detail, /terminal sentinel/);
  // The load-bearing case from the reference: a hypothetical 28-byte
  // all-0xff policy must still sort BEFORE the sentinel — a 28-byte
  // sentinel of the same bytes would equal it and break the chain.
  const ffKey = checkRegistryNodeDatum(tokenNode({ key: 'ff'.repeat(28), next: REGISTRY_SENTINEL_NEXT }));
  assert.equal(ffKey.chainOrdered, true);
  assert.equal(ffKey.valid, true);
});

test('next must sort strictly after key: an equal or earlier next breaks the chain and nothing else', () => {
  const equal = checkRegistryNodeDatum(tokenNode({ next: KEY }));
  assert.equal(equal.fields.next.ok, true); // the field itself is a fine 28-byte key
  assert.equal(equal.chainOrdered, false);
  assert.equal(equal.valid, false);
  const earlier = checkRegistryNodeDatum(tokenNode({ next: '11'.repeat(28) }));
  assert.equal(earlier.chainOrdered, false);
  assert.equal(earlier.valid, false);
});

test('a key that is not 28 bytes fails only the key field', () => {
  for (const bad of ['33'.repeat(27), '33'.repeat(29)]) {
    const r = checkRegistryNodeDatum(tokenNode({ key: bad, next: REGISTRY_SENTINEL_NEXT }));
    assert.equal(r.valid, false);
    assert.equal(r.fields.key.ok, false);
    assert.equal(r.fields.next.ok, true);
    assert.equal(r.kind, null);
  }
});

test('an empty key outside the canonical origin shape is not an origin node', () => {
  const r = checkRegistryNodeDatum(tokenNode({ key: '' }));
  assert.equal(r.valid, false);
  assert.equal(r.kind, null);
  assert.equal(r.fields.key.ok, false);
  assert.match(r.fields.key.detail, /only the canonical origin node/);
  // The origin's credentials are part of the canonical shape too: real
  // logic credentials under an origin key and sentinel still fail.
  const r2 = checkRegistryNodeDatum({ ...tokenNode(), key: '', next: REGISTRY_SENTINEL_NEXT });
  assert.equal(r2.valid, false);
  assert.equal(r2.fields.key.ok, false);
});

test('empty logic credentials fail on a token node — except unfracking, where empty is the forbidden meaning', () => {
  for (const field of ['minting', 'transfer', 'thirdParty']) {
    const r = checkRegistryNodeDatum(tokenNode({ [field]: pubkey('') }));
    assert.equal(r.valid, false, field);
    assert.equal(r.fields[field].ok, false, field);
  }
  assert.equal(checkRegistryNodeDatum(tokenNode({ unfracking: pubkey('') })).fields.unfracking.ok, true);
  // An empty SCRIPT credential names no script in any position.
  const r = checkRegistryNodeDatum(tokenNode({ unfracking: script('') }));
  assert.equal(r.fields.unfracking.ok, false);
  assert.equal(r.unfrackingMode, null);
});

test('a credential hash that is not 28 bytes fails only that credential', () => {
  const r = checkRegistryNodeDatum(tokenNode({ transfer: script('bb'.repeat(20)) }));
  assert.equal(r.valid, false);
  assert.equal(r.fields.transfer.ok, false);
  assert.equal(r.fields.transfer.bytes, 20);
  assert.equal(r.fields.minting.ok, true);
  assert.equal(r.fields.thirdParty.ok, true);
});

test('public-key logic credentials of 28 bytes are valid in every logic position', () => {
  const r = checkRegistryNodeDatum(tokenNode({
    minting: pubkey(MINT), transfer: pubkey(TRANSFER), thirdParty: pubkey(THIRD), unfracking: pubkey(HOOK),
  }));
  assert.equal(r.valid, true);
  assert.equal(r.unfrackingMode, 'signature-gated');
});

test('uppercase hex checks and is stated in canonical lowercase', () => {
  const r = checkRegistryNodeDatum(tokenNode({ key: KEY.toUpperCase(), next: NEXT.toUpperCase(), minting: script(MINT.toUpperCase()) }));
  assert.equal(r.valid, true);
  assert.equal(r.key, KEY);
  assert.equal(r.fields.minting.hash, MINT);
});

test('a datum that cannot be read is refused, never scored in part', () => {
  assert.throws(() => checkRegistryNodeDatum(null), /must be an object/);
  assert.throws(() => checkRegistryNodeDatum('datum'), /must be an object/);
  const missing = tokenNode(); delete missing.next;
  assert.throws(() => checkRegistryNodeDatum(missing), /missing its "next" field/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ policy: KEY })), /unknown field "policy"/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ minting: { kind: 'script' } })), /both a kind/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ minting: { kind: 'token', hash: MINT } })), /kind must be pubkey or script/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ key: 'zz'.repeat(28) })), /even number of hexadecimal/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ key: '3'.repeat(55) })), /even number of hexadecimal/);
  assert.throws(() => checkRegistryNodeDatum(tokenNode({ globalStateCs: 28 })), /must be a hexadecimal string/);
});

test('checking does not mutate the datum', () => {
  const d = tokenNode();
  const snapshot = JSON.parse(JSON.stringify(d));
  checkRegistryNodeDatum(d);
  assert.deepEqual(d, snapshot);
});
