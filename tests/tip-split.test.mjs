import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelTipSplit, modelTip } from '../src/domain.js';

// Tip split model (v1.269): the tip axis's second moment —
// the stated tip from modelTip divided among stated
// recipients by stated shares, each floored. The split
// divides the TIP, never the bill or the total due; what
// the floors leave is named as the unallocated part (a
// recipient nobody named) plus the rounding remainder
// (dust belonging to no recipient).
const SHARES = [
  { label: 'Server', shareBps: 5000 },
  { label: 'Kitchen', shareBps: 3000 },
  { label: 'Support', shareBps: 2000 },
];
const DEFAULT = { billAmount: '100', tipRateBps: 2000, decimals: 6, shares: SHARES };

test('the preloaded split: a 20 tip on a 100 bill divides 10 to Server, 6 to Kitchen, and 4 to Support, with nothing left over', () => {
  const r = modelTipSplit(DEFAULT);
  assert.equal(r.tipAmount, 20000000n);
  assert.deepEqual(r.recipients.map(x => x.amount), [10000000n, 6000000n, 4000000n]);
  assert.equal(r.allocated, 20000000n);
  assert.equal(r.remainder, 0n);
  assert.equal(r.fullyShared, true);
});

test('the split divides the tip, never the total due: dividing the total due would state 60 to Server where the split states 10', () => {
  const base = modelTip({ billAmount: '100', tipRateBps: 2000, decimals: 6 });
  const onTotalDue = base.totalDue * 5000n / 10000n;
  assert.equal(onTotalDue, 60000000n);
  const r = modelTipSplit(DEFAULT);
  assert.equal(r.recipients[0].amount, 10000000n);
  assert.equal(r.splitMeasuredOnTotalDue, false);
});

test('identities hold across bills: what the recipients receive plus the remainder is the tip, exactly', () => {
  for (const billAmount of ['1', '7', '100', '777', '12345']) {
    const r = modelTipSplit({ billAmount, tipRateBps: 2000, decimals: 0, shares: SHARES });
    assert.equal(r.allocated + r.remainder, r.tipAmount);
    assert.equal(r.remainder, r.unallocatedAmount + r.roundingRemainder);
  }
});

test('the no-decimals 777 case: a 155 tip divides 77, 46, and 31, and the floors leave 1 of rounding dust for no recipient', () => {
  const r = modelTipSplit({ billAmount: '777', tipRateBps: 2000, decimals: 0, shares: SHARES });
  assert.equal(r.tipAmount, 155n);
  assert.deepEqual(r.recipients.map(x => x.amount), [77n, 46n, 31n]);
  assert.equal(r.allocated, 154n);
  assert.equal(r.unallocatedAmount, 0n);
  assert.equal(r.roundingRemainder, 1n);
  assert.equal(r.remainder, 1n);
});

test('shares summing to less than the whole leave an unallocated part that belongs to a recipient nobody named', () => {
  const r = modelTipSplit({ billAmount: '100', tipRateBps: 2000, decimals: 6, shares: [{ label: 'Server', shareBps: 5000 }, { label: 'Kitchen', shareBps: 2500 }] });
  assert.equal(r.totalShareBps, 7500);
  assert.equal(r.unallocatedBps, 2500);
  assert.equal(r.fullyShared, false);
  assert.equal(r.unallocatedAmount, 5000000n);
  assert.equal(r.allocated, 15000000n);
  assert.equal(r.remainder, 5000000n);
});

test('the unallocated part and the rounding dust are different things and are named separately', () => {
  const r = modelTipSplit({ billAmount: '777', tipRateBps: 2000, decimals: 0, shares: [{ label: 'Server', shareBps: 5000 }, { label: 'Kitchen', shareBps: 2500 }] });
  assert.deepEqual(r.recipients.map(x => x.amount), [77n, 38n]);
  assert.equal(r.unallocatedAmount, 38n);
  assert.equal(r.roundingRemainder, 2n);
  assert.equal(r.remainder, 40n);
});

test('a tip of a single base unit divided in thirds floors every recipient to zero and leaves the unit as dust', () => {
  const r = modelTipSplit({ billAmount: '10', tipRateBps: 1000, decimals: 0, shares: [{ label: 'A', shareBps: 3333 }, { label: 'B', shareBps: 3333 }, { label: 'C', shareBps: 3334 }] });
  assert.equal(r.tipAmount, 1n);
  assert.deepEqual(r.recipients.map(x => x.amount), [0n, 0n, 0n]);
  assert.equal(r.roundingRemainder, 1n);
});

test('shares summing past the whole tip are refused outright', () => {
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [{ label: 'Server', shareBps: 6000 }, { label: 'Kitchen', shareBps: 5000 }] }), /more than the whole tip/);
});

test('a payment beyond float precision: a 2^53+1 bill tips 1801439850948198 and halves it exactly at 900719925474099 each', () => {
  const r = modelTipSplit({ billAmount: '9007199254740993', tipRateBps: 2000, decimals: 0, shares: [{ label: 'Server', shareBps: 5000 }, { label: 'Kitchen', shareBps: 5000 }] });
  assert.equal(r.tipAmount, 1801439850948198n);
  assert.deepEqual(r.recipients.map(x => x.amount), [900719925474099n, 900719925474099n]);
  assert.equal(r.remainder, 0n);
});

test('no tip stated splits into zero for every recipient: the split stands and divides nothing', () => {
  const r = modelTipSplit({ billAmount: '100', tipRateBps: 0, decimals: 6, shares: SHARES });
  assert.equal(r.noTipStated, true);
  assert.deepEqual(r.recipients.map(x => x.amount), [0n, 0n, 0n]);
  assert.equal(r.remainder, 0n);
});

test('a stated rate flooring the tip to zero splits into zero for every recipient, stated as such', () => {
  const r = modelTipSplit({ billAmount: '3', tipRateBps: 3333, decimals: 0, shares: SHARES });
  assert.equal(r.tipFloorsToZero, true);
  assert.deepEqual(r.recipients.map(x => x.amount), [0n, 0n, 0n]);
});

test('labels are required, trimmed, and duplicates are refused case-insensitively', () => {
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [{ label: '  ', shareBps: 5000 }] }), /needs a label/);
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [{ label: 'Server', shareBps: 5000 }, { label: 'server', shareBps: 5000 }] }), /Duplicate recipient label/);
  const r = modelTipSplit({ ...DEFAULT, shares: [{ label: '  Server  ', shareBps: 10000 }] });
  assert.equal(r.recipients[0].label, 'Server');
});

test('an empty recipient list, more than five recipients, and a bad share are each refused', () => {
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [] }), /At least one tip recipient/);
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [1, 2, 3, 4, 5, 6].map(i => ({ label: `R${i}`, shareBps: 1000 })) }), /at most five recipients/);
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [{ label: 'Server', shareBps: 10001 }] }), /whole number of basis points/);
  assert.throws(() => modelTipSplit({ ...DEFAULT, shares: [{ label: 'Server', shareBps: 5000.5 }] }), /whole number of basis points/);
});

test('the base model refusals propagate: a bill of zero is refused', () => {
  assert.throws(() => modelTipSplit({ billAmount: '0', tipRateBps: 2000, decimals: 6, shares: SHARES }), /greater than zero/);
});

test('whether the tip is pooled is never priced', () => {
  const r = modelTipSplit(DEFAULT);
  assert.equal(r.poolingPriced, false);
});
