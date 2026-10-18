import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransactionConstruction, TRANSACTION_CONSTRUCTION_VERDICTS } from '../src/domain.js';

// CIP-113 transaction construction (spec: "Implementing programmable
// tokens in DeFi protocols — Transaction Construction", re-read
// 2026-10-11): six MUST steps, judged together on presence and
// placement. Steps 1 and 3 are the two the spec warns are easy to
// omit, because neither is visible in the token's own configuration.
const P1 = '11'.repeat(28);
const P2 = '22'.repeat(28);
const GLOBAL = { kind: 'script', hash: 'aa'.repeat(28) };
const DELEGATE = { kind: 'script', hash: '33'.repeat(28) };
const BASE = { kind: 'script', hash: 'cc'.repeat(28) };
const LOGIC = { kind: 'script', hash: 'ee'.repeat(28) };
const STAKE = { kind: 'script', hash: 'dd'.repeat(28) };

const conforming = () => ({
  action: 'transfer',
  base: { ...BASE },
  globalCredential: { ...GLOBAL },
  delegateCredential: { ...DELEGATE },
  tokens: [
    { policy: P1, registered: true, logicCredential: { ...LOGIC } },
    { policy: P2, registered: false, logicCredential: null },
  ],
  referenceInputs: ['registry-node-11', 'protocol-parameters', 'registry-node-cover'],
  paramsRef: 'protocol-parameters',
  registryRefPolicies: [P1, P2],
  withdrawals: [{ ...GLOBAL }, { ...DELEGATE }, { ...LOGIC }],
  outputs: [
    { payment: { ...BASE }, stake: { ...STAKE }, policies: [P1] },
    { payment: { kind: 'pubkey', hash: '99'.repeat(28) }, stake: null, policies: [] },
  ],
});

test('a conforming construction passes all six steps, in the spec\u2019s order', () => {
  const v = checkTransactionConstruction(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), TRANSACTION_CONSTRUCTION_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, {
    paramsRefIncluded: true,
    registryRefsComplete: true,
    globalInvoked: true,
    delegateInvoked: true,
    logicInvoked: true,
    outputsToSmartWallets: true,
  });
  assert.deepEqual(v.missingPolicies, []);
});

test('step 1: dropping the parameters UTxO from the reference inputs fails that step alone', () => {
  const claim = conforming();
  claim.referenceInputs = ['registry-node-11', 'registry-node-cover'];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.paramsRefIncluded, false);
  assert.equal(v.verdicts.registryRefsComplete, true);
  assert.equal(v.verdicts.globalInvoked, true);
});

test('step 2: an unproved touched policy fails completeness and is named; the unregistered policy needs its covering node too', () => {
  const claim = conforming();
  claim.registryRefPolicies = [P1];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.registryRefsComplete, false);
  assert.deepEqual(v.missingPolicies, [P2]);
});

test('step 2: an extra proved policy is reported, never scored — no prohibition is invented', () => {
  const claim = conforming();
  claim.registryRefPolicies = [P1, P2, '44'.repeat(28)];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, true);
  assert.deepEqual(v.extraProvedPolicies, ['44'.repeat(28)]);
});

test('step 3: omitting the global withdraw-zero fails that step alone — the omission the spec warns about', () => {
  const claim = conforming();
  claim.withdrawals = [{ ...DELEGATE }, { ...LOGIC }];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.globalInvoked, false);
  assert.equal(v.verdicts.delegateInvoked, true);
});

test('step 4: the delegate is judged against the credential entered for the declared action', () => {
  const claim = conforming();
  claim.action = 'third-party';
  claim.delegateCredential = { kind: 'script', hash: '44'.repeat(28) };
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.delegateInvoked, false);
  claim.withdrawals.push({ kind: 'script', hash: '44'.repeat(28) });
  assert.equal(checkTransactionConstruction(claim).valid, true);
});

test('step 5: a registered token whose logic is not invoked fails; the unregistered token names no logic and no requirement', () => {
  const claim = conforming();
  claim.withdrawals = [{ ...GLOBAL }, { ...DELEGATE }];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.logicInvoked, false);
  assert.deepEqual(v.logicResults.map(r => r.invoked), [false, null]);
});

test('step 5: with no registered token modeled the logic verdict is null, and the construction can still conform', () => {
  const claim = conforming();
  claim.tokens = [{ policy: P2, registered: false, logicCredential: null }];
  claim.registryRefPolicies = [P2];
  claim.outputs = [{ payment: { ...BASE }, stake: { ...STAKE }, policies: [P2] }];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.verdicts.logicInvoked, null);
  assert.equal(v.valid, true);
});

test('step 6: a carrying output at an ordinary address fails; the same value at the base payment credential with a stake credential passes', () => {
  const claim = conforming();
  claim.outputs = [{ payment: { kind: 'pubkey', hash: '99'.repeat(28) }, stake: { ...STAKE }, policies: [P1] }];
  let v = checkTransactionConstruction(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.outputsToSmartWallets, false);
  claim.outputs = [{ payment: { ...BASE }, stake: null, policies: [P1] }];
  v = checkTransactionConstruction(claim);
  assert.equal(v.verdicts.outputsToSmartWallets, false, 'the base payment credential without a stake credential is not a smart-wallet address');
  claim.outputs = [{ payment: { ...BASE }, stake: { ...STAKE }, policies: [P1] }];
  assert.equal(checkTransactionConstruction(claim).valid, true);
});

test('step 6: outputs carrying no touched policy carry NO verdict, and a construction with no carrying output has a null step-6 verdict', () => {
  const claim = conforming();
  claim.outputs = [{ payment: { kind: 'pubkey', hash: '99'.repeat(28) }, stake: null, policies: ['44'.repeat(28)] }];
  const v = checkTransactionConstruction(claim);
  assert.equal(v.verdicts.outputsToSmartWallets, null);
  assert.deepEqual(v.outputResults.map(r => r.toSmartWallet), [null]);
  assert.equal(v.valid, true);
});

test('a credential present with the wrong kind is not invoked: kind and hash must both match, for withdrawals and for the base payment', () => {
  const claim = conforming();
  claim.withdrawals = [{ kind: 'pubkey', hash: GLOBAL.hash }, { ...DELEGATE }, { ...LOGIC }];
  assert.equal(checkTransactionConstruction(claim).verdicts.globalInvoked, false);
  const claim2 = conforming();
  claim2.outputs = [{ payment: { kind: 'pubkey', hash: BASE.hash }, stake: { ...STAKE }, policies: [P1] }];
  assert.equal(checkTransactionConstruction(claim2).verdicts.outputsToSmartWallets, false);
});

test('hex case is canonicalised across policies, credentials, and outputs', () => {
  const claim = conforming();
  claim.tokens[0].policy = P1.toUpperCase();
  claim.registryRefPolicies = [P1.toUpperCase(), P2];
  claim.outputs[0].policies = [P1.toUpperCase()];
  claim.withdrawals = claim.withdrawals.map(w => ({ ...w, hash: w.hash.toUpperCase() }));
  const v = checkTransactionConstruction(claim);
  assert.equal(v.valid, true);
  assert.equal(v.tokens[0].policy, P1);
});

test('refusal discipline: unknown or missing fields and an unknown action are refused, never scored in part', () => {
  assert.throws(() => checkTransactionConstruction({ ...conforming(), proofs: [] }), /unknown field "proofs"/);
  const missing = conforming();
  delete missing.outputs;
  assert.throws(() => checkTransactionConstruction(missing), /missing its "outputs"/);
  assert.throws(() => checkTransactionConstruction({ ...conforming(), action: 'mint' }), /declared action must be transfer, third-party, or unfracking/);
  assert.throws(() => checkTransactionConstruction(null), /must be an object/);
});

test('refusal discipline: an empty token list, a duplicated token or proved policy, and a duplicated reference input or withdrawal are refused', () => {
  assert.throws(() => checkTransactionConstruction({ ...conforming(), tokens: [] }), /non-empty array/);
  const dupToken = conforming();
  dupToken.tokens.push({ policy: P1, registered: false, logicCredential: null });
  assert.throws(() => checkTransactionConstruction(dupToken), /listed more than once among the tokens/);
  assert.throws(() => checkTransactionConstruction({ ...conforming(), registryRefPolicies: [P1, P1] }), /proved more than once/);
  const dupRef = conforming();
  dupRef.referenceInputs.push('protocol-parameters');
  assert.throws(() => checkTransactionConstruction(dupRef), /more than once/);
  const dupWd = conforming();
  dupWd.withdrawals.push({ ...GLOBAL });
  assert.throws(() => checkTransactionConstruction(dupWd), /listed more than once/);
});

test('refusal discipline: a registered token naming no logic, an unregistered token naming one, and a policy listed twice in one output are refused', () => {
  const noLogic = conforming();
  noLogic.tokens[0].logicCredential = null;
  assert.throws(() => checkTransactionConstruction(noLogic), /registered but names no logic credential/);
  const hasLogic = conforming();
  hasLogic.tokens[1].logicCredential = { ...LOGIC };
  assert.throws(() => checkTransactionConstruction(hasLogic), /unregistered but names a logic credential/);
  const dupOut = conforming();
  dupOut.outputs[0].policies = [P1, P1];
  assert.throws(() => checkTransactionConstruction(dupOut), /lists policy .* more than once/);
  assert.throws(() => checkTransactionConstruction({ ...conforming(), tokens: [{ policy: '11'.repeat(10), registered: false, logicCredential: null }] }), /28-byte policy ID/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkTransactionConstruction(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the transaction construction checker: panel, six steps, honest boundary, v1.248', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkTransactionConstruction/);
  assert.match(app, /construction-withdrawals/);
  assert.match(app, /TRANSACTION CONSTRUCTION · LOCAL MODEL/);
  assert.match(app, /NO VERDICT/);
  assert.match(app, /read no transaction, no protocol parameters UTxO, and no chain state/);
  assert.match(app, /v1\.248/);
});
