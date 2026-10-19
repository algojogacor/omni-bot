import { describe, expect, test } from "bun:test";
import {
  formatRupiah,
  parseRupiahAmount,
  extractRupiahAmounts,
  isExtremeAmount,
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
    expect(parseRupiahAmount("50 rb")).toBe(50000);
    expect(parseRupiahAmount("50 k")).toBe(50000);
    expect(parseRupiahAmount("Rp 50.000")).toBe(50000);
    expect(parseRupiahAmount("seratus ribu")).toBe(100000);
    expect(parseRupiahAmount("dua puluh lima ribu")).toBe(25000);
    expect(parseRupiahAmount("tiga ratus lima puluh ribu")).toBe(350000);
    expect(parseRupiahAmount("sejuta")).toBe(1000000);
    expect(parseRupiahAmount("satu juta")).toBe(1000000);
    expect(parseRupiahAmount("dua juta lima ratus ribu")).toBe(2500000);
    expect(parseRupiahAmount("sepuluh ribu")).toBe(10000);
    expect(parseRupiahAmount("dua belas ribu")).toBe(12000);
    expect(parseRupiahAmount("setengah juta")).toBe(500000);
    expect(parseRupiahAmount("kopi")).toBeNull();
  });

  test("extractRupiahAmounts finds multiple amounts in a sentence", () => {
    const text = "kopi 18rb, parkir 3rb, bayar kas 20rb pake gopay";
    const found = extractRupiahAmounts(text);
    expect(found.length).toBe(3);
    expect(found[0].amount).toBe(18000);
    expect(found[1].amount).toBe(3000);
    expect(found[2].amount).toBe(20000);

    const wordText = "keluar seratus ribu dari mandiri dan beli bensin dua puluh lima ribu";
    const foundWord = extractRupiahAmounts(wordText);
    expect(foundWord.length).toBe(2);
    expect(foundWord[0].amount).toBe(100000);
    expect(foundWord[1].amount).toBe(25000);
  });

  test("isExtremeAmount flags amounts > Rp 10.000.000", () => {
    expect(isExtremeAmount(50000)).toBe(false);
    expect(isExtremeAmount(10000000)).toBe(false);
    expect(isExtremeAmount(10000001)).toBe(true);
    expect(isExtremeAmount(25000000)).toBe(true);
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
