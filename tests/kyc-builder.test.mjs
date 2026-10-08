import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateKycSequence, blankKycStep, copyKycSteps, addKycStep, removeKycStep, moveKycStep, updateKycStep, MAX_KYC_STEPS } from '../src/domain.js';

const design = fromTemplate('rwa'); // KYC-extended, supply 1,000,000 PRA, 6 decimals
const LIFECYCLE = [
  { kind: 'allowlist', account: 'approved', listed: true, expired: false },
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid' },
  { kind: 'allowlist', account: 'approved', listed: true, expired: true },
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' },
  { kind: 'allowlist', account: 'approved', listed: true, expired: false },
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' },
];
const sum = balances => Object.values(balances).reduce((a, v) => a + BigInt(v), 0n).toString();

test('blank KYC steps are well-formed for all three kinds', () => {
  assert.deepEqual(blankKycStep(), { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' });
  assert.deepEqual(blankKycStep('allowlist'), { kind: 'allowlist', account: 'approved', listed: true, expired: false });
  assert.deepEqual(blankKycStep('pause'), { kind: 'pause', paused: true });
  assert.notEqual(blankKycStep(), blankKycStep()); // a fresh object each call
  assert.throws(() => blankKycStep('denylist'));
  // A blank allowlist update applies, a blank transfer to the listed
  // recipient applies, and a blank pause applies as a state change.
  const r = simulateKycSequence(design, [blankKycStep('allowlist'), blankKycStep(), blankKycStep('pause')]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, true]);
  assert.equal(r.paused, true);
});

test('copying a lifecycle validates all three kinds and returns independent step objects', () => {
  const copy = copyKycSteps(LIFECYCLE);
  assert.deepEqual(copy, LIFECYCLE);
  assert.notEqual(copy, LIFECYCLE);
  assert.notEqual(copy[1], LIFECYCLE[1]);
  copy[1].amount = '999';
  assert.equal(LIFECYCLE[1].amount, '250'); // the source list is untouched
  // A listed entry that does not say whether it is expired is current —
  // the presets write it that way, and the copy makes it explicit.
  assert.deepEqual(copyKycSteps([{ kind: 'allowlist', account: 'approved', listed: true }]),
    [{ kind: 'allowlist', account: 'approved', listed: true, expired: false }]);
  // A removal carries no entry state: an expired flag on one is dropped.
  assert.deepEqual(copyKycSteps([{ kind: 'allowlist', account: 'approved', listed: false, expired: true }]),
    [{ kind: 'allowlist', account: 'approved', listed: false }]);
  assert.throws(() => copyKycSteps([]));
  assert.throws(() => copyKycSteps(Array(13).fill(blankKycStep())));
  assert.throws(() => copyKycSteps('not-an-array'));
  assert.throws(() => copyKycSteps([null]));
  assert.throws(() => copyKycSteps([{ kind: 'seize', amount: '1' }]));
  assert.throws(() => copyKycSteps([{ kind: 'transfer', from: 'stranger', to: 'approved', amount: '1', cert: 'valid' }]));
  assert.throws(() => copyKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: 1, cert: 'valid' }]));
  assert.throws(() => copyKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '1', cert: 'forged' }]));
  assert.throws(() => copyKycSteps([{ kind: 'allowlist', account: 'stranger', listed: true }]));
  assert.throws(() => copyKycSteps([{ kind: 'allowlist', account: 'approved', listed: 'yes' }]));
  assert.throws(() => copyKycSteps([{ kind: 'allowlist', account: 'approved', listed: true, expired: 'yes' }]));
  assert.throws(() => copyKycSteps([{ kind: 'pause', paused: 'true' }])); // the flag is a boolean, not a string
});

test('adding a lifecycle step appends any kind without mutating the original list', () => {
  const one = [blankKycStep()];
  const two = addKycStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankKycStep());
  const withPause = addKycStep(one, blankKycStep('pause'));
  assert.deepEqual(withPause[1], { kind: 'pause', paused: true });
  assert.throws(() => addKycStep(one, { kind: 'allowlist', account: 'nobody', listed: true }));
  const full = Array.from({ length: MAX_KYC_STEPS }, () => blankKycStep());
  assert.throws(() => addKycStep(full), /at most 12/);
  assert.equal(MAX_KYC_STEPS, 12);
});

test('removing a lifecycle step keeps at least one and never mutates the original', () => {
  const removed = removeKycStep(LIFECYCLE, 2);
  assert.deepEqual(removed.map(s => s.kind), ['allowlist', 'transfer', 'transfer', 'allowlist', 'transfer']);
  assert.equal(LIFECYCLE.length, 6);
  assert.throws(() => removeKycStep([blankKycStep()], 0), /at least one/);
  assert.throws(() => removeKycStep(LIFECYCLE, 6));
  assert.throws(() => removeKycStep(LIFECYCLE, -1));
  assert.throws(() => removeKycStep(LIFECYCLE, 1.5));
});

test('moving a lifecycle step swaps neighbours across kinds; the edges return an unchanged copy', () => {
  const down = moveKycStep(LIFECYCLE, 0, 1);
  assert.deepEqual(down.map(s => s.kind), ['transfer', 'allowlist', 'allowlist', 'transfer', 'allowlist', 'transfer']);
  assert.equal(LIFECYCLE[0].kind, 'allowlist'); // original order untouched
  const edge = moveKycStep(LIFECYCLE, 0, -1);
  assert.deepEqual(edge, LIFECYCLE);
  assert.notEqual(edge, LIFECYCLE);
  assert.deepEqual(moveKycStep(LIFECYCLE, 5, 1), LIFECYCLE);
  assert.throws(() => moveKycStep(LIFECYCLE, 0, 2));
  assert.throws(() => moveKycStep(LIFECYCLE, 0, 0));
  assert.throws(() => moveKycStep(LIFECYCLE, 9, 1));
});

test('updating a lifecycle step patches only the fields its kind carries', () => {
  const edited = updateKycStep(LIFECYCLE, 1, { to: 'pending', amount: '300', cert: 'expired' });
  assert.deepEqual(edited[1], { kind: 'transfer', from: 'issuer', to: 'pending', amount: '300', cert: 'expired' });
  assert.deepEqual(LIFECYCLE[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid' }); // untouched
  const expired = updateKycStep(LIFECYCLE, 0, { expired: true });
  assert.deepEqual(expired[0], { kind: 'allowlist', account: 'approved', listed: true, expired: true });
  assert.throws(() => updateKycStep(LIFECYCLE, 1, { account: 'approved' }), /has no account field/);
  assert.throws(() => updateKycStep(LIFECYCLE, 0, { amount: '5' }), /has no amount field/);
  assert.throws(() => updateKycStep(LIFECYCLE, 0, { paused: true }), /has no paused field/);
  assert.throws(() => updateKycStep(LIFECYCLE, 1, { note: 'x' }), /has no note field/);
  assert.throws(() => updateKycStep(LIFECYCLE, 1, { kind: 'seize' }));
  assert.throws(() => updateKycStep(LIFECYCLE, 0, { listed: 'false' })); // the flag is a boolean, not a string
  assert.throws(() => updateKycStep(LIFECYCLE, 1, { cert: 'forged' }));
  assert.throws(() => updateKycStep(LIFECYCLE, 1, { amount: 5 }));
  assert.throws(() => updateKycStep(LIFECYCLE, 1, null));
  assert.throws(() => updateKycStep(LIFECYCLE, 7, { amount: '1' }));
});

test('the listed flag governs the expired flag: removal drops it, listing defaults it current', () => {
  const removed = updateKycStep(LIFECYCLE, 2, { listed: false });
  assert.deepEqual(removed[2], { kind: 'allowlist', account: 'approved', listed: false }); // expired:true dropped — a removal carries no entry
  const relisted = updateKycStep(removed, 2, { listed: true });
  assert.deepEqual(relisted[2], { kind: 'allowlist', account: 'approved', listed: true, expired: false }); // defaulted current, not the stale expired
  const stillRemoved = updateKycStep(removed, 2, { expired: true });
  assert.deepEqual(stillRemoved[2], { kind: 'allowlist', account: 'approved', listed: false }); // an expired flag on a removal never survives
  assert.deepEqual(LIFECYCLE[2], { kind: 'allowlist', account: 'approved', listed: true, expired: true }); // untouched
});

test('switching a step kind converts it: amount and certificate never cross kinds, no stale fields', () => {
  const toPause = updateKycStep(LIFECYCLE, 1, { kind: 'pause' });
  assert.deepEqual(toPause[1], { kind: 'pause', paused: true }); // amount and cert dropped — this kind carries neither
  const toAllowlist = updateKycStep(LIFECYCLE, 1, { kind: 'allowlist' });
  assert.deepEqual(toAllowlist[1], { kind: 'allowlist', account: 'approved', listed: true, expired: false });
  const fromAllowlist = updateKycStep(LIFECYCLE, 0, { kind: 'transfer' });
  assert.deepEqual(fromAllowlist[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' }); // defaults — the old kind had neither to keep
  const fromAllowlistSized = updateKycStep(LIFECYCLE, 0, { kind: 'transfer', amount: '75', cert: 'expired' });
  assert.deepEqual(fromAllowlistSized[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '75', cert: 'expired' });
  const fromPause = updateKycStep([{ kind: 'pause', paused: false }], 0, { kind: 'allowlist' });
  assert.deepEqual(fromPause[0], { kind: 'allowlist', account: 'approved', listed: true, expired: false }); // the paused flag does not leak into a listing
  assert.deepEqual(LIFECYCLE[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid' }); // untouched
});

test('a lifecycle built with the helpers simulates end to end', () => {
  // Start from the expiry shape, then append a pause round the renewal
  // leaves funded: pause blocks a valid transfer, clearing restores it.
  let steps = copyKycSteps(LIFECYCLE);
  steps = addKycStep(steps, { kind: 'allowlist', account: 'issuer', listed: true, expired: false });
  steps = addKycStep(steps, { kind: 'pause', paused: true });
  steps = addKycStep(steps, { kind: 'transfer', from: 'approved', to: 'issuer', amount: '50', cert: 'valid' });
  steps = addKycStep(steps, { kind: 'pause', paused: false });
  steps = addKycStep(steps, { kind: 'transfer', from: 'approved', to: 'issuer', amount: '50', cert: 'valid' });
  const r = simulateKycSequence(design, steps);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, true, false, true, true, true, true, false, true, true]);
  assert.equal(r.appliedCount, 9);
  assert.equal(r.transferredBaseUnits, (400n * 1000000n).toString());
  assert.equal(sum(r.balances), (1000000n * 1000000n).toString());
});

test('order matters across kinds: expiring before funding blocks what expiring after funding allows', () => {
  // The same funding transfer and the same expiry: fund first and the
  // transfer applies (the expiry then governs later steps); move the
  // expiry ahead of it and the identical transfer is blocked.
  const fundFirst = [
    { kind: 'allowlist', account: 'approved', listed: true, expired: false },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' },
    { kind: 'allowlist', account: 'approved', listed: true, expired: true },
  ];
  assert.deepEqual(simulateKycSequence(design, fundFirst).steps.map(s => s.allowed), [true, true, true]);
  const expireFirst = simulateKycSequence(design, [
    { kind: 'allowlist', account: 'approved', listed: true, expired: true },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid' },
  ]);
  assert.deepEqual(expireFirst.steps.map(s => s.allowed), [true, false]);
  assert.deepEqual(expireFirst.steps[1].checks.filter(c => !c.pass).map(c => c.name), ['Recipient entry current']);
  assert.equal(expireFirst.balances.approved, '0');
});

test('the studio wires the custom KYC builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="kyc-customize"/);
  assert.match(app, /data-action="kyc-add-transfer"/);
  assert.match(app, /data-action="kyc-add-allowlist"/);
  assert.match(app, /data-action="kyc-add-pause"/);
  assert.match(app, /data-kyc-field="kind"/);
  assert.match(app, /data-kyc-field="from"/);
  assert.match(app, /data-kyc-field="to"/);
  assert.match(app, /data-kyc-field="cert"/);
  assert.match(app, /data-kyc-field="account"/);
  assert.match(app, /data-kyc-field="listed"/);
  assert.match(app, /data-kyc-field="expired"/);
  assert.match(app, /data-kyc-field="paused"/);
  assert.match(app, /data-kyc-field="amount"/);
  assert.match(app, /data-kyc-move/);
  assert.match(app, /data-kyc-remove/);
  assert.match(app, /updateKycStep\(kycCustomSteps\(\)/);
  assert.match(app, /simulateKycSequence\(state\.design,kycSeqSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.kycSeqMode='custom';kycCustomSteps\(\)/);
  assert.match(app, /state\.kycSeqPreset=target\.dataset\.kycSeqPreset;state\.kycSeqMode='preset'/);
  assert.match(app, /state\.kycSeqMode='preset';state\.kycSeqCustom=null/);
  // The builder explains the kind conversion and keeps the module-only boundary.
  assert.match(app, /Switching a step's kind converts it/);
  assert.match(app, /no on-chain allowlist is consulted/);
});
