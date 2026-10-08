import test from 'node:test';
import assert from 'node:assert/strict';
import { substandardScenarioFields, copySubstandardScenario, updateSubstandardScenario, copySeizureScenario, updateSeizureScenario, simulateSubstandardTransfer, simulateSeizure } from '../src/domain.js';

const KYC_OK = { certPresent: true, certTrustedIssuer: true, certSignatureValid: true, certNamesSender: true, certExpired: false, paused: false };
const EXT_OK = { ...KYC_OK, recipientAllowlisted: true, recipientEntryExpired: false, selfTransfer: false };

test('scenario fields are exactly the fields each simulator reads', () => {
  assert.deepEqual(substandardScenarioFields('freeze-seize'), ['senderDenylisted', 'recipientDenylisted']);
  assert.deepEqual(substandardScenarioFields('kyc'), ['certPresent', 'certTrustedIssuer', 'certSignatureValid', 'certNamesSender', 'certExpired', 'paused']);
  // Basic KYC never checks a recipient: no recipient field exists for it.
  assert.ok(!substandardScenarioFields('kyc').includes('recipientAllowlisted'));
  assert.deepEqual(substandardScenarioFields('kyc-extended'), [...substandardScenarioFields('kyc'), 'recipientAllowlisted', 'recipientEntryExpired', 'selfTransfer']);
  assert.throws(() => substandardScenarioFields('generic'), /Generic PRISM rules/);
  assert.throws(() => substandardScenarioFields('nope'), /Choose a modeled reference substandard/);
});

test('copying a scenario returns a new object in canonical field order and never mutates the input', () => {
  const input = { paused: false, certExpired: true, certNamesSender: true, certSignatureValid: true, certTrustedIssuer: true, certPresent: true };
  const copy = copySubstandardScenario('kyc', input);
  assert.deepEqual(copy, { ...KYC_OK, certExpired: true });
  assert.notEqual(copy, input);
  assert.deepEqual(Object.keys(copy), [...substandardScenarioFields('kyc')]);
  copy.paused = true;
  assert.equal(input.paused, false); // the source scenario is untouched
});

test('copying refuses an unknown field, a missing field, a non-boolean, and a non-object', () => {
  assert.throws(() => copySubstandardScenario('kyc', { ...KYC_OK, recipientAllowlisted: true }), /not part of the kyc model/);
  assert.throws(() => copySubstandardScenario('freeze-seize', { senderDenylisted: true }), /must be true or false/);
  assert.throws(() => copySubstandardScenario('kyc', { ...KYC_OK, paused: 'true' }), /must be true or false/);
  assert.throws(() => copySubstandardScenario('kyc', null), /Choose a kyc scenario/);
  assert.throws(() => copySubstandardScenario('kyc', []), /Choose a kyc scenario/);
  assert.throws(() => copySubstandardScenario('generic', {}), /Generic PRISM rules/);
});

test('updating returns a new scenario, changes only the named field, and refuses a string flag', () => {
  const next = updateSubstandardScenario('kyc', KYC_OK, 'certExpired', true);
  assert.deepEqual(next, { ...KYC_OK, certExpired: true });
  assert.equal(KYC_OK.certExpired, false); // input untouched
  assert.notEqual(next, KYC_OK);
  // The editor maps its selects to true/false before the helper — a raw
  // string flag is refused so the two layers can never disagree.
  assert.throws(() => updateSubstandardScenario('kyc', KYC_OK, 'paused', 'true'), /must be true or false/);
  assert.throws(() => updateSubstandardScenario('kyc', KYC_OK, 'recipientAllowlisted', true), /not part of the kyc model/);
  assert.throws(() => updateSubstandardScenario('kyc-extended', EXT_OK, 'senderDenylisted', true), /not part of the kyc-extended model/);
});

test('a combined-failure KYC-extended scenario no preset carries fails on all three checks at once', () => {
  // Expired certificate + issuer pause + unlisted recipient, everything
  // else valid: the presets isolate each failure; this combination is
  // only constructible through the builder.
  let scenario = copySubstandardScenario('kyc-extended', EXT_OK);
  scenario = updateSubstandardScenario('kyc-extended', scenario, 'certExpired', true);
  scenario = updateSubstandardScenario('kyc-extended', scenario, 'paused', true);
  scenario = updateSubstandardScenario('kyc-extended', scenario, 'recipientAllowlisted', false);
  const r = simulateSubstandardTransfer('kyc-extended', scenario);
  assert.equal(r.allowed, false);
  const failed = r.checks.filter(c => !c.pass).map(c => c.name);
  assert.deepEqual(failed, ['Certificate still valid', 'Transfers not paused', 'Recipient in allowlist', 'Recipient entry current']);
  assert.equal(r.checks.filter(c => c.pass).length, 3);
});

test('a custom basic-KYC scenario with no certificate attached fails every certificate check but not the pause check', () => {
  let scenario = copySubstandardScenario('kyc', KYC_OK);
  scenario = updateSubstandardScenario('kyc', scenario, 'certPresent', false);
  const r = simulateSubstandardTransfer('kyc', scenario);
  assert.equal(r.allowed, false);
  assert.deepEqual(r.checks.map(c => c.pass), [false, false, false, false, true]);
});

test('freeze-seize custom scenarios cover the same four combinations as the presets, through the builder', () => {
  for (const senderDenylisted of [false, true]) for (const recipientDenylisted of [false, true]) {
    const scenario = updateSubstandardScenario('freeze-seize',
      updateSubstandardScenario('freeze-seize', { senderDenylisted: false, recipientDenylisted: false }, 'senderDenylisted', senderDenylisted),
      'recipientDenylisted', recipientDenylisted);
    const r = simulateSubstandardTransfer('freeze-seize', scenario);
    assert.equal(r.allowed, !senderDenylisted && !recipientDenylisted);
  }
});

test('copying a seizure scenario validates exactly its two flags', () => {
  const input = { holderDenylisted: true, actorAuthorised: false };
  const copy = copySeizureScenario(input);
  assert.deepEqual(copy, { actorAuthorised: false, holderDenylisted: true });
  assert.deepEqual(Object.keys(copy), ['actorAuthorised', 'holderDenylisted']);
  assert.notEqual(copy, input);
  assert.throws(() => copySeizureScenario({ actorAuthorised: true }), /must be true or false/);
  assert.throws(() => copySeizureScenario({ actorAuthorised: true, holderDenylisted: false, amount: '10' }), /not part of the seizure model/);
  assert.throws(() => copySeizureScenario('lawful'), /Choose a seizure scenario/);
});

test('updating a seizure scenario refuses a string flag and a foreign field', () => {
  const base = { actorAuthorised: true, holderDenylisted: true };
  assert.deepEqual(updateSeizureScenario(base, 'holderDenylisted', false), { actorAuthorised: true, holderDenylisted: false });
  assert.equal(base.holderDenylisted, true); // input untouched
  assert.throws(() => updateSeizureScenario(base, 'actorAuthorised', 'false'), /must be true or false/);
  assert.throws(() => updateSeizureScenario(base, 'paused', true), /not part of the seizure model/);
});

test('the seizure combination no preset carries — unauthorised actor, clean holder — fails both checks at once', () => {
  let scenario = copySeizureScenario({ actorAuthorised: true, holderDenylisted: true });
  scenario = updateSeizureScenario(scenario, 'actorAuthorised', false);
  scenario = updateSeizureScenario(scenario, 'holderDenylisted', false);
  const r = simulateSeizure(scenario);
  assert.equal(r.allowed, false);
  assert.deepEqual(r.checks.map(c => c.pass), [false, false]);
  // And the lawful combination still passes through the same path.
  const lawful = simulateSeizure(copySeizureScenario({ actorAuthorised: true, holderDenylisted: true }));
  assert.equal(lawful.allowed, true);
});

test('representative preset scenarios copy cleanly through the builder helpers', () => {
  // The shapes the UI presets ship must all be constructible here, so
  // the editor and the simulator can never drift apart.
  for (const scenario of [{ senderDenylisted: false, recipientDenylisted: false }, KYC_OK, EXT_OK]) {
    const id = 'recipientAllowlisted' in scenario ? 'kyc-extended' : 'certPresent' in scenario ? 'kyc' : 'freeze-seize';
    assert.deepEqual(copySubstandardScenario(id, scenario), scenario);
  }
});
