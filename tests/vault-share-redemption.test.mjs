import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVaultShareRedemption } from '../src/domain.js';

// Vault share redemption model (v1.236): redeeming shares from a
// share-based vault burns them at the price before the redemption; the
// gross value is floored, the disclosed exit fee is floored on that
// gross value, and the redeemer receives the rest.
const DEFAULT = { totalAssets: '1000000', decimals: 6, totalShares: '800000', sharesRedeemed: '200000', exitFeeBps: 100 };

test('the preloaded redemption: 200000 shares from a vault holding 1000000 with 800000 shares pays 247500 net of a 2500 exit fee', () => {
  const r = modelVaultShareRedemption(DEFAULT);
  assert.equal(r.grossValue, 250000000000n);
  assert.equal(r.exitFee, 2500000000n);
  assert.equal(r.netPayout, 247500000000n);
  assert.equal(r.totalAssetsAfter, 750000000000n);
  assert.equal(r.totalSharesAfter, 600000000000n);
  assert.equal(r.redeemedShareBpsText, '2500.00');
  assert.equal(r.remainingShareBpsText, '7500.00');
  assert.equal(r.netPayoutShareBpsText, '2475.00');
  assert.equal(r.exitFeeShareBpsText, '100.00');
  assert.equal(r.partialRedemption, true);
});

test('identities hold across vault states, redemptions, and decimals', () => {
  const cases = [
    { totalAssets: '5000', decimals: 6, totalShares: '4000', sharesRedeemed: '1000', exitFeeBps: 150 },
    { totalAssets: '250', decimals: 2, totalShares: '250', sharesRedeemed: '250', exitFeeBps: 0 },
    { totalAssets: '777', decimals: 0, totalShares: '333', sharesRedeemed: '123', exitFeeBps: 99 },
    { totalAssets: '0', decimals: 6, totalShares: '0', sharesRedeemed: '0', exitFeeBps: 100 },
    { totalAssets: '42', decimals: 6, totalShares: '100000', sharesRedeemed: '99999', exitFeeBps: 50 },
  ];
  for (const c of cases) {
    const r = modelVaultShareRedemption(c);
    assert.equal(r.totalAssetsAfter, r.totalAssets - r.grossValue);
    assert.equal(r.totalSharesAfter, r.totalShares - r.sharesRedeemed);
    assert.equal(r.netPayout + r.exitFee, r.grossValue);
    assert.ok(r.grossValue <= r.totalAssets);
    assert.ok(r.netPayout <= r.grossValue);
  }
});

test('the gross value is floored on the pre-redemption price, never rounded up', () => {
  const r = modelVaultShareRedemption({ totalAssets: '11', decimals: 6, totalShares: '7', sharesRedeemed: '3', exitFeeBps: 250 });
  assert.equal(r.grossValue, 4714285n);
  assert.equal(r.exitFee, 117857n);
  assert.equal(r.netPayout, 4596428n);
  assert.equal(r.redemptionFloors, true);
  assert.ok(r.sharesRedeemed * r.totalAssets >= r.grossValue * r.totalShares);
});

test('shares are derived from the amounts, not from any holder count', () => {
  const r = modelVaultShareRedemption({ totalAssets: '11', decimals: 6, totalShares: '7', sharesRedeemed: '3', exitFeeBps: 333 });
  assert.equal(r.redeemedShareBpsText, '4285.71');
  assert.equal(r.remainingShareBpsText, '5714.28');
  assert.equal(r.netPayoutShareBpsText, '4143.00');
  assert.equal(r.exitFeeShareBpsText, '332.99');
});

test('the exit fee is charged on the gross value redeemed, never on what remains in the vault', () => {
  const r = modelVaultShareRedemption(DEFAULT);
  assert.equal(r.exitFee, r.grossValue * 100n / 10000n);
  assert.equal(r.totalAssetsAfter, 750000000000n);
});

test('a full redemption empties the vault exactly: no shares and no assets remain', () => {
  const r = modelVaultShareRedemption({ ...DEFAULT, sharesRedeemed: '800000' });
  assert.equal(r.fullRedemption, true);
  assert.equal(r.grossValue, 1000000000000n);
  assert.equal(r.netPayout, 990000000000n);
  assert.equal(r.totalAssetsAfter, 0n);
  assert.equal(r.totalSharesAfter, 0n);
  assert.equal(r.redemptionFloors, false);
});

test('a zero redemption burns nothing, pays nothing, and changes nothing', () => {
  const r = modelVaultShareRedemption({ ...DEFAULT, sharesRedeemed: '0' });
  assert.equal(r.noRedemption, true);
  assert.equal(r.fullRedemption, false);
  assert.equal(r.grossValue, 0n);
  assert.equal(r.netPayout, 0n);
  assert.equal(r.totalAssetsAfter, r.totalAssets);
  assert.equal(r.totalSharesAfter, r.totalShares);
  assert.equal(r.remainingShareBpsText, '10000.00');
});

test('redeeming more shares than are outstanding is refused', () => {
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, sharesRedeemed: '800001' }), /must not exceed the shares outstanding/);
});

test('a vault holding assets but no shares is refused: there is no price to redeem against', () => {
  assert.throws(() => modelVaultShareRedemption({ totalAssets: '100', decimals: 6, totalShares: '0', sharesRedeemed: '0', exitFeeBps: 100 }), /holding assets but no shares/);
});

test('a vault with shares outstanding but no assets is refused: its shares claim nothing', () => {
  assert.throws(() => modelVaultShareRedemption({ totalAssets: '0', decimals: 6, totalShares: '100', sharesRedeemed: '10', exitFeeBps: 100 }), /shares outstanding but no assets/);
});

test('an exit fee taking the whole redemption is refused', () => {
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, exitFeeBps: 10000 }), /must not take the whole redemption/);
});

test('a stated exit fee that floors to zero on a small redemption is stated, not presented as taken', () => {
  const r = modelVaultShareRedemption({ totalAssets: '10', decimals: 0, totalShares: '10', sharesRedeemed: '1', exitFeeBps: 250 });
  assert.equal(r.grossValue, 1n);
  assert.equal(r.exitFee, 0n);
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.netPayout, 1n);
});

test('with no exit fee the redeemer receives the whole gross value', () => {
  const r = modelVaultShareRedemption({ totalAssets: '1000', decimals: 0, totalShares: '500', sharesRedeemed: '125', exitFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.grossValue, 250n);
  assert.equal(r.netPayout, 250n);
  assert.equal(r.netPayoutShareBpsText, '2500.00');
});

test('an appreciated vault pays more per share than a vault at par, at the same fee', () => {
  const par = modelVaultShareRedemption({ totalAssets: '1000', decimals: 0, totalShares: '1000', sharesRedeemed: '100', exitFeeBps: 100 });
  const appreciated = modelVaultShareRedemption({ totalAssets: '2000', decimals: 0, totalShares: '1000', sharesRedeemed: '100', exitFeeBps: 100 });
  assert.equal(par.grossValue, 100n);
  assert.equal(appreciated.grossValue, 200n);
  assert.equal(appreciated.netPayout, 198n);
  assert.equal(appreciated.netPayoutShareBpsText, '990.00');
});

test('the remaining holders keep exactly the shares that were not redeemed', () => {
  const r = modelVaultShareRedemption(DEFAULT);
  assert.equal(r.totalShares - r.totalSharesAfter, r.sharesRedeemed);
  assert.equal(r.remainingShareBpsText, '7500.00');
});

test('bad amounts and bad fees are refused', () => {
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, sharesRedeemed: '-1' }), /positive decimal amount/);
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, totalAssets: '1,000' }), /positive decimal amount/);
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, exitFeeBps: 10001 }), /Exit fee must be/);
  assert.throws(() => modelVaultShareRedemption({ ...DEFAULT, exitFeeBps: 2.5 }), /Exit fee must be/);
});

test('wiring: app.js imports the model, renders a vault share redemption panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVaultShareRedemption/);
  assert.match(app, /data-vaultred/);
  assert.match(app, /vaultred-output/);
  assert.match(app, /v1\.236/);
  assert.match(readme, /Vault share redemption model/);
});
