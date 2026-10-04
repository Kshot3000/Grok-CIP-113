import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDesign, fromTemplate, MAX_ASSET } from '../src/domain.js';
import { TEMPLATES } from '../src/config.js';

const byId = (a, id) => a.findings.find(f => f.id === id);

test('every shipped template passes the review with no blockers', () => {
  for (const t of TEMPLATES) {
    const a = auditDesign(fromTemplate(t.id));
    assert.equal(a.invalid, false, t.id);
    assert.equal(a.ready, true, t.id);
    assert.equal(a.counts.blocker, 0, t.id);
    assert.equal(byId(a, 'validity').level, 'ok', t.id);
  }
});

test('an invalid design reports a single blocker and nothing else', () => {
  const d = { ...fromTemplate('rwa'), ticker: 'lowercase', supply: '0' };
  const a = auditDesign(d);
  assert.equal(a.invalid, true);
  assert.equal(a.ready, false);
  assert.equal(a.findings.length, 1);
  assert.equal(a.findings[0].level, 'blocker');
  assert.equal(a.counts.blocker, 1);
});

test('a design with no rules at all warns it behaves like an ordinary native token', () => {
  const d = { ...fromTemplate('community'), allowlist: false, limitEnabled: false, pausable: false, identity: false, substandard: 'generic' };
  const a = auditDesign(d);
  assert.equal(byId(a, 'rule-coverage').level, 'warning');
  assert.match(byId(a, 'rule-coverage').detail, /ordinary native token/);
});

test('all toggles off with a reference substandard is a note, not the no-rules warning', () => {
  const d = { ...fromTemplate('community'), allowlist: false, limitEnabled: false, pausable: false, identity: false, substandard: 'freeze-seize' };
  const a = auditDesign(d);
  assert.equal(byId(a, 'rule-coverage').level, 'note');
});

test('a cap equal to the whole supply warns the cap can never bind', () => {
  const d = { ...fromTemplate('rwa'), limit: '1000000' };
  const a = auditDesign(d);
  assert.equal(byId(a, 'cap-effectiveness').level, 'warning');
  assert.match(byId(a, 'cap-effectiveness').title, /can never block/);
});

test('cap share is exact BigInt arithmetic, rendered to two decimals', () => {
  const rwa = auditDesign(fromTemplate('rwa'));
  assert.equal(byId(rwa, 'cap-effectiveness').level, 'ok');
  assert.match(byId(rwa, 'cap-effectiveness').title, /1\.00%/);
  const ticket = auditDesign(fromTemplate('ticket'));
  assert.match(byId(ticket, 'cap-effectiveness').title, /0\.08%/);
  const community = auditDesign(fromTemplate('community'));
  assert.match(byId(community, 'cap-effectiveness').title, /0\.01%/);
});

test('a cap below one hundredth of a percent renders as <0.01%, never 0.00%', () => {
  const d = { ...fromTemplate('rwa'), supply: '1000000', limit: '1' };
  const a = auditDesign(d);
  // 1 at 6 decimals is 1 base unit of 1e12 — far below 0.01%.
  assert.match(byId(a, 'cap-effectiveness').title, /<0\.01%/);
});

test('no cap is a note explaining a whole balance can move at once', () => {
  const d = { ...fromTemplate('rwa'), limitEnabled: false };
  const a = auditDesign(d);
  assert.equal(byId(a, 'cap-effectiveness').level, 'note');
  assert.match(byId(a, 'cap-effectiveness').detail, /whole balance/);
});

test('a design that starts paused warns, naming the deliberate-launch exception', () => {
  const d = { ...fromTemplate('rwa'), paused: true };
  const a = auditDesign(d);
  assert.equal(byId(a, 'pause-state').level, 'warning');
  assert.match(byId(a, 'pause-state').detail, /staged launch/);
});

test('no issuer controls is a note, and freeze-seize is named as a separate mechanism', () => {
  const d = { ...fromTemplate('community'), pausable: false };
  const a = auditDesign(d);
  assert.equal(byId(a, 'pause-state').level, 'note');
  assert.match(byId(a, 'pause-state').detail, /separate mechanism/);
});

test('KYC extended without the allowlist warns the two layers disagree', () => {
  const d = { ...fromTemplate('rwa'), allowlist: false };
  const a = auditDesign(d);
  assert.equal(byId(a, 'substandard-alignment').level, 'warning');
  const aligned = auditDesign(fromTemplate('rwa'));
  assert.equal(byId(aligned, 'substandard-alignment'), undefined);
});

test('basic KYC with an allowlist notes the module itself checks the sender only', () => {
  const a = auditDesign(fromTemplate('credit'));
  const f = byId(a, 'substandard-alignment');
  assert.equal(f.level, 'note');
  assert.match(f.detail, /sender/);
});

test('eligibility without an allowlist notes distribution stays open', () => {
  const d = { ...fromTemplate('credit'), allowlist: false };
  const a = auditDesign(d);
  assert.equal(byId(a, 'eligibility-scope').level, 'note');
});

test('supply over 90% of the int64 ceiling warns with exact base units', () => {
  const d = { ...fromTemplate('carbon'), supply: '9000000000000000000', limit: '9000000000000000000' };
  const a = auditDesign(d);
  const f = byId(a, 'supply-headroom');
  assert.equal(f.level, 'warning');
  assert.match(f.detail, /9000000000000000000 base units/);
  assert.match(f.detail, new RegExp(MAX_ASSET.toString()));
  const normal = auditDesign(fromTemplate('carbon'));
  assert.equal(byId(normal, 'supply-headroom'), undefined);
});

test('zero decimals notes indivisibility; divisible designs do not get the note', () => {
  assert.equal(byId(auditDesign(fromTemplate('ticket')), 'divisibility').level, 'note');
  assert.equal(byId(auditDesign(fromTemplate('rwa')), 'divisibility'), undefined);
});

test('counts always sum to the findings list and the review is deterministic', () => {
  for (const t of TEMPLATES) {
    const a = auditDesign(fromTemplate(t.id));
    const sum = Object.values(a.counts).reduce((x, y) => x + y, 0);
    assert.equal(sum, a.findings.length, t.id);
    assert.deepEqual(auditDesign(fromTemplate(t.id)), a, t.id);
  }
});
