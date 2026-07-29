import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { type Posting, balanceOf, emptyBalances, postEntry, totalMicro } from "../src/ledger.js";

const ACCOUNTS = ["a", "b", "c", "d"] as const;
const ALLOW_ALL: ReadonlySet<string> = new Set(ACCOUNTS);

/** Zero-sum by construction: each transfer is a (from, to, amount) triple. */
const arbTransfers = fc.array(
  fc.record({
    from: fc.constantFrom(...ACCOUNTS),
    to: fc.constantFrom(...ACCOUNTS),
    amount: fc.integer({ min: 1, max: 1_000_000_000 }),
  }),
  { maxLength: 50 },
);

describe("ledger properties", () => {
  it("total of all balances is invariant under any sequence of entries (INV-CONSERVE)", () => {
    fc.assert(
      fc.property(arbTransfers, (transfers) => {
        let balances = emptyBalances();
        for (const t of transfers) {
          if (t.from === t.to) continue;
          balances = postEntry(
            balances,
            [
              { account: t.from, amountMicro: -t.amount },
              { account: t.to, amountMicro: t.amount },
            ],
            ALLOW_ALL,
          );
          expect(totalMicro(balances)).toBe(0);
        }
      }),
    );
  });

  it("rejects entries whose postings do not sum to zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (amount, skew) => {
          const postings: Posting[] = [
            { account: "a", amountMicro: -amount },
            { account: "b", amountMicro: amount + skew },
          ];
          expect(() => postEntry(emptyBalances(), postings, ALLOW_ALL)).toThrow(/does not balance/);
        },
      ),
    );
  });

  it("rejects entries that would overdraw an unprotected account, leaving balances untouched", () => {
    let balances = emptyBalances();
    balances = postEntry(
      balances,
      [
        { account: "treasury", amountMicro: -100 },
        { account: "a", amountMicro: 100 },
      ],
      new Set(["treasury"]),
    );
    expect(() =>
      postEntry(balances, [
        { account: "a", amountMicro: -101 },
        { account: "b", amountMicro: 101 },
      ]),
    ).toThrow(/insufficient funds/);
    expect(balanceOf(balances, "a")).toBe(100);
    expect(balanceOf(balances, "b")).toBe(0);
  });

  it("rejects non-integer amounts and single-posting entries", () => {
    expect(() =>
      postEntry(emptyBalances(), [
        { account: "a", amountMicro: -0.5 },
        { account: "b", amountMicro: 0.5 },
      ]),
    ).toThrow(/safe integer/);
    expect(() => postEntry(emptyBalances(), [{ account: "a", amountMicro: 0 }])).toThrow(/two postings/);
  });
});
