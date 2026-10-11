import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diffProtocolUpgrade, planProtocolUpgrade, PROTOCOL_UPGRADE_COMPARE_FIELDS } from '../src/domain.js';

// CIP-113 protocol upgrade staleness: ONE intent planned against TWO
// versions of the current parameters. The temporal shape differs from
// the other families — the intent is staled by a changing baseline,
// because a promotion promotes whoever stands when it lands and a
// wiring change is authorised by whoever holds the authority then.
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
const WIRING = { kind: 'wiring', changes: { global: cred('script', '9') } };

test('the same parameters on both sides compare as unchanged in all nine positions', () => {
  const d = diffProtocolUpgrade(BEFORE, BEFORE, WIRING);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 9);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.parametersChanged, false);
  assert.equal(d.authorizerChanged, false);
  assert.equal(d.effectChanged, false);
});

test('the compare fields are the status and the eight resulting parameters, in order', () => {
  assert.deepEqual(PROTOCOL_UPGRADE_COMPARE_FIELDS.map(([f]) => f), ['status', 'global', 'issuanceLogic', 'transferDelegate', 'thirdPartyDelegate', 'unfrackingDelegate', 'base', 'upgradeAuthority', 'nominee']);
  const d = diffProtocolUpgrade(BEFORE, BEFORE, WIRING);
  assert.deepEqual(d.positions.map(p => p.field), PROTOCOL_UPGRADE_COMPARE_FIELDS.map(([f]) => f));
});

test('both sides are planned through the planner itself — the returns are its returns', () => {
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, nominee: cred('script', 'a') }, WIRING);
  assert.deepEqual(d.before, planProtocolUpgrade(BEFORE, WIRING));
  assert.deepEqual(d.after, planProtocolUpgrade({ ...BEFORE, nominee: cred('script', 'a') }, WIRING));
  assert.equal(d.kind, 'wiring');
});

test('an intervening nomination moves a wiring plan\'s resulting nominee — one position', () => {
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, nominee: cred('script', 'a') }, WIRING);
  assert.equal(d.change, 'result-changed');
  assert.equal(d.changedCount, 1);
  assert.deepEqual(d.changedFields, ['nominee']);
  assert.deepEqual(d.interveningFields, ['nominee']);
  assert.equal(d.authorizerChanged, false);
});

test('an intervening wiring change to an untouched field moves the resulting state — one position', () => {
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, transferDelegate: cred('script', 'a') }, WIRING);
  assert.equal(d.change, 'result-changed');
  assert.deepEqual(d.changedFields, ['transfer delegate']);
  assert.deepEqual(d.interveningFields, ['transferDelegate']);
});

test('an intervening nominee replacement moves a promotion\'s authoriser AND its resulting authority — counted once', () => {
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, nominee: cred('script', 'a') }, { kind: 'promote' });
  assert.equal(d.change, 'result-changed');
  assert.equal(d.changedCount, 1);
  assert.deepEqual(d.changedFields, ['upgrade authority']);
  assert.equal(d.authorizerChanged, true);
  assert.deepEqual(d.before.requiredAuthorizer, cred('script', '8'));
  assert.deepEqual(d.after.requiredAuthorizer, cred('script', 'a'));
});

test('a promotion whose nominee was already promoted lands became-unplannable', () => {
  const landed = { ...BEFORE, upgradeAuthority: BEFORE.nominee, nominee: null };
  const d = diffProtocolUpgrade(BEFORE, landed, { kind: 'promote' });
  assert.equal(d.change, 'became-unplannable');
  assert.deepEqual(d.after.missing, ['no-standing-nominee']);
  // Eight positions, not nine: a planned promotion's resulting nominee
  // is null, which is exactly what an unplannable plan reads there.
  assert.equal(d.changedCount, 8);
});

test('a wiring change already applied in full became unplannable — there is nothing left to re-point', () => {
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, global: cred('script', '9') }, WIRING);
  assert.equal(d.change, 'became-unplannable');
  assert.deepEqual(d.after.missing, ['no-wiring-change']);
});

test('a nomination already standing became unplannable', () => {
  const intent = { kind: 'nominate', nominee: cred('pubkey', '9') };
  const d = diffProtocolUpgrade(NO_NOMINEE, { ...NO_NOMINEE, nominee: cred('pubkey', '9') }, intent);
  assert.equal(d.change, 'became-unplannable');
  assert.deepEqual(d.after.missing, ['nominee-already-standing']);
});

test('an intent unplannable against the old parameters and plannable against the new is became-plannable', () => {
  const d = diffProtocolUpgrade(NO_NOMINEE, BEFORE, { kind: 'promote' });
  assert.equal(d.change, 'became-plannable');
  assert.equal(d.changedCount, 8); // the promotion's resulting nominee is null on both sides
  assert.deepEqual(d.after.after.upgradeAuthority, cred('script', '8'));
});

test('an intervening upgrade that already applied part of a wiring intent compares unchanged, the effect reported separately', () => {
  const intent = { kind: 'wiring', changes: { global: cred('script', '9'), transferDelegate: cred('script', 'a') } };
  const d = diffProtocolUpgrade(BEFORE, { ...BEFORE, global: cred('script', '9') }, intent);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.changedCount, 0);
  assert.equal(d.effectChanged, true);
  assert.deepEqual(d.before.changedFields, ['global', 'transferDelegate']);
  assert.deepEqual(d.after.changedFields, ['transferDelegate']);
  assert.deepEqual(d.before.after, d.after.after);
});

test('an intervening handover moves a nomination plan\'s authoriser and resulting authority together', () => {
  const intent = { kind: 'nominate', nominee: cred('pubkey', '9') };
  const current = { ...BEFORE, upgradeAuthority: cred('pubkey', 'b') };
  const d = diffProtocolUpgrade(BEFORE, current, intent);
  assert.equal(d.change, 'result-changed');
  assert.deepEqual(d.changedFields, ['upgrade authority']);
  assert.equal(d.authorizerChanged, true);
  assert.deepEqual(d.interveningFields, ['upgradeAuthority']);
});

test('two unplannable plans with the same missing reason compare as unchanged', () => {
  const d = diffProtocolUpgrade(NO_NOMINEE, NO_NOMINEE, { kind: 'promote' });
  assert.equal(d.change, 'unchanged');
  assert.equal(d.changedCount, 0);
});

test('two unplannable plans blocked for different reasons are still-unplannable', () => {
  const intent = { kind: 'nominate', nominee: cred('pubkey', '7') };
  const current = { ...BEFORE, upgradeAuthority: cred('pubkey', 'b'), nominee: cred('pubkey', '7') };
  const d = diffProtocolUpgrade(BEFORE, current, intent);
  assert.equal(d.change, 'still-unplannable');
  assert.deepEqual(d.before.missing, ['nominee-is-authority']);
  assert.deepEqual(d.after.missing, ['nominee-already-standing']);
  assert.equal(d.changedCount, 0);
});

test('hex case alone compares as unchanged — values compare in the planner\'s canonical form', () => {
  const upper = Object.fromEntries(Object.entries(BEFORE).map(([k, v]) => [k, v === null ? null : { kind: v.kind, hash: v.hash.toUpperCase() }]));
  const d = diffProtocolUpgrade(BEFORE, upper, WIRING);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.parametersChanged, false);
});

test('an unreadable parameter version is refused on either side with the planner\'s reason', () => {
  const { nominee, ...missingNominee } = BEFORE;
  assert.throws(() => diffProtocolUpgrade(missingNominee, BEFORE, WIRING), /missing its "nominee"/);
  assert.throws(() => diffProtocolUpgrade(BEFORE, missingNominee, WIRING), /missing its "nominee"/);
  assert.throws(() => diffProtocolUpgrade({ ...BEFORE, base: { kind: 'script', hash: 'zz' } }, BEFORE, WIRING), /28-byte|policy ID/);
});

test('an unreadable intent is refused, never compared', () => {
  assert.throws(() => diffProtocolUpgrade(BEFORE, BEFORE, { kind: 'everything' }), /must be wiring, nominate, or promote/);
  assert.throws(() => diffProtocolUpgrade(BEFORE, BEFORE, { kind: 'nominate' }), /must name its nominee/);
});

test('comparing plans nothing and performs no upgrade — both plans are pure returns', () => {
  const current = { ...BEFORE, nominee: cred('script', 'a') };
  const d = diffProtocolUpgrade(BEFORE, current, { kind: 'promote' });
  assert.deepEqual(d.after.after.upgradeAuthority, cred('script', 'a'));
  assert.deepEqual(current.nominee, cred('script', 'a'));
  assert.deepEqual(BEFORE.nominee, cred('script', '8'));
});

test('app wiring: the comparison is live in the upgrade panel', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffProtocolUpgrade/);
  assert.match(app, /protocolUpgradeDiffPreview/);
  assert.match(app, /protocolUpgradeDiffExample/);
  assert.match(app, /upgrade-diff-current/);
  assert.match(app, /upgrade-diff-result/);
  assert.match(app, /v1\.104/);
});
