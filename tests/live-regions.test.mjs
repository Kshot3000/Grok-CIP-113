import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Live-region coverage for the studio's model panels (v1.273).
//
// Every model panel recomputes its result into a container each time an
// input changes. Before v1.273 those containers were plain divs: a sighted
// user saw the new result, a screen-reader user heard nothing — only a
// validation error (rendered with role="status") was ever announced. The
// button-triggered result regions (simulation, sequence, verify/compare)
// already carried aria-live="polite"; the live model outputs now do too,
// with aria-atomic="true" so a replaced result is announced as one whole
// statement rather than as fragments of whatever changed. Polite, never
// assertive: a computed result must not interrupt what the user is doing.
//
// These are static source tests in the craft.test.mjs pattern — they pin
// the markup contract, they do not claim a live screen-reader run.

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

async function modelOutputs() {
  const app = await read('src/app.js');
  // app.js carries two byte styles (plain quotes and \"-escaped regions);
  // normalize the escapes so one set of assertions covers both.
  const norm = app.replace(/\\"/g, '"');
  const targets = [...new Set([...app.matchAll(/\$\('#([a-z0-9-]+-output)'\)/g)].map((m) => m[1]))].sort();
  return { app, norm, targets };
}

test('every live model output container is a polite atomic live region', async () => {
  const { norm, targets } = await modelOutputs();
  assert.ok(targets.length >= 100, `expected the model panel fleet, got ${targets.length} renderer targets`);
  for (const t of targets) {
    if (t === 'advance-output') continue; // the one <output> element, below
    assert.ok(
      norm.includes(`id="${t}" aria-live="polite" aria-atomic="true"`),
      `${t} must be declared with aria-live="polite" aria-atomic="true"`,
    );
  }
});

test('no model output container is left as a plain unannounced div', async () => {
  const { norm, targets } = await modelOutputs();
  for (const t of targets) {
    if (t === 'advance-output') continue;
    assert.ok(!norm.includes(`<div id="${t}">`), `${t} still declared without live attributes`);
    assert.ok(!norm.includes(`id="${t}"></div>`), `${t} still declared without live attributes`);
  }
});

test('the credit advance readout stays a native <output> element', async () => {
  const { norm, targets } = await modelOutputs();
  // The <output> element carries implicit status semantics of its own, so
  // it is the single deliberate exception to the div rule — pinning it keeps
  // the exception visible instead of letting it look like a miss.
  assert.ok(targets.includes('advance-output'));
  assert.ok(norm.includes('<output id="advance-output">'));
});

test('no live region in the app is assertive', async () => {
  const { norm } = await modelOutputs();
  // Scoped to aria-live: the sequence/supply labs' pre-existing role="alert"
  // design-validation summaries are a different, deliberate pattern and are
  // not model-result regions.
  assert.ok(!norm.includes('aria-live="assertive"'), 'results must never interrupt the user');
});

test('the button-triggered result regions keep their polite live regions', async () => {
  const { norm } = await modelOutputs();
  for (const id of ['simulation-result', 'seq-result', 'design-verify-result', 'registry-compare-result'])
    assert.ok(norm.includes(`id="${id}" aria-live="polite"`), `${id} lost its live region`);
});

test('validation errors keep their own role=status announcement path', async () => {
  const { app } = await modelOutputs();
  const errors = app.match(/class=\\?"validation\\?" role=\\?"status\\?"/g) ?? [];
  assert.ok(errors.length >= 50, `expected the renderer fleet's error path, got ${errors.length}`);
});

test('the page shell toast is a polite status region in index.html', async () => {
  const html = await read('index.html');
  assert.ok(html.includes('id="toast" class="toast" role="status" aria-live="polite"'));
  assert.ok(html.includes('class="skip-link" href="#main"'), 'skip link survives alongside the live regions');
});
