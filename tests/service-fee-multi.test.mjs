import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { multiAssetServiceFee, modelServiceFee } from '../src/domain.js';

const A = { label: 'Asset A', amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100 };
const B = { label: 'Asset B', amount: '200', decimals: 0, feeBps: 50, fixedFee: '0', maxFee: '', transfersPerMonth: 40 };

test('default two-asset schedule prices each asset in itself', () => {
  const r = multiAssetServiceFee({ assets: [A, B] });
  assert.equal(r.assetCount, 2);
  assert.equal(r.assets[0].fee, 10000000n);
  assert.equal(r.assets[0].net, 990000000n);
  assert.equal(r.assets[0].monthly.fee, 1000000000n);
  assert.equal(r.assets[1].fee, 1n);
  assert.equal(r.assets[1].net, 199n);
  assert.equal(r.assets[1].monthly.fee, 40n);
  assert.equal(r.assets[1].monthly.gross, 8000n);
});

test('a single-asset list matches modelServiceFee exactly', () => {
  const r = multiAssetServiceFee({ assets: [A] });
  const s = modelServiceFee(A);
  assert.equal(r.assets[0].fee, s.fee);
  assert.equal(r.assets[0].net, s.net);
  assert.equal(r.assets[0].effectiveBpsText, s.effectiveBpsText);
  assert.deepEqual(r.assets[0].monthly, s.monthly);
});

test('there is no cross-asset total: fees in different assets are never summed', () => {
  const r = multiAssetServiceFee({ assets: [A, B] });
  assert.equal(r.crossAssetTotal, null);
  assert.equal(r.totalsCombined, false);
  assert.equal(r.monthly, undefined);
  assert.equal(r.totalFee, undefined);
  // Per-asset monthly fees stay in their own assets and scales.
  assert.equal(r.assets[0].monthly.fee, 1000000000n);
  assert.equal(r.assets[1].monthly.fee, 40n);
});

test('each asset keeps its own decimals and rounding', () => {
  const r = multiAssetServiceFee({ assets: [
    { label: 'Tiny', amount: '3', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 10 },
    { label: 'Precise', amount: '3', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 10 },
  ] });
  // floor(3 * 100 / 10000) = 0 in whole units; at 6 decimals the same rate takes 0.03.
  assert.equal(r.assets[0].fee, 0n);
  assert.equal(r.assets[0].effectiveBpsText, '0.00');
  assert.equal(r.assets[1].fee, 30000n);
  assert.equal(r.assets[1].effectiveBpsText, '100.00');
});

test('the fixed fee and cap are per asset, with the cap binding reported per asset', () => {
  const r = multiAssetServiceFee({ assets: [
    { ...A, fixedFee: '1', maxFee: '7' },
    { ...B, fixedFee: '0', maxFee: '' },
  ] });
  assert.equal(r.assets[0].fee, 7000000n);
  assert.equal(r.assets[0].capApplied, true);
  assert.equal(r.assets[1].fee, 1n);
  assert.equal(r.assets[1].capApplied, false);
});

test('a zero-fee asset in the list is legal and charges nothing', () => {
  const r = multiAssetServiceFee({ assets: [A, { ...B, feeBps: 0 }] });
  assert.equal(r.assets[1].fee, 0n);
  assert.equal(r.assets[1].net, r.assets[1].gross);
});

test('labels are trimmed and the trimmed label is what rows carry', () => {
  const r = multiAssetServiceFee({ assets: [{ ...A, label: '  Gold Token  ' }] });
  assert.equal(r.assets[0].label, 'Gold Token');
});

test('duplicate labels are refused, case-insensitively', () => {
  assert.throws(() => multiAssetServiceFee({ assets: [A, { ...B, label: 'asset a' }] }), /Duplicate asset label/);
  assert.throws(() => multiAssetServiceFee({ assets: [A, { ...B, label: ' Asset A ' }] }), /Duplicate asset label/);
});

test('an empty, missing, oversized, or unreadable list is refused', () => {
  assert.throws(() => multiAssetServiceFee({ assets: [] }), /At least one asset/);
  assert.throws(() => multiAssetServiceFee({}), /At least one asset/);
  assert.throws(() => multiAssetServiceFee({ assets: 'nope' }), /At least one asset/);
  assert.throws(() => multiAssetServiceFee({ assets: Array.from({ length: 9 }, (_, i) => ({ ...A, label: `A${i}` })) }), /at most eight/);
  assert.throws(() => multiAssetServiceFee({ assets: [null] }), /needs its own fee inputs/);
});

test('an asset without a label is refused', () => {
  assert.throws(() => multiAssetServiceFee({ assets: [{ ...A, label: '' }] }), /needs a label/);
  assert.throws(() => multiAssetServiceFee({ assets: [{ amount: '5', decimals: 0 }] }), /needs a label/);
});

test('a takes-all fee is refused naming the asset that carries it', () => {
  assert.throws(() => multiAssetServiceFee({ assets: [A, { ...B, amount: '10', feeBps: 10000 }] }), /Asset B: The fee would take the whole transfer/);
});

test('an unreadable asset input is refused naming the asset', () => {
  assert.throws(() => multiAssetServiceFee({ assets: [A, { ...B, amount: '0' }] }), /Asset B: Transfer amount must be greater than zero/);
  assert.throws(() => multiAssetServiceFee({ assets: [{ ...A, feeBps: 10001 }] }), /Asset A: Fee must be/);
});

test('three assets each keep their own monthly volume', () => {
  const r = multiAssetServiceFee({ assets: [A, B, { label: 'Asset C', amount: '50', decimals: 2, feeBps: 200, fixedFee: '0', maxFee: '', transfersPerMonth: 7 }] });
  assert.equal(r.assetCount, 3);
  assert.equal(r.assets[2].fee, 100n);
  assert.equal(r.assets[2].monthly.fee, 700n);
  assert.equal(r.assets[2].monthly.gross, 35000n);
});

test('exactness beyond float range, per asset', () => {
  const r = multiAssetServiceFee({ assets: [
    { label: 'Huge', amount: '9007199254740993', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 2 },
    B,
  ] });
  assert.equal(r.assets[0].fee, 90071992547409n);
  assert.equal(r.assets[0].monthly.fee, 180143985094818n);
});

test('eight assets are accepted', () => {
  const r = multiAssetServiceFee({ assets: Array.from({ length: 8 }, (_, i) => ({ ...A, label: `Asset ${i + 1}` })) });
  assert.equal(r.assetCount, 8);
});

test('panel wiring: the multi-asset model renders in app.js', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /multiAssetServiceFee\(/);
  assert.match(app, /data-fee2/);
  assert.match(app, /v1\.258/);
});
