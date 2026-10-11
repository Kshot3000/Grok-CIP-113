import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseModules, moduleCoverageCheck, MODULE_MODEL_MAP, getModules } from '../src/services.js';
import { SUBSTANDARDS } from '../src/domain.js';

// Coverage consumes the PARSED module shape (parseModules output), and
// reads only each module's id — so most fixtures here are parsed-shape
// objects carrying the real live catalogue's IDs (dummy,
// freeze-and-seize, rwa-token — byte-identical on all three networks on
// 2026-10-10, verified against the live indexers with this code before
// shipping). One test feeds coverage a real record through parseModules
// itself, using the Dummy module's first real validator entry (the same
// excerpt discipline as modules.test.mjs).

const parsed = (...ids) => ids.map(id => ({ id, name: id, description: '', validators: [{ title: 't', scriptHash: 'aa'.repeat(28), computedHash: 'aa'.repeat(28), scriptByteLength: 1 }] }));
const LIVE = () => parsed('dummy', 'freeze-and-seize', 'rwa-token');

const DUMMY_REAL = { "id": "dummy", "name": "Dummy", "description": "", "validators": [{ "title": "transfer.issue.withdraw", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a0054832004c024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "4be2c6d3f5c5e66f45d20801c0d55341f0ae3b939187c9591ec29028" }] };

test('the correspondence table is consistent with the local models it names', () => {
  const localIds = SUBSTANDARDS.map(s => s.id);
  assert.equal(new Set(MODULE_MODEL_MAP.map(e => e.liveId)).size, MODULE_MODEL_MAP.length);
  for (const e of MODULE_MODEL_MAP) {
    if (e.localId !== null) assert.ok(localIds.includes(e.localId), e.liveId);
    for (const id of e.relatedLocalIds) assert.ok(localIds.includes(id), `${e.liveId} related ${id}`);
  }
  // The one exact correspondence, pinned: the indexer spells the module
  // freeze-and-seize; the studio's design-file name for it is freeze-seize.
  const exact = MODULE_MODEL_MAP.filter(e => e.localId !== null);
  assert.deepEqual(exact.map(e => [e.liveId, e.localId]), [['freeze-and-seize', 'freeze-seize']]);
});

test('the live catalogue is fully accounted for, with exactly one module modeled', () => {
  const c = moduleCoverageCheck(LIVE());
  assert.equal(c.ok, true);
  assert.equal(c.tableValid, true);
  assert.equal(c.liveCount, 3);
  assert.equal(c.localCount, 4);
  assert.equal(c.modeledCount, 1);
  assert.deepEqual(c.modeledLiveIds, ['freeze-and-seize']);
  assert.deepEqual(c.unmodeledLiveIds, ['dummy', 'rwa-token']);
  assert.deepEqual(c.unknownLiveIds, []);
});

test('each live module carries its classification — modeled, test, profile', () => {
  const c = moduleCoverageCheck(LIVE());
  assert.deepEqual(c.live.map(x => [x.id, x.kind, x.localId]), [
    ['dummy', 'test', null],
    ['freeze-and-seize', 'modeled', 'freeze-seize'],
    ['rwa-token', 'profile', null],
  ]);
});

test('the RWA profile is related to three local models but is a model of none of them', () => {
  const c = moduleCoverageCheck(LIVE());
  const rwa = c.live.find(x => x.id === 'rwa-token');
  assert.equal(rwa.localId, null);
  assert.deepEqual(rwa.relatedLocalIds, ['freeze-seize', 'kyc', 'kyc-extended']);
  // Related never counts as modeled: the profile is in the unmodeled list.
  assert.ok(c.unmodeledLiveIds.includes('rwa-token'));
});

test('the local side is derived: catalogued, related-only, and no-counterpart, in SUBSTANDARDS order', () => {
  const c = moduleCoverageCheck(LIVE());
  assert.deepEqual(c.local.map(x => x.id), SUBSTANDARDS.map(s => s.id));
  assert.deepEqual(c.local, [
    { id: 'generic', status: 'no-live-counterpart', liveId: null },
    { id: 'freeze-seize', status: 'catalogued', liveId: 'freeze-and-seize' },
    { id: 'kyc', status: 'related-only', liveId: 'rwa-token' },
    { id: 'kyc-extended', status: 'related-only', liveId: 'rwa-token' },
  ]);
  assert.deepEqual(c.relatedOnlyLocalIds, ['kyc', 'kyc-extended']);
  assert.deepEqual(c.localWithoutLiveIds, ['generic']);
});

test('a real record parsed by parseModules feeds coverage unchanged', () => {
  const [dummy] = parseModules([JSON.parse(JSON.stringify(DUMMY_REAL))]);
  const c = moduleCoverageCheck([dummy]);
  assert.equal(c.ok, true);
  assert.deepEqual(c.live, [{ id: 'dummy', kind: 'test', localId: null, relatedLocalIds: [] }]);
  assert.equal(c.modeledCount, 0);
});

test('an unclassified live module fails the coverage check and is named', () => {
  const c = moduleCoverageCheck([...LIVE(), ...parsed('sanctions-screening')]);
  assert.equal(c.ok, false);
  assert.deepEqual(c.unknownLiveIds, ['sanctions-screening']);
  const entry = c.live.find(x => x.id === 'sanctions-screening');
  assert.equal(entry.kind, 'unknown');
  assert.equal(entry.localId, null);
  // The classified modules keep their verdicts — one unknown does not
  // rewrite what is known about the others.
  assert.deepEqual(c.modeledLiveIds, ['freeze-and-seize']);
});

test('an empty catalogue accounts for nothing — no vacuous pass', () => {
  const c = moduleCoverageCheck([]);
  assert.equal(c.ok, false);
  assert.equal(c.liveCount, 0);
  assert.equal(c.modeledCount, 0);
  // With nothing catalogued, every local model stands without a live
  // counterpart — reported, in order.
  assert.deepEqual(c.localWithoutLiveIds, ['generic', 'freeze-seize', 'kyc', 'kyc-extended']);
  assert.deepEqual(c.relatedOnlyLocalIds, []);
});

test('related-only is a property of this catalogue: without the RWA profile, KYC stands alone', () => {
  const c = moduleCoverageCheck(parsed('dummy', 'freeze-and-seize'));
  assert.equal(c.ok, true);
  assert.deepEqual(c.relatedOnlyLocalIds, []);
  assert.deepEqual(c.localWithoutLiveIds, ['generic', 'kyc', 'kyc-extended']);
});

test('without freeze-and-seize catalogued, its local model is related-only via the profile — never catalogued', () => {
  const c = moduleCoverageCheck(parsed('dummy', 'rwa-token'));
  assert.equal(c.ok, true);
  assert.equal(c.modeledCount, 0);
  const fs = c.local.find(x => x.id === 'freeze-seize');
  assert.deepEqual(fs, { id: 'freeze-seize', status: 'related-only', liveId: 'rwa-token' });
});

test('coverage is about identity, not hashes: a hash-mismatched catalogue is still accounted for', () => {
  // modulesCheck owns the hash verdict; coverage must not restate it.
  const mismatched = LIVE();
  mismatched[1].validators[0].computedHash = 'bb'.repeat(28);
  const c = moduleCoverageCheck(mismatched);
  assert.equal(c.ok, true);
  assert.deepEqual(c.modeledLiveIds, ['freeze-and-seize']);
});

test('the returned related lists are copies — mutating one does not rewrite the table', () => {
  const c = moduleCoverageCheck(LIVE());
  c.live.find(x => x.id === 'rwa-token').relatedLocalIds.push('generic');
  const again = moduleCoverageCheck(LIVE());
  assert.deepEqual(again.live.find(x => x.id === 'rwa-token').relatedLocalIds, ['freeze-seize', 'kyc', 'kyc-extended']);
});

test('getModules refuses an unknown network before any fetch', async () => {
  await assert.rejects(() => getModules('devnet'), /Unknown network/);
});

test('app wires the coverage check: verdict, per-module model line, honest failure, v1\.106', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const services = await readFile(new URL('../src/services.js', import.meta.url), 'utf8');
  assert.match(services, /coverage:moduleCoverageCheck\(modules\)/);
  assert.match(app, /Coverage check passed/);
  assert.match(app, /Coverage check FAILED/);
  assert.match(app, /Studio model:/);
  assert.match(app, /No studio model — platform test module/);
  assert.match(app, /No single studio model/);
  assert.match(app, /coverage check against the studio/);
  assert.match(app, /WORKSPACE <span>v1\.106<\/span>/);
});
