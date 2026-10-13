import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRegistryInsertOutputs, diffRegistryInsertOutputs, REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS } from '../src/domain.js';

// RegistryInsert outputs impact: the temporal half of the outputs
// checker, completing the temporal half of every PRISM checker
// family — a registration whose outputs conformed when modeled
// can be staled by a registry policy re-pointed, a covering node
// replaced, or assembly rebuilding an output. Both versions are
// checked through checkRegistryInsertOutputs itself, and eleven
// positions are compared: the status, the expected node NFTs (the
// requirement itself — the registry policy and the two NFT names
// the mint and outputs must answer to), and the nine verdicts.
const REGISTRY = 'aa'.repeat(28);
const REGISTRY2 = 'bb'.repeat(28);
const KEY = '69bfdc13cf505bf70947baaf61b3ed99932179444f76b9f570ba74be';
const PREV = '33'.repeat(28);
const PREV2 = '44'.repeat(28);
const OTHER_POLICY = 'cc'.repeat(28);

const nodeOutput = (policy, nodeKey, patch = {}) => ({
  paymentHash: policy,
  stakeCredential: false,
  referenceScript: false,
  assets: [{ policy, name: nodeKey, quantity: '1' }],
  ...patch,
});

const conformingClaim = () => ({
  key: KEY,
  prevKey: PREV,
  registryPolicy: REGISTRY,
  minted: [{ name: KEY, quantity: '1' }],
  prevOutput: nodeOutput(REGISTRY, PREV),
  newOutput: nodeOutput(REGISTRY, KEY),
});

const redeployedClaim = () => ({
  key: KEY,
  prevKey: PREV,
  registryPolicy: REGISTRY2,
  minted: [{ name: KEY, quantity: '1' }],
  prevOutput: nodeOutput(REGISTRY2, PREV),
  newOutput: nodeOutput(REGISTRY2, KEY),
});

test('an unchanged registration compares as unchanged on all eleven positions', () => {
  const d = diffRegistryInsertOutputs(conformingClaim(), conformingClaim());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 11);
  assert.equal(d.registryPolicyChanged, false);
  assert.equal(d.keyChanged, false);
  assert.equal(d.prevKeyChanged, false);
  assert.deepEqual(d.mintedAdded, []);
  assert.deepEqual(d.mintedRemoved, []);
  assert.deepEqual(d.prevAssetsAdded, []);
  assert.deepEqual(d.newAssetsAdded, []);
  assert.equal(d.prevPaymentChanged, false);
  assert.equal(d.newStakeChanged, false);
  assert.equal(d.mintedCountBefore, 1);
  assert.equal(d.prevAssetCountBefore, 1);
  assert.deepEqual([...REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS].map(f => f[0]), ['status', 'expectedNfts', 'mintedNft', 'prevNft', 'newNft', 'prevExtraValue', 'newExtraValue', 'prevNoReferenceScript', 'newNoReferenceScript', 'prevAddress', 'newAddress']);
  assert.deepEqual([...REGISTRY_INSERT_OUTPUTS_COMPARE_FIELDS].map(f => f[1]), ['Status', 'Expected node NFTs', 'Minted registry NFT', 'Covering node NFT', 'New node NFT', 'Covering node value', 'New node value', 'Covering node reference script', 'New node reference script', 'Covering node address', 'New node address']);
});

test('a registry policy re-pointed with the payments and asset policies following is REQUIREMENT CHANGED on the expected-NFTs position alone', () => {
  const d = diffRegistryInsertOutputs(conformingClaim(), redeployedClaim());
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Expected node NFTs']);
  assert.deepEqual(d.differences[0].before, { registryPolicy: REGISTRY, key: KEY, prevKey: PREV });
  assert.deepEqual(d.differences[0].after, { registryPolicy: REGISTRY2, key: KEY, prevKey: PREV });
  assert.equal(d.registryPolicyChanged, true);
  assert.equal(d.keyChanged, false);
  assert.equal(d.prevPaymentChanged, true);
  assert.equal(d.newPaymentChanged, true);
  assert.deepEqual(d.prevAssetsAdded, [`${REGISTRY2}:${PREV}:1`]);
  assert.deepEqual(d.prevAssetsRemoved, [`${REGISTRY}:${PREV}:1`]);
  assert.deepEqual(d.newAssetsAdded, [`${REGISTRY2}:${KEY}:1`]);
  assert.deepEqual(d.mintedAdded, []);
});

test('a covering node replaced with the returned output’s NFT following is REQUIREMENT CHANGED on the expected-NFTs position alone', () => {
  const after = conformingClaim();
  after.prevKey = PREV2;
  after.prevOutput = nodeOutput(REGISTRY, PREV2);
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.deepEqual(d.changedFields, ['Expected node NFTs']);
  assert.equal(d.prevKeyChanged, true);
  assert.deepEqual(d.prevAssetsAdded, [`${REGISTRY}:${PREV2}:1`]);
  assert.deepEqual(d.prevAssetsRemoved, [`${REGISTRY}:${PREV}:1`]);
});

test('a registry policy re-pointed WITHOUT the outputs following is BECAME NOT CONFORMING — conformance takes precedence over the requirement’s move', () => {
  const after = conformingClaim();
  after.registryPolicy = REGISTRY2;
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Expected node NFTs'));
  assert.ok(d.changedFields.includes('Covering node NFT'));
  assert.ok(d.changedFields.includes('New node NFT'));
  assert.ok(d.changedFields.includes('Covering node address'));
  assert.equal(d.after.verdicts.mintedNft, true);
});

test('an extra asset parked in the new node output is BECAME NOT CONFORMING on its value position alone beyond the status', () => {
  const after = conformingClaim();
  after.newOutput = nodeOutput(REGISTRY, KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: OTHER_POLICY, name: 'abcd', quantity: '500' },
    ],
  });
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'New node value']);
  assert.deepEqual(d.newAssetsAdded, [`${OTHER_POLICY}:abcd:500`]);
  assert.equal(d.newAssetCountAfter, 2);
  assert.equal(d.after.verdicts.newNft, true);
});

test('a reference script attached to the covering output is BECAME NOT CONFORMING on its reference-script position', () => {
  const after = conformingClaim();
  after.prevOutput = nodeOutput(REGISTRY, PREV, { referenceScript: true });
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Covering node reference script']);
  assert.equal(d.prevReferenceScriptChanged, true);
  assert.equal(d.newReferenceScriptChanged, false);
});

test('removing the parked asset again is BECAME CONFORMING', () => {
  const before = conformingClaim();
  before.newOutput = nodeOutput(REGISTRY, KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: OTHER_POLICY, name: 'abcd', quantity: '500' },
    ],
  });
  const d = diffRegistryInsertOutputs(before, conformingClaim());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'New node value']);
  assert.deepEqual(d.newAssetsRemoved, [`${OTHER_POLICY}:abcd:500`]);
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, true);
});

test('a registration not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conformingClaim();
  before.prevOutput = nodeOutput(REGISTRY, PREV, { stakeCredential: true });
  const after = conformingClaim();
  after.newOutput = nodeOutput(REGISTRY, KEY, { referenceScript: true });
  const d = diffRegistryInsertOutputs(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.ok(d.changedFields.includes('Covering node address'));
  assert.ok(d.changedFields.includes('New node reference script'));
  assert.equal(d.prevStakeChanged, true);
  assert.equal(d.newReferenceScriptChanged, true);
});

test('a mint at quantity 2 fails only the minted-NFT position and is reported as a mint change', () => {
  const after = conformingClaim();
  after.minted = [{ name: KEY, quantity: '2' }];
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Minted registry NFT']);
  assert.deepEqual(d.mintedAdded, [`${KEY}:2`]);
  assert.deepEqual(d.mintedRemoved, [`${KEY}:1`]);
});

test('registration against the origin node compares like any other: its expected NFT name is the empty bytestring', () => {
  const originClaim = () => {
    const c = conformingClaim();
    c.prevKey = '';
    c.prevOutput = nodeOutput(REGISTRY, '');
    return c;
  };
  const d = diffRegistryInsertOutputs(originClaim(), originClaim());
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences[0] ?? null, null);
  const moved = diffRegistryInsertOutputs(originClaim(), conformingClaim());
  assert.equal(moved.change, 'requirement-changed');
  assert.deepEqual(moved.differences[0].before, { registryPolicy: REGISTRY, key: KEY, prevKey: '' });
  assert.equal(moved.prevKeyChanged, true);
});

test('a payment hash change alone is the address verdict’s move, reported and never counted separately (pinned)', () => {
  const after = conformingClaim();
  after.newOutput = nodeOutput(REGISTRY, KEY, { paymentHash: OTHER_POLICY });
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'New node address']);
  assert.equal(d.newPaymentChanged, true);
  assert.equal(d.newStakeChanged, false);
});

test('hex case alone is the same registration: uppercase policies and names compare as unchanged', () => {
  const after = conformingClaim();
  after.registryPolicy = REGISTRY.toUpperCase();
  after.prevOutput = nodeOutput(REGISTRY.toUpperCase(), PREV);
  after.newOutput = nodeOutput(REGISTRY.toUpperCase(), KEY.toUpperCase());
  after.minted = [{ name: KEY.toUpperCase(), quantity: '1' }];
  const d = diffRegistryInsertOutputs(conformingClaim(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.equal(d.registryPolicyChanged, false);
  assert.deepEqual(d.newAssetsAdded, []);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  assert.throws(() => diffRegistryInsertOutputs({ ...conformingClaim(), extra: 1 }, conformingClaim()), /unknown field/);
  assert.throws(() => diffRegistryInsertOutputs(conformingClaim(), { ...conformingClaim(), extra: 1 }), /unknown field/);
  const numeric = conformingClaim();
  numeric.minted = [{ name: KEY, quantity: 1 }];
  assert.throws(() => diffRegistryInsertOutputs(conformingClaim(), numeric), /decimal string/);
  const dup = conformingClaim();
  dup.newOutput = nodeOutput(REGISTRY, KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: REGISTRY, name: KEY, quantity: '1' },
    ],
  });
  assert.throws(() => diffRegistryInsertOutputs(dup, conformingClaim()), /twice/);
  const flag = conformingClaim();
  flag.prevOutput = nodeOutput(REGISTRY, PREV, { stakeCredential: 'no' });
  assert.throws(() => diffRegistryInsertOutputs(conformingClaim(), flag), /as a boolean/);
});

test('the comparison does not mutate either claim', () => {
  const before = conformingClaim();
  const after = redeployedClaim();
  const bSnap = JSON.stringify(before);
  const aSnap = JSON.stringify(after);
  diffRegistryInsertOutputs(before, after);
  assert.equal(JSON.stringify(before), bSnap);
  assert.equal(JSON.stringify(after), aSnap);
});

test('the comparison’s two sides are the checker’s own verdicts', () => {
  const before = conformingClaim();
  const after = redeployedClaim();
  const d = diffRegistryInsertOutputs(before, after);
  assert.deepEqual(d.before, checkRegistryInsertOutputs(JSON.parse(JSON.stringify(before))));
  assert.deepEqual(d.after, checkRegistryInsertOutputs(JSON.parse(JSON.stringify(after))));
});

test('app wires the registry insert outputs impact comparison: panel, verdicts, honest boundary, v1.141', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffRegistryInsertOutputs/);
  assert.match(app, /registry-outputs-diff-after-policy/);
  assert.match(app, /registry-outputs-diff-after-new-assets/);
  assert.match(app, /registry-outputs-diff-result/);
  assert.match(app, /REGISTRY INSERT OUTPUTS IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.141/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Registry insertion outputs impact/);
});
