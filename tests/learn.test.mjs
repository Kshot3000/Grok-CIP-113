import test from 'node:test';
import assert from 'node:assert/strict';
import { CIP113_STATUS, ACCEPTANCE_CRITERIA, IMPLEMENTATION_PLAN, LEARNING_PATH, criteriaProgress, SPEC_URL, PROCESS_URL } from '../src/learn.js';

test('status snapshot is honest: Proposed, dated, and attributed to the spec authors', () => {
  assert.equal(CIP113_STATUS.status, 'Proposed');
  assert.match(CIP113_STATUS.checked, /^\d{4}-\d{2}-\d{2}$/);
  // Re-verified against the raw upstream frontmatter on 2026-10-09:
  // Status: Proposed, spec version 3.0, every Path to Active box unchecked.
  assert.equal(CIP113_STATUS.checked, '2026-10-09');
  assert.equal(CIP113_STATUS.specVersion, '3.0');
  assert.equal(CIP113_STATUS.authors.length, 4);
  assert.ok(SPEC_URL.includes('CIP-0113'));
  assert.ok(PROCESS_URL.includes('CIP-0001'));
});

test('acceptance criteria reproduce the spec Path to Active, all unchecked while Proposed', () => {
  assert.equal(ACCEPTANCE_CRITERIA.length, 4);
  const ids = ACCEPTANCE_CRITERIA.map(c => c.id);
  assert.deepEqual(ids, ['issuance-preview', 'issuance-mainnet', 'e2e-tests', 'wallet-adoption']);
  // While the upstream spec leaves every box unchecked, PRISM must too.
  for (const c of ACCEPTANCE_CRITERIA) {
    assert.equal(c.specChecked, false, `${c.id} must mirror the spec checkbox`);
    assert.ok(c.label.length > 10 && c.note.length > 40, `${c.id} needs a label and grounded context`);
  }
  assert.deepEqual(criteriaProgress(), { met: 0, total: 4 });
});

test('implementation plan mirrors the spec and never claims production readiness', () => {
  assert.equal(IMPLEMENTATION_PLAN.length, 2);
  for (const item of IMPLEMENTATION_PLAN) {
    assert.ok(item.state && item.note.length > 40);
    assert.doesNotMatch(item.note, /production-ready(?!.*not)/i);
  }
  const combined = IMPLEMENTATION_PLAN.map(i => i.note).join(' ');
  assert.match(combined, /independent review|audit pending/);
});

test('learning path covers the core CIP-113 concepts in order, each tied to a spec section', () => {
  assert.equal(LEARNING_PATH.length, 8);
  assert.deepEqual(LEARNING_PATH.map(l => l.id), ['why', 'smart-wallet', 'withdraw-zero', 'registry', 'substandards', 'actions', 'upgradability', 'defi']);
  const text = LEARNING_PATH.map(l => `${l.title} ${l.plain} ${l.detail}`).join(' ').toLowerCase();
  for (const concept of ['stake credential', 'withdraw-zero', 'registry', 'linked list', 'substandard', 'third-party', 'unfracking', 'hard fork', 'nominee', 'bootstrap transaction', 'collateral']) {
    assert.ok(text.includes(concept), `learning path must explain: ${concept}`);
  }
  for (const lesson of LEARNING_PATH) {
    assert.ok(lesson.plain.length > 150, `${lesson.id} plain-language body too thin`);
    assert.ok(lesson.specSection.length > 3, `${lesson.id} must name its spec section`);
  }
});

test('upgradability lesson teaches the spec rules: re-pointable wiring, immovable base, two-phase authority', () => {
  const lesson = LEARNING_PATH.find(l => l.id === 'upgradability');
  assert.ok(lesson, 'upgradability lesson exists');
  assert.equal(lesson.specSection, 'Protocol upgradability');
  const text = `${lesson.plain} ${lesson.detail}`;
  // Wiring is data, read live — re-pointing applies to every token at once.
  assert.match(text, /read live/);
  assert.match(text, /re-point/);
  // The base can never move, and the reason is stated: it is every
  // smart-wallet address's payment credential.
  assert.match(text, /payment credential of every smart-wallet address/);
  assert.match(text, /different deployment, identified by its own bootstrap transaction/);
  // Authority handover is two-phase and the promotion is the nominee's own act.
  assert.match(text, /two-phase/);
  assert.match(text, /nomination/);
  assert.match(text, /nominee must authorise/);
  // The standard leaves the authority's nature open — the lesson must too.
  assert.match(text, /does not say what the authority is/);
  // Local-model honesty: PRISM models the planner, reads no parameters record.
  assert.match(text, /models this upgrade planner and checker locally/);
  assert.match(text, /no protocol parameters record is read/);
});

test('DeFi lesson teaches the integration duties and the substandard collateral caution', () => {
  const lesson = LEARNING_PATH.find(l => l.id === 'defi');
  assert.ok(lesson, 'defi lesson exists');
  assert.equal(lesson.specSection, 'Implementing programmable tokens in DeFi protocols');
  const text = `${lesson.plain} ${lesson.detail}`;
  // A swap carries the transfer logic (withdraw-zero) and the registry entry.
  assert.match(text, /withdraw-zero pattern/);
  assert.match(text, /registry entry as a reference input/);
  // Collateral sits at a smart wallet, and liquidations need registry proofs.
  assert.match(text, /collateral at a smart wallet/);
  assert.match(text, /liquidations need registry proofs/);
  // The load-bearing caution: check the substandard before accepting a
  // token, because freeze-and-seize can move it without the holder.
  assert.match(text, /checking the substandard before accepting a token/);
  assert.match(text, /without the holder’s consent/);
  assert.match(text, /worth as collateral/);
  // Local-model honesty: the RealFi lab is maths only, nothing integrated.
  assert.match(text, /models the lending maths locally/);
  assert.match(text, /no integration is deployed/);
});

test('learning path never overclaims: no minting, signing, or live-registry promises', () => {
  const text = LEARNING_PATH.map(l => `${l.plain} ${l.detail}`).join(' ');
  assert.doesNotMatch(text, /PRISM (mints|signs|submits|deploys|issues)/i);
  assert.match(text, /Nothing is deployed/);
});
