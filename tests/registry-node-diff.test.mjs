import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegistryNodeDatum, parseRegistryNodeDatum, diffRegistryNodeDatum, REGISTRY_NODE_COMPARE_FIELDS, REGISTRY_SENTINEL_NEXT, REGISTRY_ORIGIN_NODE } from '../src/domain.js';

// Registry node datum comparison — the comparison counterpart to the
// datum reader. Reading a handed datum back says whether it is a
// genuine built datum; comparing says how the node it carries differs
// from the node entered as current. The handed side is judged by the
// parser itself and the current side by the builder itself, so
// compare, parse, build, and check can never disagree. Seven fields
// in spec order, each credential one field; the builder's derived
// summaries (kind, unfracking mode, global state) are verified by
// the parse/build, never counted as differences of their own.
const KEY = '33'.repeat(28), NEXT = '55'.repeat(28);
const MINT = 'aa'.repeat(28), TRANSFER = 'bb'.repeat(28), THIRD = 'cc'.repeat(28), HOOK = 'dd'.repeat(28), GLOBAL = 'ee'.repeat(28);
const script = hash => ({ kind: 'script', hash });
const pubkey = hash => ({ kind: 'pubkey', hash });
const tokenNode = (over = {}) => ({
  key: KEY, next: NEXT,
  minting: script(MINT), transfer: script(TRANSFER), thirdParty: script(THIRD),
  unfracking: pubkey(''), globalStateCs: '', ...over,
});
const handed = (input = tokenNode()) => JSON.stringify(buildRegistryNodeDatum(input).serialized, null, 2);

test('a handed datum identical to the current node compares as identical on all seven fields', () => {
  const r = diffRegistryNodeDatum(handed(), tokenNode());
  assert.equal(r.same, true);
  assert.deepEqual(r.differences, []);
  assert.equal(r.compared, REGISTRY_NODE_COMPARE_FIELDS.length);
  assert.equal(r.compared, 7);
});

test('comparison returns exactly its five keys, and each difference exactly four', () => {
  const r = diffRegistryNodeDatum(handed(tokenNode({ next: REGISTRY_SENTINEL_NEXT })), tokenNode());
  assert.deepEqual(Object.keys(r).sort(), ['compared', 'currentDatum', 'differences', 'fileDatum', 'same']);
  assert.equal(r.differences.length, 1);
  for (const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(), ['current', 'field', 'file', 'label']);
});

test('both sides are the canonical builder returns the parser and builder themselves produce', () => {
  const raw = handed(tokenNode({ unfracking: script(HOOK), globalStateCs: GLOBAL }));
  const current = tokenNode();
  const r = diffRegistryNodeDatum(raw, current);
  assert.deepEqual(r.fileDatum, parseRegistryNodeDatum(raw));
  assert.deepEqual(r.currentDatum, buildRegistryNodeDatum(current));
});

test('a key difference alone is one difference, named key, with both exact values', () => {
  const r = diffRegistryNodeDatum(handed(tokenNode({ key: '11'.repeat(28) })), tokenNode());
  assert.equal(r.same, false);
  assert.deepEqual(r.differences, [{ field: 'key', label: 'Key', file: '11'.repeat(28), current: KEY }]);
});

test('a successor difference alone is one difference — the sentinel against a successor key', () => {
  const r = diffRegistryNodeDatum(handed(tokenNode({ next: REGISTRY_SENTINEL_NEXT })), tokenNode());
  assert.deepEqual(r.differences, [{ field: 'next', label: 'Next', file: REGISTRY_SENTINEL_NEXT, current: NEXT }]);
});

test('a credential hash change is ONE difference on that credential, carrying both kind + hash pairs', () => {
  const r = diffRegistryNodeDatum(handed(tokenNode({ transfer: script(HOOK) })), tokenNode());
  assert.equal(r.differences.length, 1);
  assert.deepEqual(r.differences[0], {
    field: 'transfer_logic_script', label: 'Transfer logic',
    file: { kind: 'script', hash: HOOK }, current: { kind: 'script', hash: TRANSFER },
  });
});

test('a credential kind change with the same hash is one difference on that credential alone', () => {
  const r = diffRegistryNodeDatum(handed(tokenNode({ minting: pubkey(MINT) })), tokenNode());
  assert.deepEqual(r.differences.map(d => d.field), ['minting_logic_script']);
  assert.deepEqual(r.differences[0].file, { kind: 'pubkey', hash: MINT });
  assert.deepEqual(r.differences[0].current, { kind: 'script', hash: MINT });
});

test('derived summaries are not double-counted: an unfracking-mode and global-state change is two differences, not four', () => {
  // The handed node's unfracking goes from forbidden to script-delegated
  // and it gains a global state — the mode and state summaries move
  // WITH their fields, so the fields alone carry the change.
  const r = diffRegistryNodeDatum(handed(tokenNode({ unfracking: script(HOOK), globalStateCs: GLOBAL })), tokenNode());
  assert.deepEqual(r.differences.map(d => d.field), ['unfracking_logic_script', 'global_state_cs']);
  assert.ok(!r.differences.some(d => ['kind', 'unfrackingMode', 'globalState'].includes(d.field)));
});

test('differences are reported in the spec field order, not edit order', () => {
  const file = tokenNode({ globalStateCs: GLOBAL, key: '11'.repeat(28), transfer: script(HOOK) });
  const r = diffRegistryNodeDatum(handed(file), tokenNode());
  assert.deepEqual(r.differences.map(d => d.field), ['key', 'transfer_logic_script', 'global_state_cs']);
  const order = REGISTRY_NODE_COMPARE_FIELDS.map(([f]) => f);
  const idx = r.differences.map(d => order.indexOf(d.field));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
});

test('the origin node compares identical to itself, and a token node differs from it across the node shape', () => {
  const originText = JSON.stringify(buildRegistryNodeDatum(REGISTRY_ORIGIN_NODE).serialized, null, 2);
  const same = diffRegistryNodeDatum(originText, REGISTRY_ORIGIN_NODE);
  assert.equal(same.same, true);
  const r = diffRegistryNodeDatum(handed(), REGISTRY_ORIGIN_NODE);
  assert.equal(r.same, false);
  // Key, next, and the three script credentials differ; the unfracking
  // credential (empty public-key) and the empty global state are shared.
  assert.deepEqual(r.differences.map(d => d.field), ['key', 'next', 'minting_logic_script', 'transfer_logic_script', 'third_party_logic_script']);
});

test('hex case and whitespace in the handed JSON are canonicalised by the parser, so they compare as identical', () => {
  const obj = buildRegistryNodeDatum(tokenNode()).serialized;
  obj.key = '  ' + KEY.toUpperCase() + ' ';
  obj.minting_logic_script = script(MINT.toUpperCase());
  const r = diffRegistryNodeDatum(JSON.stringify(obj), tokenNode());
  assert.equal(r.same, true);
  assert.deepEqual(r.differences, []);
});

test('a handed datum that cannot be read back is refused whole with the parser reason, never partially compared', () => {
  const smuggled = buildRegistryNodeDatum(tokenNode()).serialized; smuggled.cbor = '84a0';
  assert.throws(() => diffRegistryNodeDatum(JSON.stringify(smuggled), tokenNode()), /unknown field "cbor"/);
  const obj = buildRegistryNodeDatum(tokenNode()).serialized;
  const reordered = { next: obj.next, key: obj.key, minting_logic_script: obj.minting_logic_script, transfer_logic_script: obj.transfer_logic_script, third_party_logic_script: obj.third_party_logic_script, unfracking_logic_script: obj.unfracking_logic_script, global_state_cs: obj.global_state_cs };
  assert.throws(() => diffRegistryNodeDatum(JSON.stringify(reordered), tokenNode()), /out of order/);
  const broken = buildRegistryNodeDatum(tokenNode()).serialized; broken.next = broken.key;
  assert.throws(() => diffRegistryNodeDatum(JSON.stringify(broken), tokenNode()), /chain order — next does not sort strictly after key/);
  assert.throws(() => diffRegistryNodeDatum('not json', tokenNode()), /not valid JSON/);
});

test('a current node that does not build is refused as the current side, with the builder words preserved', () => {
  assert.throws(() => diffRegistryNodeDatum(handed(), tokenNode({ key: '33'.repeat(27) })), /cannot be compared yet[\s\S]*key — 27 bytes — a policy ID is 28 bytes/);
  assert.throws(() => diffRegistryNodeDatum(handed(), tokenNode({ next: KEY })), /cannot be compared yet[\s\S]*chain order/);
  assert.throws(() => diffRegistryNodeDatum(handed(), null), /no current node datum/);
  assert.throws(() => diffRegistryNodeDatum(handed(), 'datum'), /no current node datum/);
});

test('comparison is pure: inputs are not mutated and repeated calls agree', () => {
  const current = tokenNode({ transfer: script(HOOK) });
  const snapshot = JSON.stringify(current);
  const raw = handed();
  const a = diffRegistryNodeDatum(raw, current);
  const b = diffRegistryNodeDatum(raw, current);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(current), snapshot);
});

test('app wires the datum comparison into the registry node panel, labeled honestly', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffRegistryNodeDatum/);
  assert.match(app, /registryNodeDiffPreview/);
  assert.match(app, /registry-node-diff-result/);
  assert.match(app, /IDENTICAL TO THE NODE ABOVE/);
  assert.match(app, /NOT COMPARED/);
  assert.match(app, /Comparing is not registering/);
  assert.match(app, /v1\.108/);
});
