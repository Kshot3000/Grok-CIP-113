import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTransferSequenceFile, parseTransferSequenceFile, verifyTransferSequenceFile, diffTransferSequenceFile, TRANSFER_SEQUENCE_FILE_NOTE } from '../src/domain.js';

const STEPS = [
  { from:'issuer', to:'approved', amount:'100' },
  { from:'approved', to:'pending', amount:'40' },
  { from:'approved', to:'blocked', amount:'10.5' },
];
const raw = (over={}) => JSON.stringify({ ...makeTransferSequenceFile(STEPS), ...over });

test('export builds the canonical scenario file: steps only, no design, no result', () => {
  const f = makeTransferSequenceFile(STEPS);
  assert.equal(f.kind, 'prism.transfer-sequence');
  assert.equal(f.version, 1);
  assert.equal(f.status, 'local-simulation-only');
  assert.deepEqual(f.steps, STEPS);
  assert.equal(f.note, TRANSFER_SEQUENCE_FILE_NOTE);
  assert.deepEqual(Object.keys(f), ['kind','version','status','steps','note']);
  // The file is deterministic: exporting the same steps twice is identical.
  assert.equal(JSON.stringify(makeTransferSequenceFile(STEPS)), JSON.stringify(f));
});

test('export refuses a step list the studio builder itself would refuse', () => {
  assert.throws(() => makeTransferSequenceFile([]), /between 1 and 12/);
  assert.throws(() => makeTransferSequenceFile(Array.from({length:13}, () => ({...STEPS[0]}))), /between 1 and 12/);
  assert.throws(() => makeTransferSequenceFile([{ from:'issuer', to:'stranger', amount:'1' }]), /modeled ledger accounts/);
  assert.throws(() => makeTransferSequenceFile([{ from:'issuer', to:'approved', amount:100 }]), /decimal string/);
  assert.throws(() => makeTransferSequenceFile('nope'), /between 1 and 12/);
});

test('export returns fresh copies — mutating the file cannot reach the source steps', () => {
  const src = STEPS.map(s => ({...s}));
  const f = makeTransferSequenceFile(src);
  f.steps[0].amount = '999';
  assert.equal(src[0].amount, '100');
});

test('round-trip: parse(export(steps)) is the canonical file, exactly', () => {
  const f = makeTransferSequenceFile(STEPS);
  assert.deepEqual(parseTransferSequenceFile(JSON.stringify(f, null, 2)), f);
});

test('parse refuses non-JSON, the wrong kind or version, and oversize files', () => {
  assert.throws(() => parseTransferSequenceFile('{nope'), /not valid JSON/);
  assert.throws(() => parseTransferSequenceFile(raw({ kind:'prism.cip113-design' })), /not a supported PRISM transfer-sequence/);
  assert.throws(() => parseTransferSequenceFile(raw({ version:2 })), /not a supported PRISM transfer-sequence/);
  assert.throws(() => parseTransferSequenceFile('x'.repeat(100001)), /under 100 KB/);
  assert.throws(() => parseTransferSequenceFile(42), /under 100 KB/);
});

test('parse refuses a smuggled top-level field — a claimed result is the claim this check exists to refuse', () => {
  assert.throws(() => parseTransferSequenceFile(raw({ result:{ appliedCount:3 } })), /unexpected top-level field \(result\)/);
  assert.throws(() => parseTransferSequenceFile(raw({ balances:{ issuer:'0' } })), /unexpected top-level field \(balances\)/);
  assert.throws(() => parseTransferSequenceFile(raw({ apiEndpoint:'https://example.invalid' })), /unexpected top-level field \(apiEndpoint\)/);
  assert.throws(() => parseTransferSequenceFile(raw({ design:{ ticker:'X' } })), /unexpected top-level field \(design\)/);
});

test('parse refuses a status claiming execution, and a tampered note', () => {
  assert.throws(() => parseTransferSequenceFile(raw({ status:'executed-on-chain' })), /status other than local-simulation-only/);
  assert.throws(() => parseTransferSequenceFile(raw({ note:'These transfers were submitted.' })), /note does not match/);
});

test('hand-trimmed files may omit status or note — absent is tolerated, and canonicalised on return', () => {
  const trimmed = makeTransferSequenceFile(STEPS);
  delete trimmed.status; delete trimmed.note;
  const parsed = parseTransferSequenceFile(JSON.stringify(trimmed));
  assert.equal(parsed.status, 'local-simulation-only');
  assert.equal(parsed.note, TRANSFER_SEQUENCE_FILE_NOTE);
  assert.deepEqual(parsed.steps, STEPS);
});

test('parse refuses steps with an unexpected field, an unknown account, or a numeric amount', () => {
  const withField = makeTransferSequenceFile(STEPS); withField.steps[1] = { ...withField.steps[1], signed:true };
  assert.throws(() => parseTransferSequenceFile(JSON.stringify(withField)), /step 2 has an unexpected field \(signed\)/);
  const badAccount = makeTransferSequenceFile(STEPS); badAccount.steps[0] = { from:'issuer', to:'treasury', amount:'1' };
  assert.throws(() => parseTransferSequenceFile(JSON.stringify(badAccount)), /modeled ledger accounts/);
  const numeric = makeTransferSequenceFile(STEPS); numeric.steps[0] = { from:'issuer', to:'approved', amount:100 };
  assert.throws(() => parseTransferSequenceFile(JSON.stringify(numeric)), /decimal string/);
  assert.throws(() => parseTransferSequenceFile(raw({ steps:'none' })), /missing its steps/);
  assert.throws(() => parseTransferSequenceFile(raw({ steps:[null] })), /step 1 must describe/);
});

test('verify reports the steps the file describes and nothing applicable', () => {
  const v = verifyTransferSequenceFile(raw());
  assert.equal(v.stepCount, 3);
  assert.deepEqual(v.steps, STEPS);
  assert.deepEqual(v.senders, ['issuer','approved']);
  assert.deepEqual(v.recipients, ['approved','pending','blocked']);
  assert.equal(v.design, undefined);
  assert.equal(v.result, undefined);
});

test('verify refuses a file that would fail reading back, with the reader\u2019s own reason', () => {
  assert.throws(() => verifyTransferSequenceFile(raw({ status:'settled' })), /status other than local-simulation-only/);
});

test('diff of the same sequence is identical, compared position by position', () => {
  const d = diffTransferSequenceFile(raw(), STEPS);
  assert.equal(d.same, true);
  assert.equal(d.compared, 3);
  assert.deepEqual(d.differences, []);
  assert.equal(d.fileStepCount, 3);
  assert.equal(d.currentStepCount, 3);
});

test('diff names a changed amount at its position, and only there', () => {
  const changed = STEPS.map(s => ({...s})); changed[1] = { ...changed[1], amount:'41' };
  const d = diffTransferSequenceFile(JSON.stringify(makeTransferSequenceFile(changed)), STEPS);
  assert.equal(d.same, false);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 2);
  assert.equal(d.differences[0].file.amount, '41');
  assert.equal(d.differences[0].current.amount, '40');
});

test('diff states a step present on only one side as a difference against nothing', () => {
  const longer = [...STEPS, { from:'issuer', to:'blocked', amount:'5' }];
  const d = diffTransferSequenceFile(JSON.stringify(makeTransferSequenceFile(longer)), STEPS);
  assert.equal(d.compared, 4);
  assert.equal(d.differences.length, 1);
  assert.equal(d.differences[0].step, 4);
  assert.equal(d.differences[0].current, null);
  assert.equal(d.differences[0].file.amount, '5');
  const shorter = diffTransferSequenceFile(raw(), longer);
  assert.equal(shorter.differences[0].file, null);
});

test('a reordering is a difference — a sequence is its order', () => {
  const reordered = [STEPS[1], STEPS[0], STEPS[2]];
  const d = diffTransferSequenceFile(JSON.stringify(makeTransferSequenceFile(reordered)), STEPS);
  assert.equal(d.same, false);
  assert.deepEqual(d.differences.map(x => x.step), [1, 2]);
});

test('diff refuses an invalid file whole, and names an invalid current sequence as the current side\u2019s fault', () => {
  assert.throws(() => diffTransferSequenceFile(raw({ status:'executed-on-chain' }), STEPS), /status other than local-simulation-only/);
  assert.throws(() => diffTransferSequenceFile(raw(), []), /sequence you have open cannot be compared yet/);
  assert.throws(() => diffTransferSequenceFile(raw(), [{ from:'issuer', to:'nobody', amount:'1' }]), /sequence you have open cannot be compared yet/);
});

test('amounts stay exact strings through the file — a past-2^53 amount is never rounded', () => {
  const big = [{ from:'issuer', to:'approved', amount:'9007199254740993' }];
  const parsed = parseTransferSequenceFile(JSON.stringify(makeTransferSequenceFile(big)));
  assert.equal(parsed.steps[0].amount, '9007199254740993');
});
