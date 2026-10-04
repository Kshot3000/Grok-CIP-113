# Primary sources

Checked **2026-10-03**; substandard module references re-checked **2026-10-04**; CIP-113 frontmatter status and “Path to Active” checklist re-verified **2026-10-04** for the Learn page status tracker. Standards, deployments, APIs, and products may change.

| Source | Used for |
| --- | --- |
| [CIP-113](https://github.com/cardano-foundation/CIPs/tree/master/CIP-0113) | Proposed status, three-layer model, smart-wallet ownership, and action-delegate semantics. |
| [CIP-19](https://github.com/cardano-foundation/CIPs/tree/master/CIP-0019) | Address headers, payload lengths, and conformance test vector. |
| [CIP-30](https://github.com/cardano-foundation/CIPs/tree/master/CIP-0030) | Wallet discovery, enablement, network ID, and change address. |
| [Core implementation](https://github.com/cardano-foundation/cip113-programmable-tokens) | Reference implementation and architecture links. |
| [Programmable Tokens Platform](https://github.com/cardano-foundation/cip113-programmable-tokens-platform) | R&D/audit status, testnet implementation, and optional registry API surface. |
| [Freeze-and-seize module](https://github.com/cardano-foundation/cip113-programmable-tokens-platform/tree/main/src/modules/freeze-and-seize) | Denylist semantics: both transfer parties checked against the on-chain sorted-list denylist; authorised freeze/seizure of denylisted holders. Modeled locally in the substandard lab. |
| [KYC module walkthrough](https://github.com/cardano-foundation/cip113-programmable-tokens-platform/tree/main/docs/modules/kyc) | Sender-certificate model: trusted-entity list, signature, sender binding, ~30-day expiry, global-state pause flag; recipients unchecked. Modeled locally. |
| [KYC-extended walkthrough](https://github.com/cardano-foundation/cip113-programmable-tokens-platform/tree/main/docs/modules/kyc-extended) | Recipient allowlist anchored by a Merkle Patricia Forestry root, entry TTL/expiry, publisher lag, and the self-transfer exemption. Modeled locally. |
| [Preview bootstrap source](https://github.com/cardano-foundation/cip113-programmable-tokens-platform/blob/main/src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-preview.json) | Schema-3 reference transaction, base script hash, and protocol-parameters policy snapshot. |
| [Midnight connector API](https://github.com/midnightntwrk/midnight-dapp-connector-api) | API v4 discovery, network-aware connection, connection status, and public unshielded address. |
| [Midnight network endpoints](https://docs.midnight.network/relnotes/network) | Mainnet provider migration and distinct test networks. |
| [Midnight contract deployment guide](https://docs.midnight.network/guides/deploy-and-operate) | The engineering boundary between a local model and a deployed proof application. |
| [RealFi official site](https://realfi.co/) | Current product names and official app link. No product yield or reserve metrics are reproduced. |
| [Koios API](https://api.koios.rest/) | Public chain tip and native asset lookup endpoints. |

The original CIP-113 authors listed in the checked specification are Michele Nuzzi, Matteo Coppola, Philip DiSarro, and Giovanni Gargiulo. Credit also belongs to the contributors and reviewers of the reference implementations. PRISM paraphrases the architectural concepts and provides its own UI and local models; upstream code and documents retain their original licenses.
