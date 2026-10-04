// Focus management for PRISM's single modal dialog, kept separate from the
// DOM-heavy app module so the rules are unit-testable with plain mocks (the
// same pattern as the wallet adapters in services.js).
//
// The contract:
// - When a modal opens, remember which element invoked it — but only when
//   opening from a closed state. A modal that replaces its own content
//   (the clipboard-fallback copy dialog) must keep the ORIGINAL invoker,
//   because the element that triggered the replacement is about to be
//   removed from the document with the old content.
// - Move focus into the dialog so keyboard and screen-reader users land on
//   the new content instead of staying on a now-covered page.
// - When the dialog closes — by button, by Escape, or programmatically —
//   return focus to the invoker if it is still in the document. A detached
//   invoker is skipped silently; forcing focus nowhere is better than
//   throwing or focusing a removed node.

export const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function captureInvoker(doc) {
  const el = doc?.activeElement;
  if (!el || el === doc.body || typeof el.focus !== 'function') return null;
  return el;
}

export function focusFirst(container) {
  if (!container || typeof container.querySelector !== 'function') return false;
  const el = container.querySelector(FOCUSABLE_SELECTOR);
  if (!el || typeof el.focus !== 'function') return false;
  el.focus();
  return true;
}

export function restoreFocus(el) {
  if (!el || el.isConnected === false || typeof el.focus !== 'function') return false;
  el.focus({ preventScroll: true });
  return true;
}
