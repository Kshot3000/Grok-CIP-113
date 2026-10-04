// CIP-113 learning path + status tracker data.
// Every claim below is paraphrased from the official CIP-113 specification
// (cardano-foundation/CIPs, CIP-0113) and the CIP-0001 process document.
// Re-check the upstream spec before changing status or criteria copy:
// the acceptance checklist is reproduced verbatim from the spec's own
// "Path to Active" section, including its unchecked boxes.

export const SPEC_URL = 'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0113';
export const PROCESS_URL = 'https://github.com/cardano-foundation/CIPs/tree/master/CIP-0001';

// Status snapshot. `checked` is the date this snapshot was last verified
// against the upstream spec frontmatter — update it only after re-reading
// the spec, never by assumption.
export const CIP113_STATUS = Object.freeze({
  status: 'Proposed',
  checked: '2026-10-04',
  merged: '2026-09-29',
  specVersion: '3.0',
  category: 'Tokens',
  authors: ['Michele Nuzzi', 'Matteo Coppola', 'Philip DiSarro', 'Giovanni Gargiulo'],
  solves: 'CPS-0003',
});

// The spec's own "Path to Active" acceptance criteria (verbatim labels).
// `specChecked` mirrors the checkbox state in the spec itself; as of the
// last check every box is unchecked, which is exactly what "Proposed"
// means. `note` is PRISM's grounded context — it must never claim a
// criterion is met while the spec leaves it unchecked.
export const ACCEPTANCE_CRITERIA = Object.freeze([
  {
    id: 'issuance-preview',
    label: 'Issuance of at least one programmable token on Preview testnet',
    specChecked: false,
    note: 'Shared infrastructure is bootstrapped on Preview — PRISM’s Network explorer loads the schema-3 reference transaction from the Foundation platform. The Foundation platform targets Preview, but the spec’s own box remains unchecked.',
  },
  {
    id: 'issuance-mainnet',
    label: 'Issuance of at least one programmable token on Mainnet',
    specChecked: false,
    note: 'No mainnet issuance is claimed anywhere upstream. The Foundation reference platform describes itself as R&D, not production-ready, with an independent audit pending. Treat this as not met.',
  },
  {
    id: 'e2e-tests',
    label: 'End-to-end tests of programmable token logic',
    specChecked: false,
    note: 'Reference validators and off-chain code exist upstream and are where this evidence will come from. Only the CIP authors/editors can check this box, via a status-change pull request.',
  },
  {
    id: 'wallet-adoption',
    label: 'A widely adopted wallet that displays programmable-token balances and supports transfers',
    specChecked: false,
    note: 'No widely adopted wallet publicly advertises CIP-113 balance display or transfers yet. PRISM implements only the spec’s address-derivation format, read-only, in the Network explorer.',
  },
]);

// The spec's "Implementation Plan" — workstreams, not acceptance gates.
export const IMPLEMENTATION_PLAN = Object.freeze([
  {
    id: 'contracts',
    label: 'Implement the contracts detailed in the specification',
    state: 'Reference exists upstream',
    note: 'The Cardano Foundation core repository holds the reference Aiken validators for the registry, base script, and delegates. Reference code still requires independent review before production use.',
  },
  {
    id: 'offchain',
    label: 'Implement the off-chain code to query balances and construct transfer transactions',
    state: 'Reference exists upstream',
    note: 'The Foundation platform provides a self-hosted backend and indexer. There is no publicly hosted registry endpoint — which is why PRISM’s registry panel shows an honest “not connected” state instead of invented data.',
  },
]);

// Plain-language lessons, in reading order. Each lesson names the spec
// section it paraphrases so a reader can verify it in minutes.
export const LEARNING_PATH = Object.freeze([
  {
    id: 'why',
    title: 'Why programmable tokens exist',
    plain: 'A normal Cardano token, once minted, can move between any addresses with no rules attached. That is a problem if the law — or the product — says otherwise: a regulated stablecoin issuer must be able to freeze accounts, a security must only reach eligible holders, and a membership pass should not be freely resalable. CIP-113 defines tokens that only change owner when a script says yes.',
    detail: 'The standard needs no hard fork. It is built from primitives Cardano already has: native tokens, stake credentials, and the withdraw-zero pattern.',
    specSection: 'Motivation',
  },
  {
    id: 'smart-wallet',
    title: 'One shared vault address, many owners',
    plain: 'Every programmable token lives at the same payment address — the hash of one shared “base” script, identical for everyone. What makes a balance yours is the stake credential attached to it: your smart-wallet address is that fixed payment credential plus your own stake credential. Ownership is proven by the credential, not by holding a special account.',
    detail: 'Because the address is derived deterministically from your own payment or stake credential, any wallet can compute your smart-wallet address independently — no registration step, which earlier drafts required and the community rejected.',
    specSection: 'User’s smart wallet address derivation',
  },
  {
    id: 'withdraw-zero',
    title: 'The withdraw-zero trick',
    plain: 'To move a programmable token, the transaction must invoke the protocol’s global stake validator with a withdrawal of exactly zero lovelace. That sounds like a no-op, but invoking it is what forces the real checks to run. The base script itself does almost nothing else — it runs once per programmable-token input, so keeping it minimal keeps transfers cheap.',
    detail: 'The actual validation lives in separate “action delegate” withdraw-zero scripts — one each for transfers, third-party actions, and unfracking — which read the live protocol parameters, so the framework can be upgraded without moving anyone’s tokens.',
    specSection: 'Layer 2: Standard Components',
  },
  {
    id: 'registry',
    title: 'The registry: a phone book for token rules',
    plain: 'Before a wallet can enforce a token’s rules, it has to find them. The registry is an on-chain sorted linked list with one entry per programmable token, ordered by policy ID. Each entry is a UTxO holding the hashes of that token’s logic scripts. A transfer carries a proof that the policy is in the registry (so its rules must run) — or that it is not, in which case the asset is treated as an ordinary native token and can always leave.',
    detail: 'Entries are marked by a unique NFT minted under the registry policy, and the registry validator cryptographically binds each entry’s minting-logic field to the registering transaction, so an entry cannot lie about which logic governs its token.',
    specSection: 'Layer 1: Registry Components',
  },
  {
    id: 'substandards',
    title: 'Substandards: the rule books',
    plain: 'The shared framework only routes a transfer — the rules themselves live in a “substandard”: the token-specific set of withdraw-zero scripts for transfers, third-party actions, and issuance. Every programmable token must belong to a substandard, because that is how wallets and apps know how to interact with it. Freeze-and-seize, KYC, and KYC-extended are substandards published with the Foundation’s reference platform.',
    detail: 'PRISM’s Token studio models those three substandards locally, check by check — a design exercise only. Nothing is deployed, and no on-chain list, certificate, or allowlist is read.',
    specSection: 'Layer 3: Substandard Components',
  },
  {
    id: 'actions',
    title: 'More than transfers: third-party actions and unfracking',
    plain: 'Two other actions complete the model. Third-party actions let someone other than the holder act on a token — seizure by an authorised issuer, forced transfers, or auto-compounding — but only as the token’s substandard allows. “Unfracking” is the holder reorganising their own UTxOs without changing ownership, for example separating programmable tokens from ordinary ones; the default is least-permission — an empty credential in the registry entry forbids it.',
    detail: 'Each action has its own delegate and its own redeemer carrying the indices and registry proofs that action needs, validated by the delegate itself.',
    specSection: 'Transfer',
  },
]);

export function criteriaProgress(criteria = ACCEPTANCE_CRITERIA) {
  const met = criteria.filter(c => c.specChecked).length;
  return { met, total: criteria.length };
}
