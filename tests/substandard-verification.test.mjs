import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkSubstandardVerification, SUBSTANDARD_VERIFICATION_VERDICTS } from '../src/domain.js';

// CIP-113 substandard verification (spec: "Implementing programmable
// tokens in DeFi protocols — Security Considerations" #1, the Lending
// section's SHOULD, and "Existing substandards", re-read 2026-10-11):
// verify a substandard before integrating it by answering two
// independent questions about its thirdPartyLogicScript — (a) what it
// can authorise without the holder's consent, (b) who can trigger it.
// Neither answer comes from CIP-113 alone.
const ADMIN = { kind: 'pubkey', hash: 'aa'.repeat(28) };

const freezeSeize = () => ({
  actions: [
    { action: 'freeze', reducesBalance: false },
    { action: 'unfreeze', reducesBalance: false },
    { action: 'seize', reducesBalance: true },
  ],
  actionsComplete: true,
  triggerAuthority: 'designated-key-set',
  adminCredentials: [{ ...ADMIN }],
});

test('the freeze-and-seize profile verifies: both questions answered, restriction verdictless, exposure balance-reducing', () => {
  const v = checkSubstandardVerification(freezeSeize());
  assert.equal(v.status, 'verified');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), SUBSTANDARD_VERIFICATION_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { actionsAnswered: true, authorityAnswered: true, restrictionHolds: null });
  assert.equal(v.exposure, 'balance-reducing');
  assert.equal(v.canReduceHolderBalance, true);
  assert.deepEqual(v.reducingActions, ['seize']);
  assert.equal(v.adminCount, 1);
});

test('verified is not safe: a permissionless balance-reducing profile also verifies, with its exposure reported', () => {
  const v = checkSubstandardVerification({
    actions: [{ action: 'rebase', reducesBalance: true }],
    actionsComplete: true,
    triggerAuthority: 'anyone',
    adminCredentials: [],
  });
  assert.equal(v.valid, true);
  assert.equal(v.exposure, 'balance-reducing');
  assert.deepEqual(v.reducingActions, ['rebase']);
});

test('question (a): an incomplete action list leaves the profile unverified, however much it names', () => {
  const claim = freezeSeize();
  claim.actionsComplete = false;
  const v = checkSubstandardVerification(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-verified');
  assert.equal(v.verdicts.actionsAnswered, false);
  assert.equal(v.verdicts.authorityAnswered, true);
});

test('question (b): an undetermined authority leaves the profile unverified, with the actions still judged', () => {
  const claim = freezeSeize();
  claim.triggerAuthority = 'undetermined';
  const v = checkSubstandardVerification(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.authorityAnswered, false);
  assert.equal(v.verdicts.actionsAnswered, true);
  assert.equal(v.verdicts.restrictionHolds, null);
});

test('the restriction position holds only where it is claimed: a restricted profile with no reducing action verifies', () => {
  const v = checkSubstandardVerification({
    actions: [{ action: 'rebase', reducesBalance: false }],
    actionsComplete: true,
    triggerAuthority: 'restricted-non-reducing',
    adminCredentials: [],
  });
  assert.equal(v.verdicts.restrictionHolds, true);
  assert.equal(v.valid, true);
  assert.equal(v.exposure, 'non-reducing');
});

test('the restriction position fails a restricted profile whose actions can reduce a balance', () => {
  const v = checkSubstandardVerification({
    actions: [{ action: 'forced-transfer', reducesBalance: true }],
    actionsComplete: true,
    triggerAuthority: 'restricted-non-reducing',
    adminCredentials: [],
  });
  assert.equal(v.verdicts.restrictionHolds, false);
  assert.equal(v.valid, false);
});

test('a profile authorising no third-party actions verifies with the no-actions exposure', () => {
  const v = checkSubstandardVerification({
    actions: [],
    actionsComplete: true,
    triggerAuthority: 'anyone',
    adminCredentials: [],
  });
  assert.equal(v.valid, true);
  assert.equal(v.exposure, 'no-third-party-actions');
  assert.equal(v.canReduceHolderBalance, false);
  assert.deepEqual(v.reducingActions, []);
});

test('a designated key set may name several admin credentials, of either kind', () => {
  const claim = freezeSeize();
  claim.adminCredentials = [{ ...ADMIN }, { kind: 'script', hash: 'bb'.repeat(28) }];
  const v = checkSubstandardVerification(claim);
  assert.equal(v.valid, true);
  assert.equal(v.adminCount, 2);
});

test('hex case is canonicalised in admin credentials', () => {
  const claim = freezeSeize();
  claim.adminCredentials = [{ kind: 'pubkey', hash: ADMIN.hash.toUpperCase() }];
  const v = checkSubstandardVerification(claim);
  assert.equal(v.adminCredentials[0].hash, ADMIN.hash);
});

test('refusal discipline: unknown or missing fields and an unknown authority are refused, never scored in part', () => {
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), registry: [] }), /unknown field "registry"/);
  const missing = freezeSeize();
  delete missing.adminCredentials;
  assert.throws(() => checkSubstandardVerification(missing), /missing its "adminCredentials"/);
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), triggerAuthority: 'issuer' }), /trigger authority must be one of/);
  assert.throws(() => checkSubstandardVerification(null), /must be an object/);
});

test('refusal discipline: a malformed action, a non-boolean flag, and a duplicated action are refused', () => {
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), actions: [{ action: 'pause', reducesBalance: false }] }), /action must be one of/);
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), actions: [{ action: 'freeze' }] }), /missing its "reducesBalance"/);
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), actionsComplete: 'yes' }), /actionsComplete flag must be true or false/);
  const dup = freezeSeize();
  dup.actions.push({ action: 'freeze', reducesBalance: true });
  assert.throws(() => checkSubstandardVerification(dup), /listed more than once/);
});

test('refusal discipline: a designated set naming no key, and a permissionless authority naming admins, are refused as contradictory', () => {
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), adminCredentials: [] }), /names no admin credential/);
  assert.throws(() => checkSubstandardVerification({
    actions: [{ action: 'rebase', reducesBalance: false }],
    actionsComplete: true,
    triggerAuthority: 'anyone',
    adminCredentials: [{ ...ADMIN }],
  }), /has no designated key set/);
});

test('refusal discipline: a duplicated admin credential and a non-28-byte admin hash are refused', () => {
  const dup = freezeSeize();
  dup.adminCredentials = [{ ...ADMIN }, { ...ADMIN }];
  assert.throws(() => checkSubstandardVerification(dup), /listed more than once/);
  assert.throws(() => checkSubstandardVerification({ ...freezeSeize(), adminCredentials: [{ kind: 'pubkey', hash: 'aa'.repeat(10) }] }), /28-byte credential hash/);
});

test('an other action is named with its own balance effect, not enumerated away', () => {
  const v = checkSubstandardVerification({
    actions: [{ action: 'other', reducesBalance: true }],
    actionsComplete: true,
    triggerAuthority: 'designated-key-set',
    adminCredentials: [{ ...ADMIN }],
  });
  assert.equal(v.valid, true);
  assert.deepEqual(v.reducingActions, ['other']);
});

test('the checker does not mutate its claim', () => {
  const claim = freezeSeize();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkSubstandardVerification(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the substandard verification checker: panel, verdicts, honest boundary, v1.256', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkSubstandardVerification/);
  assert.match(app, /sub-verification-actions/);
  assert.match(app, /SUBSTANDARD VERIFICATION · LOCAL MODEL/);
  assert.match(app, /NO VERDICT/);
  assert.match(app, /read no substandard script, no registry, and no chain state/);
  assert.match(app, /v1\.256/);
});
