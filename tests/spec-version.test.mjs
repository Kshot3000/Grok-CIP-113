import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyBootstrapTx, getSpecVersionDeployment } from '../src/services.js';
import { CIP113_SPEC_VERSION, PREVIEW_REFERENCE } from '../src/config.js';

// Fixture shaped from the real Koios Preview tx_info response for the
// spec-listed bootstrap transaction, captured 2026-10-10
// (block 3978262, epoch 1189).
const TX = {
  tx_hash: CIP113_SPEC_VERSION.txHash,
  block_hash: '8aad6d1714be0ad74d97fb58f4f4c80117e0919a244caeeff6fc61c5192e2318',
  block_height: 3978262,
  epoch_no: 1189,
  epoch_slot: 42199,
  absolute_slot: 102771799,
  tx_timestamp: 1769427799,
  tx_size: 9120,
  valid_contract: true,
};

test('the pinned spec version is the CIP-113 Version table entry for Preview', () => {
  assert.equal(CIP113_SPEC_VERSION.network, 'preview');
  assert.equal(CIP113_SPEC_VERSION.txHash, '61fae36e28a62a65496907c9660da9cf5d27fa0e9054a04581e1d8a087fbd93e');
  assert.equal(CIP113_SPEC_VERSION.observed, '2026-10-10');
  assert.equal(CIP113_SPEC_VERSION.section, 'CIP-113 Version');
});

test('the spec-listed version and the platform reference deployment are different transactions', () => {
  assert.notEqual(CIP113_SPEC_VERSION.txHash, PREVIEW_REFERENCE.txHash);
  assert.equal(PREVIEW_REFERENCE.txHash, '8e9668a6432ea4567bb1deba919c0f76adcce8373d6d89d1a06faee2c83d00f9');
});

test('classifier names the spec-listed version on Preview', () => {
  const c = classifyBootstrapTx('preview', CIP113_SPEC_VERSION.txHash);
  assert.equal(c.kind, 'spec-listed-version');
  assert.equal(c.specListed, true);
  assert.equal(c.platformReference, false);
});

test('classifier names the platform reference deployment, and never as spec-listed', () => {
  const c = classifyBootstrapTx('preview', PREVIEW_REFERENCE.txHash);
  assert.equal(c.kind, 'platform-reference-deployment');
  assert.equal(c.specListed, false);
  assert.equal(c.platformReference, true);
});

test('classifier canonicalises hex case before comparing', () => {
  const c = classifyBootstrapTx('preview', CIP113_SPEC_VERSION.txHash.toUpperCase());
  assert.equal(c.txHash, CIP113_SPEC_VERSION.txHash);
  assert.equal(c.specListed, true);
});

test('classifier gives an unpinned hash no record, on any network', () => {
  const c = classifyBootstrapTx('preview', 'a'.repeat(64));
  assert.equal(c.kind, 'neither-pinned-record');
  assert.equal(c.specListed, false);
  assert.equal(c.platformReference, false);
});

test('the spec lists a version for Preview only: the spec hash classifies nowhere else', () => {
  for (const network of ['preprod', 'mainnet']) {
    const c = classifyBootstrapTx(network, CIP113_SPEC_VERSION.txHash);
    assert.equal(c.specListed, false);
    assert.equal(c.kind, 'neither-pinned-record');
  }
});

test('the platform hash is the platform reference on Preview only', () => {
  const c = classifyBootstrapTx('preprod', PREVIEW_REFERENCE.txHash);
  assert.equal(c.platformReference, false);
  assert.equal(c.kind, 'neither-pinned-record');
});

test('classifier refuses malformed hashes and unknown networks, never classifying in part', () => {
  assert.throws(() => classifyBootstrapTx('preview', '61fae36e'), /64 hexadecimal/);
  assert.throws(() => classifyBootstrapTx('preview', 'z'.repeat(64)), /64 hexadecimal/);
  assert.throws(() => classifyBootstrapTx('preview', 42), /64 hexadecimal/);
  assert.throws(() => classifyBootstrapTx('preview', null), /64 hexadecimal/);
  assert.throws(() => classifyBootstrapTx('devnet', CIP113_SPEC_VERSION.txHash), /Unknown network/);
});

function stubFetch(tx = [TX]) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => tx });
  return () => { globalThis.fetch = real; };
}

test('live verification confirms the spec-listed transaction and classifies it', async () => {
  const restore = stubFetch();
  try {
    const d = await getSpecVersionDeployment();
    assert.equal(d.txHash, CIP113_SPEC_VERSION.txHash);
    assert.equal(d.blockHeight, 3978262);
    assert.equal(d.epoch, 1189);
    assert.equal(d.classification.kind, 'spec-listed-version');
    assert.equal(d.classification.platformReference, false);
    assert.equal(d.platformTxHash, PREVIEW_REFERENCE.txHash);
  } finally { restore(); }
});

test('live verification refuses when Koios reports a different transaction', async () => {
  const restore = stubFetch([{ ...TX, tx_hash: 'c'.repeat(64) }]);
  try {
    await assert.rejects(() => getSpecVersionDeployment(), /different transaction/);
  } finally { restore(); }
});

test('live verification refuses an unconfirmed or invalid spec transaction', async () => {
  const restore = stubFetch([{ ...TX, block_height: 0 }]);
  try {
    await assert.rejects(() => getSpecVersionDeployment(), /not confirmed/);
  } finally { restore(); }
  const restore2 = stubFetch([{ ...TX, valid_contract: false }]);
  try {
    await assert.rejects(() => getSpecVersionDeployment(), /valid contract execution/);
  } finally { restore2(); }
});

test('app wires the spec version panel honestly, v1.104', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /v1\.104/);
  assert.match(app, /data-action="verify-spec-version"/);
  assert.match(app, /CIP-113 version \(spec-listed\)/);
  assert.match(app, /Different transactions/);
  assert.match(app, /Spec-listed version confirmed on Preview/);
  assert.match(app, /CIP113_SPEC_VERSION\.txHash/);
  assert.match(app, /spec table lists no version for Preprod or Mainnet/);
  const services = await readFile(new URL('../src/services.js', import.meta.url), 'utf8');
  assert.match(services, /getSpecVersionDeployment/);
  assert.match(services, /classifyBootstrapTx/);
  assert.match(services, /parseDeploymentTx\(rows, CIP113_SPEC_VERSION\.txHash\)/);
});
