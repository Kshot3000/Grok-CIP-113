import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRegistryInsertBinding, diffRegistryInsertBinding, REGISTRY_INSERT_BINDING_COMPARE_FIELDS } from '../src/domain.js';

// RegistryInsert binding impact: the temporal half of the binding
// checker — a registration that bound when modeled can be staled
// by a corrected issuance template, a rotated minting logic
// credential, or a rebuilt transaction dropping the withdraw-zero.
// Both versions are checked through checkRegistryInsertBinding
// itself, and five positions are compared: the status, the
// expected policy (the requirement itself — the derived policy the
// key must equal), and the three verdicts. Fixtures are the
// reference's own registry test fixtures, as in the checker suite:
// template 0102/0304, credential ee… deriving POLICY, credential
// ff… deriving POLICY2.
const PREFIX = '0102', POSTFIX = '0304';
const PARAM = 'ee'.repeat(28);
const OTHER = 'ff'.repeat(28);
const POLICY = '69bfdc13cf505bf70947baaf61b3ed99932179444f76b9f570ba74be';
const POLICY2 = '3c6ef45771041c4e5da1c7548507eb28d2fb3c84c6c49e8c45aef2fa';
const KEY_CRED = { kind: 'pubkey', hash: '99'.repeat(28) };

const boundClaim = () => ({
  key: POLICY,
  mintingLogic: { kind: 'script', hash: PARAM },
  datumMintingLogic: { kind: 'script', hash: PARAM },
  withdrawals: [{ ...KEY_CRED }, { kind: 'script', hash: PARAM }],
  issuancePrefix: PREFIX,
  issuancePostfix: POSTFIX,
});

const rotatedClaim = () => ({
  key: POLICY2,
  mintingLogic: { kind: 'script', hash: OTHER },
  datumMintingLogic: { kind: 'script', hash: OTHER },
  withdrawals: [{ ...KEY_CRED }, { kind: 'script', hash: OTHER }],
  issuancePrefix: PREFIX,
  issuancePostfix: POSTFIX,
});

test('an unchanged registration compares as unchanged on all five positions', () => {
  const d = diffRegistryInsertBinding(boundClaim(), boundClaim());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 5);
  assert.equal(d.keyChanged, false);
  assert.equal(d.mintingLogicChanged, false);
  assert.equal(d.datumMintingLogicChanged, false);
  assert.equal(d.templatePrefixChanged, false);
  assert.equal(d.templatePostfixChanged, false);
  assert.deepEqual(d.withdrawalsAdded, []);
  assert.deepEqual(d.withdrawalsRemoved, []);
  assert.equal(d.withdrawalCountBefore, 2);
  assert.equal(d.withdrawalCountAfter, 2);
  assert.deepEqual([...REGISTRY_INSERT_BINDING_COMPARE_FIELDS].map(f => f[0]), ['status', 'expectedPolicyId', 'datumMatchesRedeemer', 'policyBinding', 'mintingLogicInvoked']);
  assert.deepEqual([...REGISTRY_INSERT_BINDING_COMPARE_FIELDS].map(f => f[1]), ['Status', 'Expected policy', 'Datum equals redeemer', 'Policy binding', 'Minting logic invoked']);
});

test('rotating the minting logic with the key, datum, and withdrawals following is REQUIREMENT CHANGED on the expected-policy position alone', () => {
  const d = diffRegistryInsertBinding(boundClaim(), rotatedClaim());
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Expected policy']);
  assert.equal(d.differences[0].before, POLICY);
  assert.equal(d.differences[0].after, POLICY2);
  assert.equal(d.keyChanged, true);
  assert.equal(d.mintingLogicChanged, true);
  assert.equal(d.datumMintingLogicChanged, true);
  assert.deepEqual(d.withdrawalsAdded, [`script:${OTHER}`]);
  assert.deepEqual(d.withdrawalsRemoved, [`script:${PARAM}`]);
});

test('rotating the minting logic WITHOUT the datum following is BECAME NOT CONFORMING — conformance takes precedence over the requirement’s move', () => {
  const after = rotatedClaim();
  after.datumMintingLogic = { kind: 'script', hash: PARAM };
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Expected policy', 'Datum equals redeemer']);
  assert.equal(d.after.verdicts.datumMatchesRedeemer, false);
  assert.equal(d.after.verdicts.policyBinding, true);
});

test('a corrected template re-deriving a different policy for the same credential is BECAME NOT CONFORMING on the binding position', () => {
  const after = boundClaim();
  after.issuancePostfix = '0305';
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Expected policy'));
  assert.ok(d.changedFields.includes('Policy binding'));
  assert.equal(d.templatePostfixChanged, true);
  assert.equal(d.templatePrefixChanged, false);
  assert.equal(d.after.verdicts.datumMatchesRedeemer, true);
});

test('dropping the minting logic withdrawal is BECAME NOT CONFORMING on the invocation position', () => {
  const after = boundClaim();
  after.withdrawals = [{ ...KEY_CRED }];
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Minting logic invoked']);
  assert.deepEqual(d.withdrawalsRemoved, [`script:${PARAM}`]);
  assert.equal(d.withdrawalCountAfter, 1);
});

test('restoring the dropped withdrawal is BECAME CONFORMING', () => {
  const before = boundClaim();
  before.withdrawals = [{ ...KEY_CRED }];
  const d = diffRegistryInsertBinding(before, boundClaim());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Minting logic invoked']);
  assert.deepEqual(d.withdrawalsAdded, [`script:${PARAM}`]);
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, true);
});

test('a registration not bound on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = boundClaim();
  before.datumMintingLogic = { kind: 'script', hash: OTHER };
  const after = boundClaim();
  after.withdrawals = [{ ...KEY_CRED }];
  const d = diffRegistryInsertBinding(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.ok(d.changedFields.includes('Datum equals redeemer'));
  assert.ok(d.changedFields.includes('Minting logic invoked'));
});

test('a public-key redeemer credential derives no policy on either side: null compares equal with null, and a datum-only break is STILL NOT CONFORMING', () => {
  const pubkeyClaim = () => ({
    key: POLICY,
    mintingLogic: { kind: 'pubkey', hash: PARAM },
    datumMintingLogic: { kind: 'pubkey', hash: PARAM },
    withdrawals: [{ kind: 'pubkey', hash: PARAM }],
    issuancePrefix: PREFIX,
    issuancePostfix: POSTFIX,
  });
  const same = diffRegistryInsertBinding(pubkeyClaim(), pubkeyClaim());
  assert.equal(same.change, 'unchanged');
  assert.equal(same.before.expectedPolicyId, null);
  assert.equal(same.after.expectedPolicyId, null);
  const after = pubkeyClaim();
  after.datumMintingLogic = { kind: 'pubkey', hash: OTHER };
  const d = diffRegistryInsertBinding(pubkeyClaim(), after);
  assert.equal(d.change, 'still-not-conforming');
  assert.deepEqual(d.changedFields, ['Datum equals redeemer']);
});

test('moving from a script to a public-key redeemer credential is BECAME NOT CONFORMING, the expected policy moving to null alongside the binding verdict', () => {
  const after = boundClaim();
  after.mintingLogic = { kind: 'pubkey', hash: PARAM };
  after.datumMintingLogic = { kind: 'pubkey', hash: PARAM };
  after.withdrawals = [{ kind: 'pubkey', hash: PARAM }];
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Expected policy', 'Policy binding']);
  assert.equal(d.differences.find(x => x.field === 'expectedPolicyId').after, null);
  assert.equal(d.after.verdicts.mintingLogicInvoked, true);
});

test('a stranger withdrawal joining moves no position and compares unchanged, reported only (pinned)', () => {
  const after = boundClaim();
  after.withdrawals = [...after.withdrawals, { kind: 'script', hash: '77'.repeat(28) }];
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.withdrawalsAdded, [`script:${'77'.repeat(28)}`]);
  assert.equal(d.withdrawalCountAfter, 3);
});

test('a key change alone is the binding verdict’s move, reported as keyChanged and never counted separately (pinned)', () => {
  const after = boundClaim();
  after.key = POLICY2;
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Policy binding']);
  assert.equal(d.keyChanged, true);
  assert.equal(d.mintingLogicChanged, false);
});

test('hex case alone is the same registration: uppercase key, credentials, withdrawals, and template compare as unchanged', () => {
  const after = boundClaim();
  after.key = POLICY.toUpperCase();
  after.mintingLogic = { kind: 'script', hash: PARAM.toUpperCase() };
  after.datumMintingLogic = { kind: 'script', hash: PARAM.toUpperCase() };
  after.withdrawals = [{ kind: 'pubkey', hash: '99'.repeat(28) }, { kind: 'script', hash: PARAM.toUpperCase() }];
  const d = diffRegistryInsertBinding(boundClaim(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.equal(d.keyChanged, false);
  assert.equal(d.templatePrefixChanged, false);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  assert.throws(() => diffRegistryInsertBinding({ ...boundClaim(), extra: 1 }, boundClaim()), /unknown field/);
  assert.throws(() => diffRegistryInsertBinding(boundClaim(), { ...boundClaim(), extra: 1 }), /unknown field/);
  assert.throws(() => diffRegistryInsertBinding({ ...boundClaim(), key: 'abcd' }, boundClaim()), /28-byte policy ID/);
  const dup = boundClaim();
  dup.withdrawals = [{ kind: 'script', hash: PARAM }, { kind: 'script', hash: PARAM }];
  assert.throws(() => diffRegistryInsertBinding(boundClaim(), dup), /twice/);
  assert.throws(() => diffRegistryInsertBinding(boundClaim(), { ...boundClaim(), issuancePostfix: '030' }), /even number of hexadecimal/);
});

test('the comparison does not mutate either claim', () => {
  const before = boundClaim();
  const after = rotatedClaim();
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  diffRegistryInsertBinding(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
});

test('the comparison’s two sides are the checker’s own verdicts', () => {
  const before = boundClaim();
  const after = rotatedClaim();
  const d = diffRegistryInsertBinding(before, after);
  assert.deepEqual(d.before, checkRegistryInsertBinding(JSON.parse(JSON.stringify(before))));
  assert.deepEqual(d.after, checkRegistryInsertBinding(JSON.parse(JSON.stringify(after))));
});

test('app wires the registry insert binding impact comparison: panel, verdicts, honest boundary, v1.123', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffRegistryInsertBinding/);
  assert.match(app, /registry-binding-diff-after-key/);
  assert.match(app, /registry-binding-diff-after-withdrawals/);
  assert.match(app, /registry-binding-diff-result/);
  assert.match(app, /REGISTRY INSERT BINDING IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.123/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Registry insertion binding impact/);
});
