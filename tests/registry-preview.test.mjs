import test from 'node:test';
import assert from 'node:assert/strict';
import { fromTemplate, registryDatumPreview } from '../src/domain.js';

test('registry preview carries exact BigInt base units for supply and limit', () => {
  const p = registryDatumPreview(fromTemplate('rwa'), 'preview');
  assert.equal(p.token.initialSupplyBaseUnits, '1000000000000');
  assert.equal(p.transferPolicy.perTransferLimitBaseUnits, '10000000000');
  // Decimals drive the conversion: the same human amounts at 0 decimals differ exactly.
  const whole = registryDatumPreview({ ...fromTemplate('rwa'), decimals: 0 }, 'preview');
  assert.equal(whole.token.initialSupplyBaseUnits, '1000000');
  assert.equal(whole.transferPolicy.perTransferLimitBaseUnits, '10000');
});

test('registry preview is explicitly application-specific and never poses as a CIP datum', () => {
  const p = registryDatumPreview(fromTemplate('credit'), 'preview');
  assert.equal(p.kind, 'prism.registry-datum-preview');
  assert.equal(p.applicationSpecific, true);
  assert.equal(p.cipDatum, false);
  assert.equal(p.registeredOnChain, false);
  assert.match(p.note, /not a CIP-113 registry datum/);
  assert.match(p.note, /does not register, mint, or deploy/);
  // Nothing in the preview may look like deployed on-chain identity or encoding.
  const json = JSON.stringify(p);
  for (const forbidden of ['"policyId"', '"datumHash"', '"cbor"', '"plutusData"', '"txHash"', '"scriptHash"']) {
    assert.ok(!json.includes(forbidden), `preview must not contain ${forbidden}`);
  }
});

test('registry preview is deterministic: same design, same file, no timestamp', () => {
  const d = fromTemplate('stable');
  const a = registryDatumPreview(d, 'preprod');
  const b = registryDatumPreview(d, 'preprod');
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(!('createdAt' in a) && !('exportedAt' in a));
  assert.equal(a.network, 'preprod');
});

test('registry preview reflects the transfer policy and substandard faithfully', () => {
  const open = registryDatumPreview({ ...fromTemplate('community'), limitEnabled: false }, 'preview');
  assert.equal(open.transferPolicy.access, 'open');
  assert.equal(open.transferPolicy.perTransferLimitBaseUnits, null);
  assert.equal(open.transferPolicy.issuerPauseModeled, false);
  assert.equal(open.transferPolicy.eligibilityRequired, false);
  assert.equal(open.substandard.id, 'generic');
  const kyc = registryDatumPreview(fromTemplate('credit'), 'preview');
  assert.equal(kyc.transferPolicy.access, 'allowlist');
  assert.equal(kyc.substandard.id, 'kyc');
  assert.equal(kyc.substandard.modeledLocally, true);
  assert.match(kyc.substandard.reference, /kyc/);
});

test('registry preview names everything a real deployment still has to supply', () => {
  const p = registryDatumPreview(fromTemplate(), 'preview');
  assert.ok(p.registryFieldsStillRequired.length >= 4);
  const text = p.registryFieldsStillRequired.join(' ');
  assert.match(text, /policy ID/);
  assert.match(text, /Registry node position/);
  assert.match(text, /Plutus Data \/ CBOR/);
});

test('registry preview rejects invalid designs and unknown networks', () => {
  assert.throws(() => registryDatumPreview({ ...fromTemplate(), ticker: 'bad ticker' }, 'preview'));
  assert.throws(() => registryDatumPreview({ ...fromTemplate(), supply: '0' }, 'preview'));
  assert.throws(() => registryDatumPreview(fromTemplate(), 'fake-net'));
  assert.throws(() => registryDatumPreview(null, 'preview'));
});
