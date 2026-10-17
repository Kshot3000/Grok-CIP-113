import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferAuthorization, diffTransferAuthorization, TRANSFER_AUTHORIZATION_COMPARE_FIELDS } from '../src/domain.js';

// TransferAct authorization impact (spec: delegate validation
// steps 1 and 3 and the TransferAct constructor, re-read
// 2026-10-11): a transfer that conformed when modeled can be
// staled by a change that never touches its logic — a signer
// added or dropped, a withdrawal dropped, assembly spending a
// UTxO of a new stake credential, a registry update re-pointing
// a token's transfer_logic_script, or a registration proof
// flipping. Both versions are checked through
// checkTransferAuthorization itself, and four positions are
// compared: the status, the required transfer credentials (the
// requirement itself), the holder authorization verdict, and
// the logic execution verdict.
const KEY_HOLDER = 'aa'.repeat(28);
const SCRIPT_HOLDER = 'bb'.repeat(28);
const POLICY = 'cc'.repeat(28);
const UNREGISTERED = 'dd'.repeat(28);
const TRANSFER_SCRIPT = 'ee'.repeat(28);
const NEW_SCRIPT = 'ff'.repeat(28);
const STRANGER = '99'.repeat(28);
const OTHER_POLICY = '77'.repeat(28);

const conforming = () => ({
  spentStakeCredentials: [
    { kind: 'pubkey', hash: KEY_HOLDER },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ],
  tokens: [
    { policy: POLICY, registered: true, transferCredential: { kind: 'script', hash: TRANSFER_SCRIPT } },
    { policy: UNREGISTERED, registered: false, transferCredential: null },
  ],
  withdrawals: [
    { kind: 'script', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ],
  signers: [KEY_HOLDER],
});

test('an unchanged transfer compares as unchanged on all four positions', () => {
  const d = diffTransferAuthorization(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 4);
  assert.deepEqual(d.spentCredentialsAdded, []);
  assert.deepEqual(d.spentCredentialsRemoved, []);
  assert.equal(d.spentCountBefore, 2);
  assert.equal(d.spentCountAfter, 2);
  assert.deepEqual(d.withdrawalsAdded, []);
  assert.deepEqual(d.withdrawalsRemoved, []);
  assert.deepEqual(d.signersAdded, []);
  assert.deepEqual(d.signersRemoved, []);
  assert.deepEqual(d.tokensAdded, []);
  assert.deepEqual(d.tokensRemoved, []);
  assert.deepEqual(d.registeredPoliciesAdded, []);
  assert.deepEqual(d.registeredPoliciesRemoved, []);
  assert.equal(d.registeredCountBefore, 1);
  assert.equal(d.registeredCountAfter, 1);
  assert.deepEqual([...TRANSFER_AUTHORIZATION_COMPARE_FIELDS].map(f => f[0]), ['status', 'requiredTransferCredentials', 'holderAuthorization', 'logicExecution']);
  assert.deepEqual([...TRANSFER_AUTHORIZATION_COMPARE_FIELDS].map(f => f[1]), ['Status', 'Required transfer credentials', 'Holder authorization', 'Logic execution']);
});

test('dropping the signer makes the transfer BECAME NOT CONFORMING on the status and holder authorization positions', () => {
  const after = conforming();
  after.signers = [];
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Holder authorization']);
  assert.deepEqual(d.signersRemoved, [KEY_HOLDER]);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('dropping the transfer logic withdrawal makes the transfer BECAME NOT CONFORMING on the status and logic execution positions', () => {
  const after = conforming();
  after.withdrawals = [{ kind: 'script', hash: SCRIPT_HOLDER }];
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Logic execution']);
  assert.deepEqual(d.withdrawalsRemoved, [`script:${TRANSFER_SCRIPT}`]);
  assert.equal(d.after.verdicts.holderAuthorization, true);
  assert.equal(d.after.verdicts.logicExecution, false);
});

test('restoring the dropped signer makes the transfer BECAME CONFORMING', () => {
  const before = conforming();
  before.signers = [];
  const d = diffTransferAuthorization(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Holder authorization']);
  assert.deepEqual(d.signersAdded, [KEY_HOLDER]);
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, true);
});

test('re-pointing a registered token to a new script the withdrawals follow is REQUIREMENT CHANGED on the required-credentials position alone', () => {
  const after = conforming();
  after.tokens[0].transferCredential = { kind: 'script', hash: NEW_SCRIPT };
  after.withdrawals = [
    { kind: 'script', hash: NEW_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ];
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Required transfer credentials']);
  assert.deepEqual(d.differences[0].before, [{ policy: POLICY, kind: 'script', hash: TRANSFER_SCRIPT }]);
  assert.deepEqual(d.differences[0].after, [{ policy: POLICY, kind: 'script', hash: NEW_SCRIPT }]);
  assert.deepEqual(d.withdrawalsAdded, [`script:${NEW_SCRIPT}`]);
  assert.deepEqual(d.withdrawalsRemoved, [`script:${TRANSFER_SCRIPT}`]);
});

test('a token becoming registered and executed is REQUIREMENT CHANGED, the logic verdict moving null to true alongside the requirement', () => {
  const before = conforming();
  before.tokens = [{ policy: UNREGISTERED, registered: false, transferCredential: null }];
  const after = conforming();
  after.tokens = [{ policy: UNREGISTERED, registered: true, transferCredential: { kind: 'script', hash: TRANSFER_SCRIPT } }];
  const d = diffTransferAuthorization(before, after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Required transfer credentials', 'Logic execution']);
  assert.equal(d.before.verdicts.logicExecution, null);
  assert.equal(d.after.verdicts.logicExecution, true);
  assert.deepEqual(d.registeredPoliciesAdded, [UNREGISTERED]);
  assert.deepEqual(d.tokensAdded, []);
  assert.equal(d.registeredCountBefore, 0);
  assert.equal(d.registeredCountAfter, 1);
});

test('re-pointing a registered token WITHOUT the withdrawals following is BECAME NOT CONFORMING — the conformance story takes precedence over the requirement’s move', () => {
  const after = conforming();
  after.tokens[0].transferCredential = { kind: 'script', hash: NEW_SCRIPT };
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Required transfer credentials', 'Logic execution']);
  assert.equal(d.after.verdicts.logicExecution, false);
});

test('a transfer not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.signers = [];
  const after = conforming();
  after.withdrawals = [{ kind: 'script', hash: SCRIPT_HOLDER }];
  const d = diffTransferAuthorization(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.ok(d.changedFields.includes('Holder authorization'));
  assert.ok(d.changedFields.includes('Logic execution'));
  assert.equal(d.before.verdicts.holderAuthorization, false);
  assert.equal(d.before.verdicts.logicExecution, true);
  assert.equal(d.after.verdicts.holderAuthorization, true);
  assert.equal(d.after.verdicts.logicExecution, false);
});

test('verdictless logic on both sides compares equal: with no registered token on either side, only a reported change compares unchanged (pinned)', () => {
  const before = conforming();
  before.tokens = [{ policy: UNREGISTERED, registered: false, transferCredential: null }];
  before.spentStakeCredentials = [{ kind: 'pubkey', hash: KEY_HOLDER }];
  const after = conforming();
  after.tokens = [{ policy: UNREGISTERED, registered: false, transferCredential: null }];
  after.spentStakeCredentials = [
    { kind: 'pubkey', hash: KEY_HOLDER },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ];
  const d = diffTransferAuthorization(before, after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.equal(d.before.verdicts.logicExecution, null);
  assert.equal(d.after.verdicts.logicExecution, null);
  assert.deepEqual(d.spentCredentialsAdded, [`script:${SCRIPT_HOLDER}`]);
  assert.equal(d.spentCountBefore, 1);
  assert.equal(d.spentCountAfter, 2);
});

test('changing an unregistered token’s entered credential moves no position and no reported set: it is not in the required list (pinned)', () => {
  const before = conforming();
  before.tokens[1].transferCredential = { kind: 'script', hash: NEW_SCRIPT };
  const after = conforming();
  after.tokens[1].transferCredential = { kind: 'script', hash: STRANGER };
  const d = diffTransferAuthorization(before, after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.tokensAdded, []);
  assert.deepEqual(d.tokensRemoved, []);
  assert.deepEqual(d.registeredPoliciesAdded, []);
  assert.deepEqual(d.registeredPoliciesRemoved, []);
});

test('spent, withdrawal, signer, and token changes are reported as added/removed sets with their counts, never counted beyond their verdicts', () => {
  const after = conforming();
  after.spentStakeCredentials = [
    { kind: 'pubkey', hash: KEY_HOLDER },
    { kind: 'script', hash: SCRIPT_HOLDER },
    { kind: 'pubkey', hash: STRANGER },
  ];
  after.withdrawals = [
    { kind: 'script', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
    { kind: 'script', hash: STRANGER },
  ];
  after.signers = [KEY_HOLDER, STRANGER];
  after.tokens = [
    ...conforming().tokens,
    { policy: OTHER_POLICY, registered: false, transferCredential: null },
  ];
  const d = diffTransferAuthorization(conforming(), after);
  assert.deepEqual(d.spentCredentialsAdded, [`pubkey:${STRANGER}`]);
  assert.deepEqual(d.spentCredentialsRemoved, []);
  assert.equal(d.spentCountBefore, 2);
  assert.equal(d.spentCountAfter, 3);
  assert.deepEqual(d.withdrawalsAdded, [`script:${STRANGER}`]);
  assert.deepEqual(d.signersAdded, [STRANGER]);
  assert.deepEqual(d.tokensAdded, [OTHER_POLICY]);
  assert.deepEqual(d.registeredPoliciesAdded, []);
  const back = diffTransferAuthorization(after, conforming());
  assert.deepEqual(back.spentCredentialsRemoved, [`pubkey:${STRANGER}`]);
  assert.deepEqual(back.withdrawalsRemoved, [`script:${STRANGER}`]);
  assert.deepEqual(back.signersRemoved, [STRANGER]);
  assert.deepEqual(back.tokensRemoved, [OTHER_POLICY]);
});

test('a registration flag flip is reported as a registered-policy change, not a token change', () => {
  const before = conforming();
  const after = conforming();
  after.tokens[1] = { policy: UNREGISTERED, registered: true, transferCredential: { kind: 'script', hash: NEW_SCRIPT } };
  after.withdrawals = [
    { kind: 'script', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
    { kind: 'script', hash: NEW_SCRIPT },
  ];
  const d = diffTransferAuthorization(before, after);
  assert.equal(d.change, 'requirement-changed');
  assert.deepEqual(d.tokensAdded, []);
  assert.deepEqual(d.tokensRemoved, []);
  assert.deepEqual(d.registeredPoliciesAdded, [UNREGISTERED]);
  assert.equal(d.registeredCountBefore, 1);
  assert.equal(d.registeredCountAfter, 2);
  // the required list is sorted by policy
  assert.deepEqual(d.after.tokens.filter(t => t.registered).map(t => t.policy), [POLICY, UNREGISTERED]);
  assert.deepEqual(d.differences.find(x => x.field === 'requiredTransferCredentials').after, [
    { policy: POLICY, kind: 'script', hash: TRANSFER_SCRIPT },
    { policy: UNREGISTERED, kind: 'script', hash: NEW_SCRIPT },
  ]);
});

test('a token becoming unregistered is REQUIREMENT CHANGED, the logic verdict moving true to null alongside the requirement', () => {
  const after = conforming();
  after.tokens[0] = { policy: POLICY, registered: false, transferCredential: null };
  after.withdrawals = [{ kind: 'script', hash: SCRIPT_HOLDER }];
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.ok(d.changedFields.includes('Required transfer credentials'));
  assert.ok(d.changedFields.includes('Logic execution'));
  assert.equal(d.before.verdicts.logicExecution, true);
  assert.equal(d.after.verdicts.logicExecution, null);
  assert.deepEqual(d.registeredPoliciesRemoved, [POLICY]);
  assert.equal(d.registeredCountAfter, 0);
});

test('hex case alone is the same transfer: uppercase credentials, withdrawals, and signers compare as unchanged', () => {
  const after = conforming();
  after.spentStakeCredentials = [
    { kind: 'pubkey', hash: KEY_HOLDER.toUpperCase() },
    { kind: 'script', hash: SCRIPT_HOLDER.toUpperCase() },
  ];
  after.tokens[0].transferCredential = { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() };
  after.withdrawals = [
    { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() },
    { kind: 'script', hash: SCRIPT_HOLDER.toUpperCase() },
  ];
  after.signers = [KEY_HOLDER.toUpperCase()];
  const d = diffTransferAuthorization(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.spentCredentialsAdded, []);
  assert.deepEqual(d.withdrawalsAdded, []);
  assert.deepEqual(d.signersAdded, []);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  assert.throws(() => diffTransferAuthorization({ ...conforming(), extra: 1 }, conforming()), /unknown field/);
  assert.throws(() => diffTransferAuthorization(conforming(), { ...conforming(), extra: 1 }), /unknown field/);
  const dupAfter = conforming();
  dupAfter.tokens.push({ policy: POLICY.toUpperCase(), registered: false, transferCredential: null });
  assert.throws(() => diffTransferAuthorization(conforming(), dupAfter), /more than once/);
  const emptyBefore = conforming();
  emptyBefore.spentStakeCredentials = [];
  assert.throws(() => diffTransferAuthorization(emptyBefore, conforming()), /non-empty list/);
  const emptyAfter = conforming();
  emptyAfter.spentStakeCredentials = [];
  assert.throws(() => diffTransferAuthorization(conforming(), emptyAfter), /non-empty list/);
});

test('the comparison does not mutate either claim', () => {
  const before = conforming();
  const after = conforming();
  after.signers = [];
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  diffTransferAuthorization(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
});

test('the comparison’s two sides are the checker’s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.tokens[0].transferCredential = { kind: 'script', hash: NEW_SCRIPT };
  const d = diffTransferAuthorization(before, after);
  assert.deepEqual(d.before, checkTransferAuthorization(JSON.parse(JSON.stringify(before))));
  assert.deepEqual(d.after, checkTransferAuthorization(JSON.parse(JSON.stringify(after))));
});

test('app wires the transfer authorization impact comparison: panel, verdicts, honest boundary, v1.236', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffTransferAuthorization/);
  assert.match(app, /transfer-auth-diff-after-tokens/);
  assert.match(app, /transfer-auth-diff-after-signers/);
  assert.match(app, /TRANSFER AUTHORIZATION IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.236/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Transfer authorization impact/);
});
