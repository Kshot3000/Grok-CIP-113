import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransferOutputValue, verifyTransferOutputs, MAX_ASSET } from '../src/domain.js';

// CIP-113 TransferAct output-value calculation, per the spec's
// "Output Value Calculation": the expected output value at
// programmableLogicBase addresses is the sum of validated input
// programmable token value plus validated mint value.
const A = 'aa'.repeat(28);
const B = 'bb'.repeat(28);
const C = 'cc'.repeat(28); // never validated in the base model
const N1 = '01';
const N2 = '02';
const e = (policy, assetName, quantity) => ({ policy, assetName, quantity });
const base = (over = {}) => ({
  validatedPolicies: [A, B],
  inputs: [e(A, N1, '100'), e(B, N1, '40')],
  mint: [],
  ...over,
});
const out = (policy, assetName, quantity, atBase = true) => ({ policy, assetName, quantity, atBase });

test("the spec's own examples: partial burn and mint during transfer", () => {
  const burn = planTransferOutputValue(base({ mint: [e(A, N1, '-30')] }));
  assert.equal(burn.status, 'planned');
  assert.equal(burn.entries.find(x => x.policy === A).expectedQuantity, '70');
  const mint = planTransferOutputValue(base({ mint: [e(A, N1, '50')] }));
  assert.equal(mint.entries.find(x => x.policy === A).expectedQuantity, '150');
  // B is untouched by either mint and keeps its input as its expectation.
  assert.equal(mint.entries.find(x => x.policy === B).expectedQuantity, '40');
});

test('input quantities sum per asset across spent UTxOs; entries are ordered by policy then name', () => {
  const p = planTransferOutputValue(base({
    inputs: [e(B, N2, '5'), e(A, N1, '60'), e(A, N1, '40'), e(A, N2, '7')],
    mint: [],
  }));
  assert.deepEqual(p.entries.map(x => [x.policy, x.assetName, x.inputQuantity]), [
    [A, N1, '100'], [A, N2, '7'], [B, N2, '5'],
  ]);
});

test('a mint-only asset expects exactly its mint — mint value folds into the same accumulator', () => {
  const p = planTransferOutputValue(base({ inputs: [], mint: [e(A, N2, '25')] }));
  assert.deepEqual(p.entries, [{ policy: A, assetName: N2, inputQuantity: '0', mintQuantity: '25', expectedQuantity: '25' }]);
});

test('only validated policies enter the accumulator — unvalidated input and mint are excluded, not counted', () => {
  const p = planTransferOutputValue(base({
    inputs: [e(A, N1, '100'), e(C, N1, '999')],
    mint: [e(C, N1, '888')],
  }));
  assert.deepEqual(p.entries.map(x => x.policy), [A]);
  assert.deepEqual(p.excluded, [{ policy: C, assetName: N1, inputQuantity: '999', mintQuantity: '888' }]);
});

test('arithmetic is BigInt-exact past 2^53', () => {
  const big = (MAX_ASSET - 10n).toString();
  const p = planTransferOutputValue(base({ inputs: [e(A, N1, big)], mint: [e(A, N1, '10')] }));
  assert.equal(p.entries[0].expectedQuantity, MAX_ASSET.toString());
});

test('a burn past the validated input is unplannable, with the negative arithmetic shown, never clipped', () => {
  const p = planTransferOutputValue(base({ mint: [e(A, N1, '-150')] }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['burn-exceeds-input']);
  assert.deepEqual(p.impossible, [{ policy: A, assetName: N1, expectedQuantity: '-50' }]);
  assert.equal(p.entries.find(x => x.policy === A).expectedQuantity, '-50');
  // Burning exactly the input is plannable and expects zero at base.
  const exact = planTransferOutputValue(base({ mint: [e(A, N1, '-100')] }));
  assert.equal(exact.status, 'planned');
  assert.equal(exact.entries.find(x => x.policy === A).expectedQuantity, '0');
});

test('a modeled value that cannot be read is refused, never planned in part', () => {
  assert.throws(() => planTransferOutputValue(base({ validatedPolicies: [A, A] })), /more than once/);
  assert.throws(() => planTransferOutputValue(base({ validatedPolicies: ['zz'.repeat(28)] })), /28-byte policy ID/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, N1, '1.5')] })), /whole-number/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, N1, '-5')] })), /whole-number/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, N1, '0')] })), /does not list an asset it holds none of/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, N1, 100)] })), /decimal string/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, N1, (MAX_ASSET + 1n).toString())] })), /64-bit asset ceiling/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, '0', '5')] })), /even number of hexadecimal/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [e(A, 'ab'.repeat(33), '5')] })), /at most 32 bytes/);
  assert.throws(() => planTransferOutputValue(base({ mint: [e(A, N1, '0')] })), /zero entry is not an entry/);
  // tx.mint is a value map: the same asset twice cannot be read as one mint.
  assert.throws(() => planTransferOutputValue(base({ mint: [e(A, N1, '5'), e(A, N1, '6')] })), /value map/);
  assert.throws(() => planTransferOutputValue({ ...base(), extra: 1 }), /unknown field "extra"/);
  assert.throws(() => planTransferOutputValue(base({ inputs: [{ ...e(A, N1, '5'), note: 'x' }] })), /unknown field "note"/);
});

test('planning does not mutate the modeled lists it was given', () => {
  const input = base({ mint: [e(A, N1, '-30')] });
  const snapshot = JSON.parse(JSON.stringify(input));
  planTransferOutputValue(input);
  assert.deepEqual(input, snapshot);
});

test('outputs meeting the expected value exactly verify, summed across base outputs', () => {
  const model = base({ mint: [e(A, N1, '-30')] }); // A expects 70, B expects 40
  const v = verifyTransferOutputs(model, [out(A, N1, '50'), out(A, N1, '20'), out(B, N1, '40')]);
  assert.equal(v.status, 'correct');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts.map(x => [x.meetsExpected, x.escaped]), [[true, false], [true, false]]);
});

test('the delegate floor is AT LEAST: a surplus at base passes and is reported, not failed', () => {
  const v = verifyTransferOutputs(base(), [out(A, N1, '130'), out(B, N1, '40')]);
  assert.equal(v.valid, true);
  const a = v.verdicts.find(x => x.policy === A);
  assert.equal(a.surplusQuantity, '30');
  assert.equal(a.shortfallQuantity, '0');
});

test('a shortfall fails that asset alone and names the missing amount', () => {
  const v = verifyTransferOutputs(base(), [out(A, N1, '90'), out(B, N1, '40')]);
  assert.equal(v.status, 'incorrect');
  const a = v.verdicts.find(x => x.policy === A);
  assert.equal(a.meetsExpected, false);
  assert.equal(a.shortfallQuantity, '10');
  assert.equal(v.verdicts.find(x => x.policy === B).meetsExpected, true);
  // An expected asset absent from the outputs is a base total of zero.
  const gone = verifyTransferOutputs(base(), [out(B, N1, '40')]);
  assert.equal(gone.verdicts.find(x => x.policy === A).shortfallQuantity, '100');
});

test('a validated asset in a non-base output has escaped — it fails even when the floor is met', () => {
  const v = verifyTransferOutputs(base(), [out(A, N1, '100'), out(A, N1, '5', false), out(B, N1, '40')]);
  assert.equal(v.status, 'incorrect');
  const a = v.verdicts.find(x => x.policy === A);
  assert.equal(a.meetsExpected, true);
  assert.equal(a.escaped, true);
  assert.equal(a.nonBaseOutputQuantity, '5');
  // The same move for an UNvalidated policy is an ordinary token moving ordinarily.
  const ordinary = verifyTransferOutputs(base(), [out(A, N1, '100'), out(B, N1, '40'), out(C, N1, '9', false)]);
  assert.equal(ordinary.valid, true);
  assert.deepEqual(ordinary.excludedOutputs, [{ policy: C, assetName: N1, quantity: '9' }]);
});

test('a validated asset in the outputs that nothing expected is reported as unexpected, with its escape judged', () => {
  const v = verifyTransferOutputs(base(), [out(A, N1, '100'), out(B, N1, '40'), out(B, N2, '3')]);
  assert.equal(v.valid, true); // at base, expected 0 — surplus, not a failure of this check
  const extra = v.verdicts.find(x => x.assetName === N2);
  assert.equal(extra.unexpected, true);
  assert.equal(extra.expectedQuantity, '0');
  assert.equal(extra.surplusQuantity, '3');
  const escaped = verifyTransferOutputs(base(), [out(A, N1, '100'), out(B, N1, '40'), out(B, N2, '3', false)]);
  assert.equal(escaped.valid, false);
  assert.equal(escaped.verdicts.find(x => x.assetName === N2).escaped, true);
});

test('a claim against an unplannable transfer is reported unplannable, with no verdict scored', () => {
  const v = verifyTransferOutputs(base({ mint: [e(A, N1, '-150')] }), [out(A, N1, '1')]);
  assert.equal(v.status, 'unplannable');
  assert.equal(v.valid, false);
  assert.equal(v.verdicts, null);
  assert.deepEqual(v.impossible, [{ policy: A, assetName: N1, expectedQuantity: '-50' }]);
});

test('a claimed output that cannot be read is refused, never scored', () => {
  assert.throws(() => verifyTransferOutputs(base(), [out(A, N1, '1.5')]), /whole-number/);
  assert.throws(() => verifyTransferOutputs(base(), [{ policy: A, assetName: N1, quantity: '5' }]), /as a boolean/);
  assert.throws(() => verifyTransferOutputs(base(), [{ ...out(A, N1, '5'), datum: 'x' }]), /unknown field "datum"/);
});

test("the verifier's expected values are the planner's own output across a grid", () => {
  const models = [
    base(),
    base({ mint: [e(A, N1, '-100'), e(B, N1, '60')] }),
    base({ inputs: [], mint: [e(B, N2, '12')] }),
    base({ inputs: [e(A, N2, '3'), e(A, N1, '4')], mint: [e(A, N2, '-3')] }),
  ];
  for (const model of models) {
    const p = planTransferOutputValue(model);
    assert.equal(p.status, 'planned');
    const exact = p.entries.filter(x => BigInt(x.expectedQuantity) > 0n).map(x => out(x.policy, x.assetName, x.expectedQuantity));
    const v = verifyTransferOutputs(model, exact);
    assert.equal(v.valid, true);
    assert.deepEqual(v.verdicts.filter(x => !x.unexpected).map(x => x.expectedQuantity), p.entries.map(x => x.expectedQuantity));
  }
});
