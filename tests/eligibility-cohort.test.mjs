import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkEligibility, evaluateEligibilityCohort, ELIGIBILITY_COHORT } from '../src/domain.js';

const POLICY = { minimum: 65, adult: true, region: true };
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('default cohort isolates one failing check per participant', () => {
  const out = evaluateEligibilityCohort(POLICY);
  assert.equal(out.total, 5);
  assert.equal(out.eligibleCount, 1);
  assert.deepEqual(out.policy, POLICY);
  const byId = Object.fromEntries(out.results.map(r => [r.id, r]));
  assert.equal(byId.amara.eligible, true);
  for (const [id, check] of [['ben', 'Score threshold'], ['chandra', 'Age threshold'], ['dario', 'Region requirement']]) {
    assert.equal(byId[id].eligible, false, id);
    assert.deepEqual(byId[id].checks.filter(c => !c.pass).map(c => c.name), [check], id);
  }
  assert.equal(byId.elif.eligible, false);
  assert.equal(byId.elif.checks.every(c => !c.pass), true);
});

test('cohort results match the single-participant model for every member', () => {
  const out = evaluateEligibilityCohort(POLICY);
  for (const p of ELIGIBILITY_COHORT) {
    const single = checkEligibility({ score: p.score, minimum: POLICY.minimum, age: p.age, adult: POLICY.adult, region: POLICY.region, approved: p.regionApproved });
    const row = out.results.find(r => r.id === p.id);
    assert.equal(row.eligible, single.eligible, p.id);
    assert.deepEqual(row.checks, single.checks, p.id);
  }
});

test('public output carries no private values under any key', () => {
  const out = evaluateEligibilityCohort(POLICY);
  const keys = [];
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
  walk(out);
  for (const banned of ['score', 'age', 'approved', 'regionApproved']) assert.equal(keys.includes(banned), false, banned);
  // The private fixture values must not leak as values either: none of the
  // cohort's exact scores or ages appears anywhere in the serialized output.
  const serialized = JSON.stringify(out);
  for (const p of ELIGIBILITY_COHORT) {
    assert.equal(serialized.includes(String(p.score)), false, `score ${p.score}`);
    assert.equal(serialized.includes(`"${p.age}"`), false, `age ${p.age}`);
  }
  assert.deepEqual(Object.keys(out.results[0]).sort(), ['checks', 'eligible', 'id', 'name']);
});

test('turning a requirement off admits exactly the participants it gated', () => {
  assert.equal(evaluateEligibilityCohort({ ...POLICY, adult: false }).eligibleCount, 2); // + Chandra
  assert.equal(evaluateEligibilityCohort({ ...POLICY, region: false }).eligibleCount, 2); // + Dario
  const open = evaluateEligibilityCohort({ minimum: 0, adult: false, region: false });
  assert.equal(open.eligibleCount, 5);
});

test('raising the minimum score gates on the score check alone', () => {
  const out = evaluateEligibilityCohort({ ...POLICY, minimum: 95 });
  assert.equal(out.eligibleCount, 0);
  const amara = out.results.find(r => r.id === 'amara');
  assert.deepEqual(amara.checks.filter(c => !c.pass).map(c => c.name), ['Score threshold']);
});

test('malformed policies and cohorts throw instead of producing output', () => {
  assert.throws(() => evaluateEligibilityCohort(null), /policy is required/);
  assert.throws(() => evaluateEligibilityCohort({ minimum: 65, adult: 'yes', region: true }), /on or off/);
  assert.throws(() => evaluateEligibilityCohort({ minimum: 101, adult: true, region: true }), /scores between 0 and 100/);
  assert.throws(() => evaluateEligibilityCohort(POLICY, []), /1 to 50/);
  assert.throws(() => evaluateEligibilityCohort(POLICY, [{ id: 'x', name: 'X', score: 90, age: 30, regionApproved: true }, { id: 'x', name: 'Y', score: 90, age: 30, regionApproved: true }]), /Duplicate cohort participant id/);
  assert.throws(() => evaluateEligibilityCohort(POLICY, [{ id: 'x', name: 'X', score: 90, age: 30 }]), /region status/);
  assert.throws(() => evaluateEligibilityCohort(POLICY, [{ id: 'x', name: 'X', score: 900, age: 30, regionApproved: true }]), /scores between 0 and 100/);
});

test('a custom cohort evaluates against the same policy', () => {
  const out = evaluateEligibilityCohort(POLICY, [{ id: 'solo', name: 'Solo — fictional participant', score: 65, age: 18, regionApproved: true }]);
  assert.equal(out.total, 1);
  assert.equal(out.eligibleCount, 1); // boundary values pass: score == minimum, age == 18
});

test('app wiring: cohort panel evaluates locally and clears on policy edits', () => {
  assert.match(app, /data-action="cohort-evaluate"/);
  assert.match(app, /evaluateEligibilityCohort\(state\.eligibility\)/);
  assert.match(app, /state\.cohortResult=null/);
  assert.match(app, /Private values stay private/);
  assert.match(app, /No proof generated\. No attestation issued/);
});
