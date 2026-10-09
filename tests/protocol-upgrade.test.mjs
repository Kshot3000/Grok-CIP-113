import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProtocolUpgrade, verifyProtocolUpgrade } from '../src/domain.js';

// CIP-113 protocol upgradability (spec section "Protocol
// upgradability"): the re-pointable wiring (global, issuance logic,
// the three action delegates), the immovable base, and the four
// upgrade-path requirements — two-phase authority handover, promotion
// authorised by the nominee itself, wiring/authority separation, and a
// declared kind per upgrade transaction.
const H = c => c.repeat(56);
const cred = (kind, c) => ({ kind, hash: H(c) });
const BEFORE = {
  global: cred('script', '1'),
  issuanceLogic: cred('script', '2'),
  transferDelegate: cred('script', '3'),
  thirdPartyDelegate: cred('script', '4'),
  unfrackingDelegate: cred('script', '5'),
  base: cred('script', '6'),
  upgradeAuthority: cred('pubkey', '7'),
  nominee: cred('script', '8'),
};
const NO_NOMINEE = { ...BEFORE, nominee: null };
const claimOf = plan => ({ declaredKind: plan.kind, after: plan.after, authorizedBy: plan.requiredAuthorizer });

test('a wiring plan re-points the named wiring credential and nothing else', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: cred('script', '9') } });
  assert.equal(p.status, 'planned');
  assert.deepEqual(p.changedFields, ['global']);
  assert.deepEqual(p.after.global, cred('script', '9'));
  assert.deepEqual(p.after.base, BEFORE.base);
  assert.deepEqual(p.after.upgradeAuthority, BEFORE.upgradeAuthority);
  assert.deepEqual(p.requiredAuthorizer, BEFORE.upgradeAuthority);
});

test('a wiring plan can re-point all five wiring credentials at once', () => {
  const changes = { global: cred('script', 'a'), issuanceLogic: cred('script', 'b'), transferDelegate: cred('script', 'c'), thirdPartyDelegate: cred('script', 'd'), unfrackingDelegate: cred('script', 'e') };
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes });
  assert.equal(p.status, 'planned');
  assert.deepEqual(p.changedFields, ['global', 'issuanceLogic', 'transferDelegate', 'thirdPartyDelegate', 'unfrackingDelegate']);
});

test('a wiring change to the value already in place is no change at all — unplannable', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: BEFORE.global } });
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['no-wiring-change']);
  assert.equal(p.after, null);
});

test('a wiring intent that moves the base is unplannable — the base is not upgradable surface', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: cred('script', '9'), base: cred('script', 'a') } });
  assert.equal(p.status, 'unplannable');
  assert.ok(p.missing.includes('base-immovable'));
  assert.equal(p.after, null);
});

test('a wiring intent carrying an authority or nominee change is unplannable — separation', () => {
  const a = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { upgradeAuthority: cred('pubkey', '9') } });
  assert.ok(a.missing.includes('authority-not-wiring'));
  const n = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { nominee: cred('pubkey', '9') } });
  assert.ok(n.missing.includes('nominee-not-wiring'));
});

test('a wiring intent naming an unknown parameter or a malformed credential is refused', () => {
  assert.throws(() => planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { registry: cred('script', '9') } }), /unknown parameter/);
  assert.throws(() => planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: { kind: 'script', hash: 'ab'.repeat(27) } } }), /28-byte/);
  assert.throws(() => planProtocolUpgrade(BEFORE, { kind: 'everything' }), /must be wiring, nominate, or promote/);
});

test('a nomination plan sets the standing nominee and is authorised by the sitting authority', () => {
  const p = planProtocolUpgrade(NO_NOMINEE, { kind: 'nominate', nominee: cred('pubkey', '9') });
  assert.equal(p.status, 'planned');
  assert.deepEqual(p.after.nominee, cred('pubkey', '9'));
  assert.deepEqual(p.after.upgradeAuthority, BEFORE.upgradeAuthority);
  assert.deepEqual(p.requiredAuthorizer, BEFORE.upgradeAuthority);
  assert.deepEqual(p.changedFields, ['nominee']);
});

test('nominating the sitting authority, or the nominee already standing, is unplannable', () => {
  assert.deepEqual(planProtocolUpgrade(BEFORE, { kind: 'nominate', nominee: BEFORE.upgradeAuthority }).missing, ['nominee-is-authority']);
  assert.deepEqual(planProtocolUpgrade(BEFORE, { kind: 'nominate', nominee: BEFORE.nominee }).missing, ['nominee-already-standing']);
});

test('a promotion plan hands the authority to the standing nominee and consumes the nomination', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'promote' });
  assert.equal(p.status, 'planned');
  assert.deepEqual(p.after.upgradeAuthority, BEFORE.nominee);
  assert.equal(p.after.nominee, null);
  assert.deepEqual(p.requiredAuthorizer, BEFORE.nominee);
  assert.deepEqual(p.changedFields, ['upgradeAuthority', 'nominee']);
});

test('a promotion with no nominee standing is unplannable — phase two needs phase one', () => {
  const p = planProtocolUpgrade(NO_NOMINEE, { kind: 'promote' });
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['no-standing-nominee']);
});

test('every planned upgrade verifies correct as its own canonical claim', () => {
  const plans = [
    planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { transferDelegate: cred('script', '9') } }),
    planProtocolUpgrade(NO_NOMINEE, { kind: 'nominate', nominee: cred('pubkey', '9') }),
    planProtocolUpgrade(BEFORE, { kind: 'promote' }),
  ];
  for (const p of plans) {
    assert.equal(p.status, 'planned');
    const before = p.kind === 'nominate' ? NO_NOMINEE : BEFORE;
    const v = verifyProtocolUpgrade(before, claimOf(p));
    assert.equal(v.status, 'correct', p.kind);
    assert.equal(v.valid, true);
  }
});

test('the full handover chains: nominate, verify, promote the result, verify — a second promotion is then unplannable', () => {
  const n = planProtocolUpgrade(NO_NOMINEE, { kind: 'nominate', nominee: cred('script', '9') });
  assert.equal(verifyProtocolUpgrade(NO_NOMINEE, claimOf(n)).status, 'correct');
  const pr = planProtocolUpgrade(n.after, { kind: 'promote' });
  assert.equal(pr.status, 'planned');
  assert.equal(verifyProtocolUpgrade(n.after, claimOf(pr)).status, 'correct');
  assert.deepEqual(pr.after.upgradeAuthority, cred('script', '9'));
  assert.equal(planProtocolUpgrade(pr.after, { kind: 'promote' }).status, 'unplannable');
});

test('a direct authority replacement fails the authority path alone, even authorised by the nominee', () => {
  const claim = { declaredKind: 'promote', after: { ...BEFORE, upgradeAuthority: cred('pubkey', '9'), nominee: null }, authorizedBy: BEFORE.nominee };
  const v = verifyProtocolUpgrade(BEFORE, claim);
  assert.equal(v.status, 'incorrect');
  assert.equal(v.verdicts.authorityPath, false);
  assert.equal(v.verdicts.authorisation, true);
  assert.equal(v.verdicts.declaration, true);
  assert.equal(v.verdicts.baseImmovable, true);
  assert.equal(v.verdicts.separation, true);
});

test('a promotion authorised by the old authority instead of the nominee fails authorisation alone', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'promote' });
  const v = verifyProtocolUpgrade(BEFORE, { ...claimOf(p), authorizedBy: BEFORE.upgradeAuthority });
  assert.equal(v.verdicts.authorisation, false);
  assert.equal(v.verdicts.authorityPath, true);
  assert.equal(v.status, 'incorrect');
});

test('a wiring change carrying an authority change fails separation', () => {
  const after = { ...BEFORE, global: cred('script', '9'), upgradeAuthority: BEFORE.nominee, nominee: null };
  const v = verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after, authorizedBy: BEFORE.nominee });
  assert.equal(v.verdicts.separation, false);
  assert.equal(v.status, 'incorrect');
});

test('moving the base fails the immovable verdict alone', () => {
  const after = { ...BEFORE, global: cred('script', '9'), base: cred('script', 'a') };
  const v = verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after, authorizedBy: BEFORE.upgradeAuthority });
  assert.equal(v.verdicts.baseImmovable, false);
  assert.equal(v.verdicts.separation, true);
  assert.equal(v.verdicts.declaration, true);
  assert.equal(v.verdicts.authorisation, true);
  assert.equal(v.status, 'incorrect');
});

test('clearing the standing nominee without promoting it fails the nominee shape alone', () => {
  const v = verifyProtocolUpgrade(BEFORE, { declaredKind: 'nominate', after: { ...BEFORE, nominee: null }, authorizedBy: BEFORE.upgradeAuthority });
  assert.equal(v.verdicts.nomineeShape, false);
  assert.equal(v.verdicts.declaration, true);
  assert.equal(v.status, 'incorrect');
});

test('an upgrade declared as the wrong kind fails declaration alone', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: cred('script', '9') } });
  const v = verifyProtocolUpgrade(BEFORE, { ...claimOf(p), declaredKind: 'nominate' });
  assert.equal(v.verdicts.declaration, false);
  assert.equal(v.derivedKind, 'wiring');
  assert.equal(v.status, 'incorrect');
});

test('unstated declaration or authoriser makes the claim incomplete, never correct or incorrect', () => {
  const p = planProtocolUpgrade(BEFORE, { kind: 'wiring', changes: { global: cred('script', '9') } });
  const v1 = verifyProtocolUpgrade(BEFORE, { after: p.after, authorizedBy: p.requiredAuthorizer });
  assert.equal(v1.verdicts.declaration, 'not-stated');
  assert.equal(v1.status, 'incomplete');
  const v2 = verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after: p.after });
  assert.equal(v2.verdicts.authorisation, 'not-stated');
  assert.equal(v2.status, 'incomplete');
});

test('a claim that changes nothing is not an upgrade — declaration fails', () => {
  const v = verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after: BEFORE, authorizedBy: BEFORE.upgradeAuthority });
  assert.equal(v.derivedKind, 'none');
  assert.equal(v.verdicts.declaration, false);
  assert.equal(v.status, 'incorrect');
});

test('a malformed claim is refused, never scored', () => {
  const { nominee, ...missingNominee } = BEFORE;
  assert.throws(() => verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after: missingNominee, authorizedBy: BEFORE.upgradeAuthority }), /missing its "nominee"/);
  assert.throws(() => verifyProtocolUpgrade(BEFORE, { declaredKind: 'all', after: BEFORE, authorizedBy: BEFORE.upgradeAuthority }), /declared kind must be/);
  assert.throws(() => verifyProtocolUpgrade(BEFORE, { declaredKind: 'wiring', after: BEFORE, authorizedBy: { kind: 'script', hash: 'zz' } }), /28-byte|policy ID/);
  assert.throws(() => planProtocolUpgrade({ ...BEFORE, base: { kind: 'script', hash: '' } }, { kind: 'promote' }), /28-byte|policy ID/);
});
