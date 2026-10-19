import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRegistryIntegrity, REGISTRY_INTEGRITY_VERDICTS } from '../src/domain.js';

// CIP-113 registry integrity (spec: "Implementing programmable tokens in
// DeFi protocols", "Security Considerations", item 2, re-read 2026-10-11):
// "Registry Integrity: Verify using the canonical registry; monitor for
// spoofing attempts." Both practices are stated directly to integrators;
// the canonical anchor (how the canonical registry is identified) is
// reported, never scored, because the item prescribes no method.
const ready = () => ({
  verificationRegistry: 'canonical',
  canonicalAnchor: 'bootstrap-hash',
  spoofMonitoring: 'ongoing',
});

test('an integrator following both stated practices is ready', () => {
  const v = checkRegistryIntegrity(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), REGISTRY_INTEGRITY_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { usesCanonicalRegistry: true, monitorsForSpoofing: true });
});

test('verifying against a project-run instance fails the first practice — it is not the canonical registry', () => {
  const v = checkRegistryIntegrity({ ...ready(), verificationRegistry: 'project-run' });
  assert.equal(v.verdicts.usesCanonicalRegistry, false);
  assert.equal(v.verdicts.monitorsForSpoofing, true);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-ready');
});

test('verifying against an unverified copy, or no registry at all, fails the first practice', () => {
  const copy = checkRegistryIntegrity({ ...ready(), verificationRegistry: 'unverified-copy' });
  assert.equal(copy.verdicts.usesCanonicalRegistry, false);
  assert.equal(copy.valid, false);
  const none = checkRegistryIntegrity({ verificationRegistry: 'none', canonicalAnchor: 'not-applicable', spoofMonitoring: 'ongoing' });
  assert.equal(none.verdicts.usesCanonicalRegistry, false);
  assert.equal(none.valid, false);
});

test('a one-time spoofing check at setup is not monitoring and fails the second practice', () => {
  const v = checkRegistryIntegrity({ ...ready(), spoofMonitoring: 'setup-only' });
  assert.equal(v.verdicts.monitorsForSpoofing, false);
  assert.equal(v.verdicts.usesCanonicalRegistry, true);
  assert.equal(v.valid, false);
});

test('no spoofing monitoring at all fails the second practice, however verification is done', () => {
  const v = checkRegistryIntegrity({ ...ready(), spoofMonitoring: 'none' });
  assert.equal(v.verdicts.monitorsForSpoofing, false);
  assert.equal(v.valid, false);
});

test('each scored position fails independently: the verdicts are separate positions', () => {
  const cases = [
    [{ verificationRegistry: 'project-run' }, 'usesCanonicalRegistry'],
    [{ spoofMonitoring: 'setup-only' }, 'monitorsForSpoofing'],
  ];
  for (const [patch, key] of cases) {
    const v = checkRegistryIntegrity({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('the canonical anchor is reported, never scored: ready without a bootstrap-hash pin', () => {
  for (const canonicalAnchor of ['registry-address', 'unpinned']) {
    const v = checkRegistryIntegrity({ ...ready(), canonicalAnchor });
    assert.equal(v.valid, true, canonicalAnchor);
    assert.equal(v.status, 'ready', canonicalAnchor);
    assert.equal(v.canonicalAnchor, canonicalAnchor);
    assert.equal(v.canonicalAnchored, false, canonicalAnchor);
  }
});

test('a bootstrap-hash anchor is reported as pinned — and cannot rescue a failed practice', () => {
  const pinned = checkRegistryIntegrity(ready());
  assert.equal(pinned.canonicalAnchored, true);
  const failing = checkRegistryIntegrity({ ...ready(), verificationRegistry: 'project-run' });
  assert.equal(failing.canonicalAnchored, true);
  assert.equal(failing.valid, false);
});

test('an anchor named where no registry is verified against is refused', () => {
  for (const canonicalAnchor of ['bootstrap-hash', 'registry-address', 'unpinned']) {
    assert.throws(() => checkRegistryIntegrity({ verificationRegistry: 'none', canonicalAnchor, spoofMonitoring: 'ongoing' }), /names a canonical anchor where no registry is verified against/i, canonicalAnchor);
  }
});

test('an anchor declared not-applicable while a registry is in use is refused', () => {
  for (const verificationRegistry of ['canonical', 'project-run', 'unverified-copy']) {
    assert.throws(() => checkRegistryIntegrity({ verificationRegistry, canonicalAnchor: 'not-applicable', spoofMonitoring: 'ongoing' }), /not-applicable while a registry is verified against/i, verificationRegistry);
  }
});

test('refusal discipline: a non-object profile is refused', () => {
  assert.throws(() => checkRegistryIntegrity(null), /must be an object/i);
  assert.throws(() => checkRegistryIntegrity([]), /must be an object/i);
  assert.throws(() => checkRegistryIntegrity('canonical'), /must be an object/i);
});

test('refusal discipline: unknown and missing fields are refused, never scored in part', () => {
  assert.throws(() => checkRegistryIntegrity({ ...ready(), registryUrl: 'https://example.invalid' }), /unknown field/i);
  const { spoofMonitoring, ...missing } = ready();
  assert.throws(() => checkRegistryIntegrity(missing), /missing its "spoofMonitoring" field/i);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkRegistryIntegrity({ ...ready(), verificationRegistry: 'a-mirror-i-found' }), /verification registry must be one of/i);
  assert.throws(() => checkRegistryIntegrity({ ...ready(), canonicalAnchor: 'a-bookmark' }), /canonical anchor must be one of/i);
  assert.throws(() => checkRegistryIntegrity({ ...ready(), spoofMonitoring: 'sometimes' }), /spoofing monitoring field must be one of/i);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkRegistryIntegrity(claim);
  assert.deepEqual(claim, snapshot);
});

test('an integrator following neither practice is not ready on any position', () => {
  const v = checkRegistryIntegrity({ verificationRegistry: 'none', canonicalAnchor: 'not-applicable', spoofMonitoring: 'none' });
  assert.deepEqual(Object.values(v.verdicts), [false, false]);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-ready');
});

test('the entered profile is carried through unchanged in the result', () => {
  const v = checkRegistryIntegrity(ready());
  assert.equal(v.verificationRegistry, 'canonical');
  assert.equal(v.canonicalAnchor, 'bootstrap-hash');
  assert.equal(v.spoofMonitoring, 'ongoing');
});

test('app wires the registry integrity checker: panel, verdicts, anchor reported-never-scored, honest boundary, v1.272', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkRegistryIntegrity/);
  assert.match(app, /registry-integrity-source/);
  assert.match(app, /registry-integrity-result/);
  assert.match(app, /REGISTRY INTEGRITY · LOCAL MODEL/);
  assert.match(app, /SECURITY CONSIDERATIONS/);
  assert.match(app, /REPORTED, NEVER SCORED/);
  assert.match(app, /inspected no integrator, read no registry, and no chain state/);
  assert.match(app, /v1\.272/);
});
