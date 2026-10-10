import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistryInsertOutputs } from '../src/domain.js';

// The RegistryInsert outputs: the transaction side of registration the
// list/datum/binding checkers state they do not judge — what the
// registering transaction mints and what its two registry-node outputs
// carry and where they sit (spec: Programmable token registration,
// points 5–7; reference: lib/linked_list.ak
// validate_registry_node_output / validate_mint, registry.ak
// RegistryInsert, re-read 2026-10-10).
const REGISTRY = 'aa'.repeat(28);
const KEY = '69bfdc13cf505bf70947baaf61b3ed99932179444f76b9f570ba74be';
const PREV = '33'.repeat(28);
const OTHER_POLICY = 'bb'.repeat(28);

const nodeOutput = (nodeKey, patch = {}) => ({
  paymentHash: REGISTRY,
  stakeCredential: false,
  referenceScript: false,
  assets: [{ policy: REGISTRY, name: nodeKey, quantity: '1' }],
  ...patch,
});

const conformingClaim = () => ({
  key: KEY,
  prevKey: PREV,
  registryPolicy: REGISTRY,
  minted: [{ name: KEY, quantity: '1' }],
  prevOutput: nodeOutput(PREV),
  newOutput: nodeOutput(KEY),
});

test('a conforming registration claim passes all nine positions', () => {
  const v = checkRegistryInsertOutputs(conformingClaim());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, {
    mintedNft: true, prevNft: true, newNft: true,
    prevExtraValue: true, newExtraValue: true,
    prevNoReferenceScript: true, newNoReferenceScript: true,
    prevAddress: true, newAddress: true,
  });
  assert.equal(v.key, KEY);
  assert.equal(v.prevKey, PREV);
  assert.equal(v.registryPolicy, REGISTRY);
  assert.equal(v.minted[0].quantity, '1');
});

test('registration against the origin node conforms — its NFT name is the empty bytestring', () => {
  const claim = conformingClaim();
  claim.prevKey = '';
  claim.prevOutput = nodeOutput('');
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.valid, true);
  assert.equal(v.prevKey, '');
  assert.equal(v.verdicts.prevNft, true);
});

test('a mint naming the wrong asset fails only the minted-NFT position', () => {
  const claim = conformingClaim();
  claim.minted = [{ name: PREV, quantity: '1' }];
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
  assert.equal(v.verdicts.mintedNft, false);
  assert.equal(v.verdicts.newNft, true);
  assert.equal(v.verdicts.prevNft, true);
});

test('a mint of two registry assets, or one at quantity 2, fails only the minted-NFT position', () => {
  const two = conformingClaim();
  two.minted = [{ name: KEY, quantity: '1' }, { name: PREV, quantity: '1' }];
  assert.equal(checkRegistryInsertOutputs(two).verdicts.mintedNft, false);
  const qty = conformingClaim();
  qty.minted = [{ name: KEY, quantity: '2' }];
  const v = checkRegistryInsertOutputs(qty);
  assert.equal(v.verdicts.mintedNft, false);
  assert.equal(v.verdicts.newNft, true);
  const none = conformingClaim();
  none.minted = [];
  assert.equal(checkRegistryInsertOutputs(none).verdicts.mintedNft, false);
});

test('a new node output missing its NFT fails only the new-NFT position', () => {
  const claim = conformingClaim();
  claim.newOutput = nodeOutput(KEY, { assets: [] });
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.newNft, false);
  assert.equal(v.verdicts.mintedNft, true);
  assert.equal(v.verdicts.prevNft, true);
  // Holding the NFT at quantity 2 is not holding the NFT.
  const qty = conformingClaim();
  qty.newOutput = nodeOutput(KEY, { assets: [{ policy: REGISTRY, name: KEY, quantity: '2' }] });
  assert.equal(checkRegistryInsertOutputs(qty).verdicts.newNft, false);
});

test('the two outputs holding each other’s NFTs fails both NFT positions and no other', () => {
  const claim = conformingClaim();
  claim.prevOutput = nodeOutput(KEY);
  claim.newOutput = nodeOutput(PREV);
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.prevNft, false);
  assert.equal(v.verdicts.newNft, false);
  assert.equal(v.verdicts.mintedNft, true);
  assert.equal(v.verdicts.prevExtraValue, true);
  assert.equal(v.verdicts.newExtraValue, true);
});

test('an extra asset under another policy fails only that output’s extra-value position', () => {
  const claim = conformingClaim();
  claim.newOutput = nodeOutput(KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: OTHER_POLICY, name: 'abcd', quantity: '500' },
    ],
  });
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.newExtraValue, false);
  assert.equal(v.verdicts.newNft, true);
  assert.equal(v.verdicts.prevExtraValue, true);
});

test('a reference script on either output fails only that output’s position', () => {
  const prev = conformingClaim();
  prev.prevOutput = nodeOutput(PREV, { referenceScript: true });
  const vp = checkRegistryInsertOutputs(prev);
  assert.equal(vp.verdicts.prevNoReferenceScript, false);
  assert.equal(vp.verdicts.newNoReferenceScript, true);
  const next = conformingClaim();
  next.newOutput = nodeOutput(KEY, { referenceScript: true });
  const vn = checkRegistryInsertOutputs(next);
  assert.equal(vn.verdicts.newNoReferenceScript, false);
  assert.equal(vn.verdicts.prevNoReferenceScript, true);
});

test('a stake credential on an output fails only its address position', () => {
  const claim = conformingClaim();
  claim.newOutput = nodeOutput(KEY, { stakeCredential: true });
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.newAddress, false);
  assert.equal(v.verdicts.prevAddress, true);
});

test('an output paid to a credential other than the registry script fails only its address position', () => {
  const claim = conformingClaim();
  claim.prevOutput = nodeOutput(PREV, { paymentHash: OTHER_POLICY });
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.prevAddress, false);
  assert.equal(v.verdicts.newAddress, true);
  assert.equal(v.verdicts.prevNft, true);
});

test('hex case alone compares as unchanged — policies and names canonicalise', () => {
  const claim = conformingClaim();
  claim.registryPolicy = REGISTRY.toUpperCase();
  claim.minted = [{ name: KEY.toUpperCase(), quantity: '1' }];
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.valid, true);
  assert.equal(v.registryPolicy, REGISTRY);
});

test('quantities beyond the int64 ceiling are refused; exact large extra values still judge', () => {
  const claim = conformingClaim();
  claim.newOutput = nodeOutput(KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: OTHER_POLICY, name: '', quantity: '9223372036854775807' },
    ],
  });
  const v = checkRegistryInsertOutputs(claim);
  assert.equal(v.verdicts.newExtraValue, false);
  const over = conformingClaim();
  over.minted = [{ name: KEY, quantity: '9223372036854775808' }];
  assert.throws(() => checkRegistryInsertOutputs(over), /int64 asset ceiling/);
});

test('a claim that cannot be read is refused, never scored in part', () => {
  assert.throws(() => checkRegistryInsertOutputs(null), /must be an object/);
  assert.throws(() => checkRegistryInsertOutputs({ ...conformingClaim(), extra: 1 }), /unknown field/);
  const missing = conformingClaim();
  delete missing.newOutput;
  assert.throws(() => checkRegistryInsertOutputs(missing), /missing its "newOutput"/);
  assert.throws(() => checkRegistryInsertOutputs({ ...conformingClaim(), key: 'abcd' }), /28 bytes|policy/);
  assert.throws(() => checkRegistryInsertOutputs({ ...conformingClaim(), prevKey: 'zz'.repeat(28) }), /hexadecimal/);
  // A JavaScript number cannot name every quantity — refused, not rounded.
  const numeric = conformingClaim();
  numeric.minted = [{ name: KEY, quantity: 1 }];
  assert.throws(() => checkRegistryInsertOutputs(numeric), /decimal string/);
  const zero = conformingClaim();
  zero.minted = [{ name: KEY, quantity: '0' }];
  assert.throws(() => checkRegistryInsertOutputs(zero), /must be positive/);
  // A value holds each asset once.
  const dup = conformingClaim();
  dup.newOutput = nodeOutput(KEY, {
    assets: [
      { policy: REGISTRY, name: KEY, quantity: '1' },
      { policy: REGISTRY, name: KEY, quantity: '1' },
    ],
  });
  assert.throws(() => checkRegistryInsertOutputs(dup), /twice/);
  const dupMint = conformingClaim();
  dupMint.minted = [{ name: KEY, quantity: '1' }, { name: KEY, quantity: '1' }];
  assert.throws(() => checkRegistryInsertOutputs(dupMint), /twice/);
  // Flags must be booleans — the rules turn on exactly those facts.
  const flag = conformingClaim();
  flag.prevOutput = nodeOutput(PREV, { stakeCredential: 'no' });
  assert.throws(() => checkRegistryInsertOutputs(flag), /as a boolean/);
  const longName = conformingClaim();
  longName.minted = [{ name: 'ab'.repeat(33), quantity: '1' }];
  assert.throws(() => checkRegistryInsertOutputs(longName), /at most 32 bytes/);
});

test('the checker does not mutate the claim it reads', () => {
  const claim = conformingClaim();
  const snapshot = JSON.stringify(claim);
  checkRegistryInsertOutputs(claim);
  assert.equal(JSON.stringify(claim), snapshot);
});
