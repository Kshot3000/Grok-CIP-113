import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTimelineFile, parseTimelineFile, verifyTimelineFile, diffTimelineFile, TIMELINE_FILE_NOTE } from '../src/domain.js';

const STEPS = [
  { kind:'supply', action:'mint', actor:'issuer', amount:'50000' },
  { kind:'transfer', from:'issuer', to:'approved', amount:'10000' },
  { kind:'supply', action:'burn', actor:'issuer', amount:'30000' },
  { kind:'transfer', from:'approved', to:'pending', amount:'100' },
];
const raw = (over={}) => JSON.stringify({ ...makeTimelineFile(STEPS), ...over });

test('export builds the canonical timeline scenario file: steps only, no design, no supply, no balances, no result', () => {
  const f = makeTimelineFile(STEPS);
  assert.equal(f.kind, 'prism.timeline');
  assert.equal(f.version, 1);
  assert.equal(f.status, 'local-simulation-only');
  assert.deepEqual(f.steps, STEPS);
  assert.equal(f.note, TIMELINE_FILE_NOTE);
  assert.deepEqual(Object.keys(f), ['kind','version','status','steps','note']);
  // The file is deterministic: exporting the same steps twice is identical.
  assert.equal(JSON.stringify(makeTimelineFile(STEPS)), JSON.stringify(f));
});

test('export refuses a step list the studio builder itself would refuse', () => {
  assert.throws(() => makeTimelineFile([]), /between 1 and 12/);
  assert.throws(() => makeTimelineFile(Array.from({length:13}, () => ({...STEPS[0]}))), /between 1 and 12/);
  assert.throws(() => makeTimelineFile([{ kind:'transfer', from:'issuer', to:'treasury', amount:'1' }]), /modeled ledger accounts/);
  assert.throws(() => makeTimelineFile([{ kind:'supply', action:'issue', actor:'issuer', amount:'1' }]), /mint or a burn/);
  assert.throws(() => makeTimelineFile([{ kind:'transfer', from:'issuer', to:'approved', amount:100 }]), /decimal string/);
  assert.throws(() => makeTimelineFile([{ from:'issuer', to:'approved', amount:'1' }]), /transfer or a supply change/);
  assert.throws(() => makeTimelineFile([{ kind:'pause', amount:'1' }]), /transfer or a supply change/);
  assert.throws(() => makeTimelineFile('nope'), /between 1 and 12/);
});

test('export returns fresh copies — mutating the file cannot reach the source steps', () => {
  const src = STEPS.map(s => ({...s}));
  const f = makeTimelineFile(src);
  f.steps[1].amount = '999';
  assert.equal(src[1].amount, '10000');
});

test('round-trip: parse(export(steps)) is the canonical file, exactly', () => {
  const f = makeTimelineFile(STEPS);
  assert.deepEqual(parseTimelineFile(JSON.stringify(f, null, 2)), f);
});

test('parse refuses non-JSON, the wrong kind or version, and oversize files', () => {
  assert.throws(() => parseTimelineFile('{nope'), /not valid JSON/);
  assert.throws(() => parseTimelineFile(raw({ kind:'prism.supply-sequence' })), /not a supported PRISM timeline/);
  assert.throws(() => parseTimelineFile(raw({ kind:'prism.transfer-sequence' })), /not a supported PRISM timeline/);
  assert.throws(() => parseTimelineFile(raw({ version:2 })), /not a supported PRISM timeline/);
  assert.throws(() => parseTimelineFile('x'.repeat(100001)), /under 100 KB/);
  assert.throws(() => parseTimelineFile(42), /under 100 KB/);
});

test('parse refuses a smuggled top-level field — claimed balances are the claim this check exists to refuse', () => {
  assert.throws(() => parseTimelineFile(raw({ result:{ appliedCount:4 } })), /unexpected top-level field \(result\)/);
  assert.throws(() => parseTimelineFile(raw({ balances:{ issuer:'1000' } })), /unexpected top-level field \(balances\)/);
  assert.throws(() => parseTimelineFile(raw({ supply:'1200000' })), /unexpected top-level field \(supply\)/);
  assert.throws(() => parseTimelineFile(raw({ design:{ ticker:'X' } })), /unexpected top-level field \(design\)/);
});

test('parse refuses a status claiming execution, and a tampered note', () => {
  assert.throws(() => parseTimelineFile(raw({ status:'executed-on-chain' })), /status other than local-simulation-only/);
  assert.throws(() => parseTimelineFile(raw({ note:'These steps were executed.' })), /note does not match/);
});

test('hand-trimmed files may omit status or note — absent is tolerated, and canonicalised on return', () => {
  const trimmed = makeTimelineFile(STEPS);
  delete trimmed.status; delete trimmed.note;
  const parsed = parseTimelineFile(JSON.stringify(trimmed));
  assert.equal(parsed.status, 'local-simulation-only');
  assert.equal(parsed.note, TIMELINE_FILE_NOTE);
  assert.deepEqual(parsed.steps, STEPS);
});

test('parse refuses a step carrying the other kind\u2019s field — a transfer step never names an action', () => {
  const transferWithAction = makeTimelineFile(STEPS); transferWithAction.steps[1] = { ...transferWithAction.steps[1], action:'mint' };
  assert.throws(() => parseTimelineFile(JSON.stringify(transferWithAction)), /step 2 has an unexpected field \(action\)/);
  const supplyWithFrom = makeTimelineFile(STEPS); supplyWithFrom.steps[0] = { ...supplyWithFrom.steps[0], from:'issuer' };
  assert.throws(() => parseTimelineFile(JSON.stringify(supplyWithFrom)), /step 1 has an unexpected field \(from\)/);
  const signed = makeTimelineFile(STEPS); signed.steps[2] = { ...signed.steps[2], signed:true };
  assert.throws(() => parseTimelineFile(JSON.stringify(signed)), /step 3 has an unexpected field \(signed\)/);
});

test('parse refuses a step with no kind or an unknown kind, an unknown account or action, or a numeric amount', () => {
  const noKind = makeTimelineFile(STEPS); noKind.steps[0] = { action:'mint', actor:'issuer', amount:'1' };
  assert.throws(() => parseTimelineFile(JSON.stringify(noKind)), /step 1 must be a transfer or a supply change/);
  const badKind = makeTimelineFile(STEPS); badKind.steps[0] = { kind:'pause', amount:'1' };
  assert.throws(() => parseTimelineFile(JSON.stringify(badKind)), /step 1 must be a transfer or a supply change/);
  const badAccount = makeTimelineFile(STEPS); badAccount.steps[1] = { kind:'transfer', from:'issuer', to:'treasury', amount:'1' };
  assert.throws(() => parseTimelineFile(JSON.stringify(badAccount)), /modeled ledger accounts/);
  const badAction = makeTimelineFile(STEPS); badAction.steps[0] = { kind:'supply', action:'issue', actor:'issuer', amount:'1' };
  assert.throws(() => parseTimelineFile(JSON.stringify(badAction)), /mint or a burn/);
  const numeric = makeTimelineFile(STEPS); numeric.steps[1] = { kind:'transfer', from:'issuer', to:'approved', amount:100 };
  assert.throws(() => parseTimelineFile(JSON.stringify(numeric)), /decimal string/);
  assert.throws(() => parseTimelineFile(raw({ steps:'none' })), /missing its steps/);
  assert.throws(() => parseTimelineFile(raw({ steps:[null] })), /step 1 must describe/);
});

test('verify reports the steps the file describes, both kinds counted, and nothing applicable', () => {
  const v = verifyTimelineFile(raw());
  assert.equal(v.stepCount, 4);
  assert.deepEqual(v.steps, STEPS);
  assert.deepEqual(v.kinds, ['supply','transfer']);
  assert.equal(v.transferCount, 2);
  assert.equal(v.supplyCount, 2);
  assert.equal(v.design, undefined);
  assert.equal(v.balances, undefined);
  assert.equal(v.supply, undefined);
  assert.equal(v.result, undefined);
});

test('verify refuses a file that would fail reading back, with the reader\u2019s own reason', () => {
  assert.throws(() => verifyTimelineFile(raw({ status:'settled' })), /status other than local-simulation-only/);
});

test('diff of the same timeline is identical, compared position by position', () => {
  const d = diffTimelineFile(raw(), STEPS);
  assert.equal(d.same, true);
  assert.equal(d.compared, 4);
  assert.deepEqual(d.differences, []);
  assert.equal(d.fileStepCount, 4);
  assert.equal(d.currentStepCount, 4);
});

test('diff names a changed amount at its position, and only there', () => {
  const changed = STEPS.map(s => ({...s})); changed[1] = { ...changed[1], amount:'10001' };
  const d = diffTimelineFile(JSON.stringify(makeTimelineFile(changed)), STEPS);
  assert.equal(d.same, false);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 2);
  assert.equal(d.differences[0].file.amount, '10001');
  assert.equal(d.differences[0].current.amount, '10000');
});

test('diff states a kind change as a difference even where the amounts agree', () => {
  const kindChanged = STEPS.map(s => ({...s}));
  kindChanged[1] = { kind:'supply', action:'mint', actor:'issuer', amount:'10000' };
  const d = diffTimelineFile(JSON.stringify(makeTimelineFile(kindChanged)), STEPS);
  assert.equal(d.same, false);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 2);
  assert.equal(d.differences[0].file.kind, 'supply');
  assert.equal(d.differences[0].current.kind, 'transfer');
});

test('diff states a step present on only one side as a difference against nothing', () => {
  const longer = [...STEPS, { kind:'transfer', from:'issuer', to:'approved', amount:'5' }];
  const d = diffTimelineFile(JSON.stringify(makeTimelineFile(longer)), STEPS);
  assert.equal(d.compared, 5);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 5);
  assert.equal(d.differences[0].current, null);
  assert.equal(d.differences[0].file.amount, '5');
  const shorter = diffTimelineFile(raw(), longer);
  assert.equal(shorter.differences[0].file, null);
});

test('a reordering is a difference — a timeline is its order', () => {
  const reordered = [STEPS[1], STEPS[0], STEPS[2], STEPS[3]];
  const d = diffTimelineFile(JSON.stringify(makeTimelineFile(reordered)), STEPS);
  assert.equal(d.same, false);
  assert.deepEqual(d.differences.map(x => x.step), [1, 2]);
});

test('diff refuses an invalid file whole, and names an invalid current timeline as the current side\u2019s fault', () => {
  assert.throws(() => diffTimelineFile(raw({ status:'executed-on-chain' }), STEPS), /status other than local-simulation-only/);
  assert.throws(() => diffTimelineFile(raw(), []), /timeline you have open cannot be compared yet/);
  assert.throws(() => diffTimelineFile(raw(), [{ kind:'transfer', from:'issuer', to:'nobody', amount:'1' }]), /timeline you have open cannot be compared yet/);
});

test('amounts stay exact strings through the file — a past-2^53 amount is never rounded', () => {
  const big = [{ kind:'supply', action:'mint', actor:'issuer', amount:'9007199254740993' }];
  const parsed = parseTimelineFile(JSON.stringify(makeTimelineFile(big)));
  assert.equal(parsed.steps[0].amount, '9007199254740993');
});
