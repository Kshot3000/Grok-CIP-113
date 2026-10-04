import test from 'node:test';
import assert from 'node:assert/strict';
import { CIP113_STATUS, ACCEPTANCE_CRITERIA, IMPLEMENTATION_PLAN, LEARNING_PATH, criteriaProgress, SPEC_URL, PROCESS_URL } from '../src/learn.js';

test('status snapshot is honest: Proposed, dated, and attributed to the spec authors', () => {
  assert.equal(CIP113_STATUS.status, 'Proposed');
  assert.match(CIP113_STATUS.checked, /^\d{4}-\d{2}-\d{2}$/);
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
  assert.equal(LEARNING_PATH.length, 6);
  assert.deepEqual(LEARNING_PATH.map(l => l.id), ['why', 'smart-wallet', 'withdraw-zero', 'registry', 'substandards', 'actions']);
  const text = LEARNING_PATH.map(l => `${l.title} ${l.plain} ${l.detail}`).join(' ').toLowerCase();
  for (const concept of ['stake credential', 'withdraw-zero', 'registry', 'linked list', 'substandard', 'third-party', 'unfracking', 'hard fork']) {
    assert.ok(text.includes(concept), `learning path must explain: ${concept}`);
  }
  for (const lesson of LEARNING_PATH) {
    assert.ok(lesson.plain.length > 150, `${lesson.id} plain-language body too thin`);
    assert.ok(lesson.specSection.length > 3, `${lesson.id} must name its spec section`);
  }
});

test('learning path never overclaims: no minting, signing, or live-registry promises', () => {
  const text = LEARNING_PATH.map(l => `${l.plain} ${l.detail}`).join(' ');
  assert.doesNotMatch(text, /PRISM (mints|signs|submits|deploys|issues)/i);
  assert.match(text, /Nothing is deployed/);
});
