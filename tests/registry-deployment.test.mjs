import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDeploymentTx, getPreviewDeployment } from '../src/services.js';
import { PREVIEW_REFERENCE, NETWORKS } from '../src/config.js';

// Fixture shaped from the real Koios Preview tx_info response for the pinned
// bootstrap transaction, captured 2026-10-04 (block 4717846, epoch 1438).
const TX = {
  tx_hash: PREVIEW_REFERENCE.txHash,
  block_hash: 'f3ba5f5e38c1cf17faa3b2c7d5b67d910763572d9c30a8f0ac2880b4357bed52',
  block_height: 4717846,
  epoch_no: 1438,
  epoch_slot: 41357,
  absolute_slot: 124284557,
  tx_timestamp: 1790940557,
  tx_size: 11906,
  valid_contract: true,
};
const BOOTSTRAP_ROW = {
  schemaVersion: 3,
  txHash: PREVIEW_REFERENCE.txHash,
  protocolParams: { policyId: PREVIEW_REFERENCE.protocolPolicy },
  programmableLogicBase: { scriptHash: PREVIEW_REFERENCE.scriptHash },
};

test('deployment parser accepts a confirmed, valid-contract transaction', () => {
  const d = parseDeploymentTx([TX], PREVIEW_REFERENCE.txHash);
  assert.equal(d.txHash, PREVIEW_REFERENCE.txHash);
  assert.equal(d.blockHeight, 4717846);
  assert.equal(d.epoch, 1438);
  assert.equal(d.timestamp, 1790940557 * 1000);
  assert.equal(d.validContract, true);
});

test('deployment parser rejects anything but exactly one matching record', () => {
  assert.throws(() => parseDeploymentTx(null, PREVIEW_REFERENCE.txHash), /exactly one record/);
  assert.throws(() => parseDeploymentTx([], PREVIEW_REFERENCE.txHash), /exactly one record/);
  assert.throws(() => parseDeploymentTx([TX, TX], PREVIEW_REFERENCE.txHash), /exactly one record/);
  assert.throws(() => parseDeploymentTx([{ ...TX, tx_hash: 'a'.repeat(64) }], PREVIEW_REFERENCE.txHash), /different transaction/);
});

test('deployment parser rejects unconfirmed or invalid deployment records', () => {
  assert.throws(() => parseDeploymentTx([{ ...TX, block_height: 0 }], PREVIEW_REFERENCE.txHash), /not confirmed/);
  assert.throws(() => parseDeploymentTx([{ ...TX, block_height: 1.5 }], PREVIEW_REFERENCE.txHash), /not confirmed/);
  assert.throws(() => parseDeploymentTx([{ ...TX, epoch_no: -1 }], PREVIEW_REFERENCE.txHash), /no valid epoch/);
  assert.throws(() => parseDeploymentTx([{ ...TX, tx_timestamp: 0 }], PREVIEW_REFERENCE.txHash), /no valid confirmation time/);
  assert.throws(() => parseDeploymentTx([{ ...TX, valid_contract: false }], PREVIEW_REFERENCE.txHash), /valid contract execution/);
  const missing = { ...TX }; delete missing.valid_contract;
  assert.throws(() => parseDeploymentTx([missing], PREVIEW_REFERENCE.txHash), /valid contract execution/);
});

function stubFetch({ bootstrap = [BOOTSTRAP_ROW], tx = [TX] } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('protocol-bootstraps') ? bootstrap : tx),
  });
  return () => { globalThis.fetch = real; };
}

test('full verification cross-checks the pinned config and the on-chain record', async () => {
  const restore = stubFetch();
  try {
    const d = await getPreviewDeployment();
    assert.equal(d.blockHeight, 4717846);
    assert.equal(d.scriptHash, PREVIEW_REFERENCE.scriptHash);
    assert.equal(d.protocolPolicy, PREVIEW_REFERENCE.protocolPolicy);
    assert.equal(d.source, PREVIEW_REFERENCE.source);
  } finally { restore(); }
});

test('verification refuses when the upstream configuration drifts from the pin', async () => {
  const drifted = [{ ...BOOTSTRAP_ROW, programmableLogicBase: { scriptHash: 'b'.repeat(56) } }];
  const restore = stubFetch({ bootstrap: drifted });
  try {
    await assert.rejects(() => getPreviewDeployment(), /no longer matches the pinned deployment/);
  } finally { restore(); }
});

test('verification refuses when Koios reports a different transaction', async () => {
  const restore = stubFetch({ tx: [{ ...TX, tx_hash: 'c'.repeat(64) }] });
  try {
    await assert.rejects(() => getPreviewDeployment(), /different transaction/);
  } finally { restore(); }
});

test('verification reads the Preview Koios deployment record, whatever network is selected', async () => {
  const services = await readFile(new URL('../src/services.js', import.meta.url), 'utf8');
  assert.match(services, /NETWORKS\.preview\.koios\}\/tx_info/);
  assert.equal(NETWORKS.preview.koios, 'https://preview.koios.rest/api/v1');
});

test('registry panel wires the verification honestly', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="verify-deployment"/);
  assert.match(app, /Foundation Preview reference deployment/);
  // The honesty boundary: verifying a deployment never claims a browsable registry.
  assert.match(app, /does not list or count registry tokens/);
  assert.match(app, /not production-ready, with an independent security audit pending/);
  assert.match(app, /Deployment confirmed on Preview/);
});
