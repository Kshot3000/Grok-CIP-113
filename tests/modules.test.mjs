import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseModules, modulesCheck, getModules, plutusV3ScriptHash } from '../src/services.js';

// Fixtures are real records from the indexers' /api/v1/modules responses,
// captured live on 2026-10-10 (the response is byte-identical on all
// three networks today). The Dummy module is carried complete (6 entries,
// 2 distinct scripts). The freeze-and-seize and RWA modules are excerpted
// to one real validator entry each — their full responses carry ~230 KB
// of compiled script bytes — because the parser and the hash recomputation
// are what is under test; the full live counts (3 modules, 40 entries,
// 16 distinct scripts, every hash verifying on all three networks) were
// verified against the live indexers with this code before shipping.

const MODULE_DUMMY = {"id": "dummy", "name": "Dummy", "description": "", "validators": [{"title": "transfer.issue.withdraw", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a0054832004c024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "4be2c6d3f5c5e66f45d20801c0d55341f0ae3b939187c9591ec29028"}, {"title": "transfer.issue.publish", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a0054832004c024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "4be2c6d3f5c5e66f45d20801c0d55341f0ae3b939187c9591ec29028"}, {"title": "transfer.issue.else", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a0054832004c024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "4be2c6d3f5c5e66f45d20801c0d55341f0ae3b939187c9591ec29028"}, {"title": "transfer.transfer.withdraw", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a005482400cc024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "6ae51f97696717eb0de100c151a30965a3c4ff97c167124b2b206ba9"}, {"title": "transfer.transfer.publish", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a005482400cc024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "6ae51f97696717eb0de100c151a30965a3c4ff97c167124b2b206ba9"}, {"title": "transfer.transfer.else", "script_bytes": "588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a005482400cc024c020dd5001c56600266e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700130060013003375400d149a26cac80081", "script_hash": "6ae51f97696717eb0de100c151a30965a3c4ff97c167124b2b206ba9"}]};
const MODULE_FREEZE = {"id": "freeze-and-seize", "name": "Freeze-and-seize", "description": "", "validators": [{"title": "blacklist_mint.blacklist_mint.mint", "script_bytes": "5907980101002229800aba2aba1aba0aab9faab9eaab9dab9a9bae0024888888896600264653001300900198049805000cdc3a400130090024888966002600460126ea800e33001375c601a60146ea800e6e1d20029b874801260126ea80112222325980098038014566002601e6ea8026003164041159800980200144c8c966002602a0050038b2024375c6026002601e6ea80262b30013003002899192cc004c05400a0071640486eb8c04c004c03cdd5004c5900d201a4034330012301230130019180918099809800cdc02400523012301330133013301300191191919800800802112cc00400600713233225980099b910070028acc004cdc78038014400600c80a226600a00a603400880a0dd718098009bab301400130160014050297adef6c60912cc004c020c03cdd500144c8c8cc896600260300070058b202a375c602a0026eb8c054008c054004c040dd500145900e488c8cc00400400c896600200314bd7044cc050c00cc054004cc008008c05800501348c048c04cc04cc04cc04cc04cc04cc04cc04c00644646600200200644b30010018a508acc004c00cdd7180a800c528c4cc008008c058005010202698069baa008911919800800801912cc00400629422b3001300330150018a51899801001180b000a020404c911111111114c004cc88cc896600200513301f4c10180003301f374e00297ae08992cc004c8cc00400400c896600200314a315980099baf302330203754604600200713300200230240018a504078810a2660406e9c00ccc080dd380125eb822c80e0c080c074dd51807980e9baa30200024078660046eb0c078c06cdd50091198011bab300e301c3754601c60386ea8004048cc008dd61806180d9baa0122330023756601c60386ea800404888c8cc00400400c896600200314bd7044cc8966002600a00513302100233004004001899802002000a03a30200013021001407844646600200200644b30010018a508992cc004cdc8802000c4cdc7802000c4cc00c00cc08800901c1bae301c302000140792259800800c520008980599801001180f800a038912cc0040062900044c02ccc008008c07c00501c48c966002601e60346ea80062603c60366ea80062c80c8c02cc068dd5000c888c8cc88cc008008004896600200300389919912cc004cdc8803801456600266e3c01c00a20030064081133005005302600440806eb8c07c004dd698100009811000a0403300b0040031480012222298009bac30210059bac3021302200598020024c00c00e444602d3001003801400500424444464b3001301c00d8acc004cc030dd6181398121baa01b23375e6050604a6ea80040b22b300130280058992cc0056600200f14a314a081322b30013371e6eb8c0a0c094dd5000a441008acc004cdc79bae30173025375400291011effffffffffffffffffffffffffffffffffffffffffffffffffffffffffff008cc004dd5980a18129baa01c80dd220100400d14a0811a29410234528204633001302700501a8b204a8b20448acc004c06403626644b3001302a0088991980a0008992cc004cdc39b8d004480e22b30010038acc00660026eacc05cc0a0dd500fc07a00880322b3001337206eb8c0acc0a0dd5001002456600266e40010dd7180d18141baa0028acc004c070c0200062b30013301000125980099b8f375c605860526ea8004dd7181618149baa003899b8f375c603660526ea8004016294102744cc04000496600266e3cdd7181618149baa001005899b8f375c603660526ea8004dd7180d98149baa0038a50409d14a0813229410264528204c8a50409914a0813229410264528204c3301300823300500101e300a301830263754605201116409c6eb8c09cc090dd500f198071bac300f30243754036466e3c00408a2646644b3001302b002899912cc004c0b402a264b3001330143758602a60546ea80848cdc7800814456600266e1e60026eacc064c0a8dd5010c082008806920018acc004c078c0280322b30013371e6eb8c0b4c0a8dd5001802456600266e3cdd7181698151baa001375c605a60546ea800a2b30013371e6eb8c070c0a8dd50009bae301c302a375400713371e6eb8c070c0a8dd5001002452820508a5040a115980099b8f375c605a60546ea80080122b30013371e6eb8c0b4c0a8dd50009bae302d302a375400715980099b8f375c603860546ea8004dd7180e18151baa002899b8f375c603860546ea800c0122941028452820508b205040a114a0814229410284528205033006302c00a01f8b2054302a003302a0028b20503029001375c6050604a6ea807ccc0400188c8cc04c0044004c024c05cc094dd5000a04440884464b3001301a32330010010022259800800c52000899914c004dd718148014dd598150014896600200310038991991180f9980280298198021bae302c001375a605a002605e0028169222330010010021815800998010011816000a0528992cc004c070c0180062646602a0022b3001337206eb8c0acc0a0dd50009bae301a30283754003159800981600144c8c966002603e6eb4c0a800a2b30015980099b8f001375c605a60546ea800e2946266e3c00522010040a110038b20508b2050375c605000260560051640a51640986016009164094660280020051640906eacc05cc094dd500104590080c024004c010dd5004c52689b2b200401", "script_hash": "0c3a5efef639244026bffcb83d83740a307a4ee7fa72f8371c03f7e8"}]};
const MODULE_RWA = {"id": "rwa-token", "name": "RWA Token (German & Swiss profiles)", "description": "Programmable real-world-asset tokens designed as reference profiles supporting the implementation of German (eWpG) and Swiss (OR, ledger-based securities) requirements. Provides KYC-gated transfers, denylisting, global pause, forced transfers and seizures, supply caps, role-based permissions and an irreversible decommission mechanism, plus a metadata schema covering ISIN, terms of issue, issuer details, nominal amount and register/custodian references. Technical functionality only \u2014 it does not imply or ensure legal or regulatory compliance in any jurisdiction.", "validators": [{"title": "denylist.denylist_validator.spend", "script_bytes": "59019f010100229800aba2aba1aba0aab9faab9eaab9dab9a9bae0024888888896600264653001300900198049805000cc0240092225980099b8748008c020dd500144c8cc896600266e1d2000300b375400d15980098061baa0068992cc004cdc3a400060186ea8006264b3001337109000194c004006660046eacc8c004c040dd5180098081baa301330103754008460266028002019480010011112cc00400a200313298008024c05800e6466e00dd698098010019bae30110014010602800480923300159800998009bab30113012301230123012300e375400c01714a314a0807a94294500c45282018223232330010010042259800800c00e26464b30013372200c00315980099b8f00600189bab3014002802a024899802002180c001a024375c6024002602a002809852f5bded8c116402c64660020026eb0c040c034dd5002912cc004006298103d87a80008992cc004cdd7980918079baa001005899ba548000cc0440052f5c1133003003301300240346022002807a2c806a2c8050c034004c034c038004c024dd50014590070c024004c010dd5004c52689b2b20041", "script_hash": "f32dd74fe801f1842013d99da71bd882a65ac7565fb7549a24c5fd9e"}]};
const clone = v => JSON.parse(JSON.stringify(v));
const modules = (...rows) => parseModules(rows.map(clone));

test('parser accepts the real module records and retains no script bytes', () => {
  const parsed = modules(MODULE_DUMMY, MODULE_FREEZE, MODULE_RWA);
  assert.equal(parsed.length, 3);
  assert.deepEqual(Object.keys(parsed[0]), ['id', 'name', 'description', 'validators']);
  assert.deepEqual(Object.keys(parsed[0].validators[0]), ['title', 'scriptHash', 'computedHash', 'scriptByteLength']);
  assert.equal(JSON.stringify(parsed).includes('script_bytes'), false);
  assert.equal(JSON.stringify(parsed).includes('scriptBytes'), false);
  const dummy = parsed[0];
  assert.equal(dummy.id, 'dummy');
  assert.equal(dummy.validators.length, 6);
  assert.equal(dummy.validators[0].scriptByteLength, 139);
});

test('the recomputed Plutus V3 hash equals the stated hash for every real fixture entry', () => {
  const parsed = modules(MODULE_DUMMY, MODULE_FREEZE, MODULE_RWA);
  for (const m of parsed) for (const v of m.validators) {
    assert.equal(v.computedHash, v.scriptHash, v.title);
  }
  // The two distinct Dummy scripts, stated by the indexer, recomputed here:
  assert.equal(plutusV3ScriptHash(MODULE_DUMMY.validators[0].script_bytes), '4be2c6d3f5c5e66f45d20801c0d55341f0ae3b939187c9591ec29028');
  assert.equal(plutusV3ScriptHash(MODULE_DUMMY.validators[3].script_bytes), '6ae51f97696717eb0de100c151a30965a3c4ff97c167124b2b206ba9');
  assert.equal(plutusV3ScriptHash(MODULE_FREEZE.validators[0].script_bytes), '0c3a5efef639244026bffcb83d83740a307a4ee7fa72f8371c03f7e8');
  assert.equal(plutusV3ScriptHash(MODULE_RWA.validators[0].script_bytes), 'f32dd74fe801f1842013d99da71bd882a65ac7565fb7549a24c5fd9e');
});

test('handlers of one compiled validator share one script and one hash', () => {
  const [dummy] = modules(MODULE_DUMMY);
  const issue = dummy.validators.filter(v => v.title.startsWith('transfer.issue.'));
  assert.equal(issue.length, 3);
  assert.ok(issue.every(v => v.computedHash === issue[0].computedHash && v.scriptByteLength === issue[0].scriptByteLength));
  const c = modulesCheck([dummy]);
  assert.equal(c.validatorCount, 6);
  assert.equal(c.uniqueScriptCount, 2);
});

test('parser canonicalises hex case in the script bytes and the stated hash', () => {
  const upper = clone(MODULE_DUMMY);
  upper.validators = upper.validators.map(v => ({ ...v, script_bytes: v.script_bytes.toUpperCase(), script_hash: v.script_hash.toUpperCase() }));
  const [parsed] = parseModules([upper]);
  assert.deepEqual(parsed, modules(MODULE_DUMMY)[0]);
});

test('parser refuses a non-array response and malformed module records, field by field', () => {
  assert.throws(() => parseModules({}), /Unexpected modules response/);
  assert.throws(() => parseModules([null]), /Invalid module record\./);
  assert.throws(() => parseModules([{ ...MODULE_DUMMY, id: 'Dummy' }]), /module ID/);
  assert.throws(() => parseModules([{ ...MODULE_DUMMY, id: '' }]), /module ID/);
  assert.throws(() => parseModules([{ ...MODULE_DUMMY, name: '  ' }]), /module name/);
  assert.throws(() => parseModules([{ ...MODULE_DUMMY, description: 7 }]), /module description/);
  assert.throws(() => parseModules([{ ...MODULE_DUMMY, validators: [] }]), /validators/);
});

test('parser refuses malformed validator records, field by field', () => {
  const withVal = v => [{ ...clone(MODULE_DUMMY), validators: [v] }];
  const good = clone(MODULE_DUMMY).validators[0];
  assert.throws(() => parseModules(withVal({ ...good, title: '' })), /validator title/);
  assert.throws(() => parseModules(withVal({ ...good, script_bytes: '' })), /script bytes/);
  assert.throws(() => parseModules(withVal({ ...good, script_bytes: good.script_bytes + 'a' })), /script bytes/);
  assert.throws(() => parseModules(withVal({ ...good, script_bytes: 'zz' + good.script_bytes.slice(2) })), /script bytes/);
  assert.throws(() => parseModules(withVal({ ...good, script_hash: good.script_hash.slice(0, 54) })), /script hash/);
});

test('the live fixture catalogue passes every check', () => {
  const c = modulesCheck(modules(MODULE_DUMMY, MODULE_FREEZE, MODULE_RWA));
  assert.equal(c.ok, true);
  assert.equal(c.moduleCount, 3);
  assert.equal(c.validatorCount, 8);
  assert.equal(c.uniqueScriptCount, 4);
  assert.equal(c.verifiedCount, 8);
  assert.equal(c.idsUnique, true);
  assert.equal(c.titlesUniqueWithinModules, true);
  assert.equal(c.hashesVerify, true);
});

test('an empty catalogue verifies nothing — no vacuous pass', () => {
  const c = modulesCheck([]);
  assert.equal(c.ok, false);
  assert.equal(c.moduleCount, 0);
  assert.equal(c.validatorCount, 0);
  assert.equal(c.hashesVerify, false);
});

test('one tampered byte in a script fails the hash verdict, and only that verdict', () => {
  const tampered = clone(MODULE_DUMMY);
  const b = tampered.validators[0].script_bytes;
  tampered.validators[0] = { ...tampered.validators[0], script_bytes: b.slice(0, 100) + (b[100] === '0' ? '1' : '0') + b.slice(101) };
  const parsed = parseModules([tampered]);
  assert.notEqual(parsed[0].validators[0].computedHash, parsed[0].validators[0].scriptHash);
  const c = modulesCheck(parsed);
  assert.equal(c.hashesVerify, false);
  assert.equal(c.verifiedCount, 5);
  assert.equal(c.idsUnique, true);
  assert.equal(c.ok, false);
});

test('a stated hash edited to another valid-looking hash fails verification', () => {
  const edited = clone(MODULE_DUMMY);
  edited.validators[0] = { ...edited.validators[0], script_hash: 'aa'.repeat(28) };
  const c = modulesCheck(parseModules([edited]));
  assert.equal(c.hashesVerify, false);
  assert.equal(c.ok, false);
});

test('a module ID listed twice fails the uniqueness verdict', () => {
  const c = modulesCheck(modules(MODULE_DUMMY, MODULE_DUMMY));
  assert.equal(c.idsUnique, false);
  assert.equal(c.ok, false);
});

test('a validator title repeated within a module fails; the same title in another module does not', () => {
  const dup = clone(MODULE_DUMMY);
  dup.validators = [...dup.validators, dup.validators[0]];
  const c = modulesCheck(parseModules([dup]));
  assert.equal(c.titlesUniqueWithinModules, false);
  assert.equal(c.ok, false);
  const other = { ...clone(MODULE_FREEZE), validators: [clone(MODULE_DUMMY).validators[0]] };
  const c2 = modulesCheck(modules(MODULE_DUMMY, other));
  assert.equal(c2.titlesUniqueWithinModules, true);
});

test('getModules refuses an unknown network before any fetch', async () => {
  await assert.rejects(() => getModules('devnet'), /Unknown network/);
});

test('app wires the modules read: verdict, honest partial failure, v1.99', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /getModules\(state\.network\)/);
  assert.match(app, /Module check passed/);
  assert.match(app, /Module check FAILED/);
  assert.match(app, /Substandard modules unavailable\.<\/strong>/);
  assert.match(app, /Substandard modules/);
  assert.match(app, /substandard module catalogue/);
  assert.match(app, /WORKSPACE <span>v1\.99<\/span>/);
});
