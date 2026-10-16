import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSupplySequenceFile, parseSupplySequenceFile, verifySupplySequenceFile, diffSupplySequenceFile, SUPPLY_SEQUENCE_FILE_NOTE } from '../src/domain.js';

const STEPS = [
  { action:'mint', actor:'issuer', amount:'250000' },
  { action:'burn', actor:'issuer', amount:'100000' },
  { action:'mint', actor:'other', amount:'50000' },
];
const raw = (over={}) => JSON.stringify({ ...makeSupplySequenceFile(STEPS), ...over });

test('export builds the canonical supply scenario file: steps only, no design, no supply, no result', () => {
  const f = makeSupplySequenceFile(STEPS);
  assert.equal(f.kind, 'prism.supply-sequence');
  assert.equal(f.version, 1);
  assert.equal(f.status, 'local-simulation-only');
  assert.deepEqual(f.steps, STEPS);
  assert.equal(f.note, SUPPLY_SEQUENCE_FILE_NOTE);
  assert.deepEqual(Object.keys(f), ['kind','version','status','steps','note']);
  // The file is deterministic: exporting the same steps twice is identical.
  assert.equal(JSON.stringify(makeSupplySequenceFile(STEPS)), JSON.stringify(f));
});

test('export refuses a step list the studio builder itself would refuse', () => {
  assert.throws(() => makeSupplySequenceFile([]), /between 1 and 12/);
  assert.throws(() => makeSupplySequenceFile(Array.from({length:13}, () => ({...STEPS[0]}))), /between 1 and 12/);
  assert.throws(() => makeSupplySequenceFile([{ action:'issue', actor:'issuer', amount:'1' }]), /mint or a burn/);
  assert.throws(() => makeSupplySequenceFile([{ action:'mint', actor:'treasury', amount:'1' }]), /issuer or by someone else/);
  assert.throws(() => makeSupplySequenceFile([{ action:'mint', actor:'issuer', amount:100 }]), /decimal string/);
  assert.throws(() => makeSupplySequenceFile('nope'), /between 1 and 12/);
});

test('export returns fresh copies — mutating the file cannot reach the source steps', () => {
  const src = STEPS.map(s => ({...s}));
  const f = makeSupplySequenceFile(src);
  f.steps[0].amount = '999';
  assert.equal(src[0].amount, '250000');
});

test('round-trip: parse(export(steps)) is the canonical file, exactly', () => {
  const f = makeSupplySequenceFile(STEPS);
  assert.deepEqual(parseSupplySequenceFile(JSON.stringify(f, null, 2)), f);
});

test('parse refuses non-JSON, the wrong kind or version, and oversize files', () => {
  assert.throws(() => parseSupplySequenceFile('{nope'), /not valid JSON/);
  assert.throws(() => parseSupplySequenceFile(raw({ kind:'prism.transfer-sequence' })), /not a supported PRISM supply-sequence/);
  assert.throws(() => parseSupplySequenceFile(raw({ version:2 })), /not a supported PRISM supply-sequence/);
  assert.throws(() => parseSupplySequenceFile('x'.repeat(100001)), /under 100 KB/);
  assert.throws(() => parseSupplySequenceFile(42), /under 100 KB/);
});

test('parse refuses a smuggled top-level field — a claimed supply is the claim this check exists to refuse', () => {
  assert.throws(() => parseSupplySequenceFile(raw({ result:{ appliedCount:3 } })), /unexpected top-level field \(result\)/);
  assert.throws(() => parseSupplySequenceFile(raw({ supply:'1200000' })), /unexpected top-level field \(supply\)/);
  assert.throws(() => parseSupplySequenceFile(raw({ apiEndpoint:'https://example.invalid' })), /unexpected top-level field \(apiEndpoint\)/);
  assert.throws(() => parseSupplySequenceFile(raw({ design:{ ticker:'X' } })), /unexpected top-level field \(design\)/);
});

test('parse refuses a status claiming execution, and a tampered note', () => {
  assert.throws(() => parseSupplySequenceFile(raw({ status:'minted-on-chain' })), /status other than local-simulation-only/);
  assert.throws(() => parseSupplySequenceFile(raw({ note:'These tokens were minted.' })), /note does not match/);
});

test('hand-trimmed files may omit status or note — absent is tolerated, and canonicalised on return', () => {
  const trimmed = makeSupplySequenceFile(STEPS);
  delete trimmed.status; delete trimmed.note;
  const parsed = parseSupplySequenceFile(JSON.stringify(trimmed));
  assert.equal(parsed.status, 'local-simulation-only');
  assert.equal(parsed.note, SUPPLY_SEQUENCE_FILE_NOTE);
  assert.deepEqual(parsed.steps, STEPS);
});

test('parse refuses steps with an unexpected field, an unknown action or actor, or a numeric amount', () => {
  const withField = makeSupplySequenceFile(STEPS); withField.steps[1] = { ...withField.steps[1], signed:true };
  assert.throws(() => parseSupplySequenceFile(JSON.stringify(withField)), /step 2 has an unexpected field \(signed\)/);
  const badAction = makeSupplySequenceFile(STEPS); badAction.steps[0] = { action:'issue', actor:'issuer', amount:'1' };
  assert.throws(() => parseSupplySequenceFile(JSON.stringify(badAction)), /mint or a burn/);
  const badActor = makeSupplySequenceFile(STEPS); badActor.steps[0] = { action:'mint', actor:'treasury', amount:'1' };
  assert.throws(() => parseSupplySequenceFile(JSON.stringify(badActor)), /issuer or by someone else/);
  const numeric = makeSupplySequenceFile(STEPS); numeric.steps[0] = { action:'mint', actor:'issuer', amount:100 };
  assert.throws(() => parseSupplySequenceFile(JSON.stringify(numeric)), /decimal string/);
  assert.throws(() => parseSupplySequenceFile(raw({ steps:'none' })), /missing its steps/);
  assert.throws(() => parseSupplySequenceFile(raw({ steps:[null] })), /step 1 must describe/);
});

test('verify reports the steps the file describes and nothing applicable', () => {
  const v = verifySupplySequenceFile(raw());
  assert.equal(v.stepCount, 3);
  assert.deepEqual(v.steps, STEPS);
  assert.deepEqual(v.actions, ['mint','burn']);
  assert.deepEqual(v.actors, ['issuer','other']);
  assert.equal(v.design, undefined);
  assert.equal(v.supply, undefined);
  assert.equal(v.result, undefined);
});

test('verify refuses a file that would fail reading back, with the reader\u2019s own reason', () => {
  assert.throws(() => verifySupplySequenceFile(raw({ status:'settled' })), /status other than local-simulation-only/);
});

test('diff of the same sequence is identical, compared position by position', () => {
  const d = diffSupplySequenceFile(raw(), STEPS);
  assert.equal(d.same, true);
  assert.equal(d.compared, 3);
  assert.deepEqual(d.differences, []);
  assert.equal(d.fileStepCount, 3);
  assert.equal(d.currentStepCount, 3);
});

test('diff names a changed amount at its position, and only there', () => {
  const changed = STEPS.map(s => ({...s})); changed[1] = { ...changed[1], amount:'100001' };
  const d = diffSupplySequenceFile(JSON.stringify(makeSupplySequenceFile(changed)), STEPS);
  assert.equal(d.same, false);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 2);
  assert.equal(d.differences[0].file.amount, '100001');
  assert.equal(d.differences[0].current.amount, '100000');
});

test('diff states a step present on only one side as a difference against nothing', () => {
  const longer = [...STEPS, { action:'burn', actor:'issuer', amount:'5' }];
  const d = diffSupplySequenceFile(JSON.stringify(makeSupplySequenceFile(longer)), STEPS);
  assert.equal(d.compared, 4);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 4);
  assert.equal(d.differences[0].current, null);
  assert.equal(d.differences[0].file.amount, '5');
  const shorter = diffSupplySequenceFile(raw(), longer);
  assert.equal(shorter.differences[0].file, null);
});

test('a reordering is a difference — a sequence is its order', () => {
  const reordered = [STEPS[1], STEPS[0], STEPS[2]];
  const d = diffSupplySequenceFile(JSON.stringify(makeSupplySequenceFile(reordered)), STEPS);
  assert.equal(d.same, false);
  assert.deepEqual(d.differences.map(x => x.step), [1, 2]);
});

test('diff refuses an invalid file whole, and names an invalid current sequence as the current side\u2019s fault', () => {
  assert.throws(() => diffSupplySequenceFile(raw({ status:'minted-on-chain' }), STEPS), /status other than local-simulation-only/);
  assert.throws(() => diffSupplySequenceFile(raw(), []), /supply sequence you have open cannot be compared yet/);
  assert.throws(() => diffSupplySequenceFile(raw(), [{ action:'mint', actor:'nobody', amount:'1' }]), /supply sequence you have open cannot be compared yet/);
});

test('amounts stay exact strings through the file — a past-2^53 amount is never rounded', () => {
  const big = [{ action:'mint', actor:'issuer', amount:'9007199254740993' }];
  const parsed = parseSupplySequenceFile(JSON.stringify(makeSupplySequenceFile(big)));
  assert.equal(parsed.steps[0].amount, '9007199254740993');
});
