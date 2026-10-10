import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegistryNodeDatum, parseRegistryNodeDatum, REGISTRY_NODE_FIELD_ORDER, REGISTRY_SENTINEL_NEXT, REGISTRY_ORIGIN_NODE } from '../src/domain.js';

// Registry node datum reading-back — the parser for the builder's
// serialized form. The built datum was a one-way artifact: PRISM wrote
// it in the spec's field names and order, but could not read its own
// output back, so an edited handed copy could only be trusted. The
// parser reads ONLY the serialized form (spec names, spec order,
// credentials as kind-then-hash), refuses anything PRISM never writes,
// and judges the converted datum by calling the builder itself — so
// parse, build, and check can never disagree, and parse(build(x)) is
// build(x) exactly.
const KEY = '33'.repeat(28), NEXT = '55'.repeat(28);
const MINT = 'aa'.repeat(28), TRANSFER = 'bb'.repeat(28), THIRD = 'cc'.repeat(28), HOOK = 'dd'.repeat(28);
const script = hash => ({ kind: 'script', hash });
const pubkey = hash => ({ kind: 'pubkey', hash });
const tokenNode = (over = {}) => ({
  key: KEY, next: NEXT,
  minting: script(MINT), transfer: script(TRANSFER), thirdParty: script(THIRD),
  unfracking: pubkey(''), globalStateCs: '', ...over,
});
const builtText = (input = tokenNode()) => JSON.stringify(buildRegistryNodeDatum(input).serialized, null, 2);
const builtObj = (input = tokenNode()) => buildRegistryNodeDatum(input).serialized;

test('a built datum reads back exactly: parse(build(x)) is build(x), key for key', () => {
  for (const input of [tokenNode(), tokenNode({ unfracking: script(HOOK), globalStateCs: 'ee'.repeat(28) }), tokenNode({ next: REGISTRY_SENTINEL_NEXT }), REGISTRY_ORIGIN_NODE]) {
    assert.deepEqual(parseRegistryNodeDatum(builtText(input)), buildRegistryNodeDatum(input));
  }
});

test('the read-back return carries exactly the builder keys — no encoding, no NFT, nothing else', () => {
  const r = parseRegistryNodeDatum(builtText());
  assert.deepEqual(Object.keys(r), ['datum', 'serialized', 'fieldOrder', 'kind', 'unfrackingMode', 'globalState']);
  assert.deepEqual([...r.fieldOrder], [...REGISTRY_NODE_FIELD_ORDER]);
  assert.equal(r.kind, 'token');
  assert.equal(r.unfrackingMode, 'forbidden');
  assert.equal(r.globalState, 'none');
});

test('the origin node reads back as the canonical origin node', () => {
  const r = parseRegistryNodeDatum(builtText(REGISTRY_ORIGIN_NODE));
  assert.equal(r.kind, 'origin');
  assert.deepEqual(r.datum, JSON.parse(JSON.stringify(REGISTRY_ORIGIN_NODE)));
  assert.equal(r.serialized.next, 'ff'.repeat(30));
});

test('uppercase and whitespace-padded values in the JSON read back canonicalised, as the builder writes them', () => {
  const obj = builtObj();
  obj.key = '  ' + KEY.toUpperCase() + ' ';
  obj.minting_logic_script = script(MINT.toUpperCase());
  const r = parseRegistryNodeDatum(JSON.stringify(obj));
  assert.deepEqual(r, buildRegistryNodeDatum(tokenNode()));
});

test('fields out of the spec order are refused naming the expected order, never silently re-sorted', () => {
  const obj = builtObj();
  const reordered = { next: obj.next, key: obj.key, minting_logic_script: obj.minting_logic_script, transfer_logic_script: obj.transfer_logic_script, third_party_logic_script: obj.third_party_logic_script, unfracking_logic_script: obj.unfracking_logic_script, global_state_cs: obj.global_state_cs };
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(reordered)), /out of order[\s\S]*key, next, minting_logic_script/);
});

test('a field PRISM never writes is refused — a smuggled cbor, datum hash, or NFT claim is the edit this parser exists for', () => {
  for (const extra of ['cbor', 'datumHash', 'registryNft', 'policyId']) {
    const obj = builtObj(); obj[extra] = '84a0';
    assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), new RegExp(`unknown field "${extra}"`));
  }
  const cred = builtObj(); cred.minting_logic_script = { kind: 'script', hash: MINT, address: 'addr1' };
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(cred)), /minting_logic_script carries an unknown field "address"/);
});

test('a missing field is refused, and the checker internal shape is not the serialized form', () => {
  const obj = builtObj(); delete obj.transfer_logic_script;
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), /missing its "transfer_logic_script" field/);
  // The internal input shape (minting / thirdParty / globalStateCs) renames
  // three fields — as a serialization it is missing and unknown at once.
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(tokenNode())), /unknown field "minting"/);
});

test('a credential naming its fields out of order, or not an object, is refused', () => {
  const obj = builtObj(); obj.transfer_logic_script = { hash: TRANSFER, kind: 'script' };
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), /transfer_logic_script names its fields out of order/);
  const obj2 = builtObj(); obj2.transfer_logic_script = 'script:' + TRANSFER;
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj2)), /transfer_logic_script must be a credential/);
});

test('a readable datum breaking a field rule is refused in the checker words, never read back in part', () => {
  const obj = builtObj(); obj.key = '33'.repeat(27);
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), /not built[\s\S]*key — 27 bytes — a policy ID is 28 bytes/);
  const obj2 = builtObj(); obj2.global_state_cs = 'ee'.repeat(10);
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj2)), /global_state_cs — 10 bytes/);
});

test('a successor that does not sort strictly after the key is refused on chain order alone', () => {
  const obj = builtObj(); obj.next = KEY;
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), /chain order — next does not sort strictly after key/);
});

test('an empty key in a non-origin shape is refused — it is a broken token node, not an origin node', () => {
  const obj = builtObj(); obj.key = '';
  assert.throws(() => parseRegistryNodeDatum(JSON.stringify(obj)), /key — empty — only the canonical origin node/);
});

test('text that is not a JSON object is refused, never repaired or guessed at', () => {
  assert.throws(() => parseRegistryNodeDatum('{key: ' + KEY + '}'), /not valid JSON/);
  assert.throws(() => parseRegistryNodeDatum('[1,2,3]'), /must be a JSON object/);
  assert.throws(() => parseRegistryNodeDatum('"datum"'), /must be a JSON object/);
  assert.throws(() => parseRegistryNodeDatum(null), /JSON text under 100 KB/);
  assert.throws(() => parseRegistryNodeDatum(builtObj()), /JSON text under 100 KB/);
});

test('an unfracking credential and a global state read back with their modes intact', () => {
  const gated = parseRegistryNodeDatum(builtText(tokenNode({ unfracking: pubkey(HOOK) })));
  assert.equal(gated.unfrackingMode, 'signature-gated');
  const delegated = parseRegistryNodeDatum(builtText(tokenNode({ unfracking: script(HOOK), globalStateCs: 'ee'.repeat(28) })));
  assert.equal(delegated.unfrackingMode, 'script-delegated');
  assert.equal(delegated.globalState, 'present');
});

test('app wires the datum reader into the registry node panel, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /parseRegistryNodeDatum/);
  assert.match(app, /registry-node-parse-input/);
  assert.match(app, /registry-node-parsed/);
  assert.match(app, /READ BACK/);
  assert.match(app, /NOT READ BACK/);
  assert.match(app, /Reading back is not registering/);
  assert.match(app, /v1.101/);
});
