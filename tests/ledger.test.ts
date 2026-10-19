import { describe, expect, test } from "bun:test";
import {
  formatRupiah,
  parseRupiahAmount,
  computeBalancesFromTransactions,
  getWIBDateRange,
} from "../src/services/ledger/math";

describe("Ledger Math & Currency Formatting", () => {
  test("formatRupiah formats integer to Indonesian Rupiah", () => {
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(18000)).toBe("Rp18.000");
    expect(formatRupiah(1500000)).toBe("Rp1.500.000");
    expect(formatRupiah(-25000)).toBe("-Rp25.000");
  });

  test("parseRupiahAmount extracts integer amount from colloquial Indonesian", () => {
    expect(parseRupiahAmount("18k")).toBe(18000);
    expect(parseRupiahAmount("18rb")).toBe(18000);
    expect(parseRupiahAmount("18ribu")).toBe(18000);
    expect(parseRupiahAmount("18.000")).toBe(18000);
    expect(parseRupiahAmount("18000")).toBe(18000);
    expect(parseRupiahAmount("1,5jt")).toBe(1500000);
    expect(parseRupiahAmount("1.5jt")).toBe(1500000);
    expect(parseRupiahAmount("250rb")).toBe(250000);
    expect(parseRupiahAmount("kopi")).toBeNull();
  });

  test("computeBalancesFromTransactions correctly adjusts wallets", () => {
    const initialWallets = {
      tunai: 100000,
      gopay: 50000,
      mandiri: 500000,
    };

    const mockTransactions = [
      // Expense 20k from Tunai
      { type: "expense" as const, amount: 20000, walletId: "tunai" },
      // Income 150k to Mandiri
      { type: "income" as const, amount: 150000, walletId: "mandiri" },
      // Transfer 50k from Mandiri to GoPay
      { type: "transfer" as const, amount: 50000, walletId: "mandiri", toWalletId: "gopay" },
    ];

    const balances = computeBalancesFromTransactions(initialWallets, mockTransactions);

    // Tunai: 100k - 20k = 80k
    expect(balances.tunai).toBe(80000);
    // GoPay: 50k + 50k (transfer masuk) = 100k
    expect(balances.gopay).toBe(100000);
    // Mandiri: 500k + 150k - 50k (transfer keluar) = 600k
    expect(balances.mandiri).toBe(600000);
    // Total net balance: 80k + 100k + 600k = 780k
    // (Initial total was 650k, -20k expense + 150k income = 780k. Transfer doesn't affect total!)
    const total = balances.tunai + balances.gopay + balances.mandiri;
    expect(total).toBe(780000);
  });

  test("getWIBDateRange returns correct Asia/Jakarta boundaries and Indonesian label", () => {
    // Fixed test date: 2026-10-19T10:00:00Z (which is Monday 19 Oct 2026 17:00 WIB)
    const refDate = new Date("2026-10-19T10:00:00Z");

    const todayRange = getWIBDateRange("today", refDate);
    expect(todayRange.startDateString).toBe("2026-10-19");
    expect(todayRange.endDateString).toBe("2026-10-19");
    expect(todayRange.label).toContain("19 Okt 2026");

    const thisWeekRange = getWIBDateRange("this_week", refDate);
    // Monday 19 Oct to Sunday 25 Oct 2026
    expect(thisWeekRange.startDateString).toBe("2026-10-19");
    expect(thisWeekRange.endDateString).toBe("2026-10-25");
    expect(thisWeekRange.label).toContain("Senin");
    expect(thisWeekRange.label).toContain("Minggu");
  });
});
