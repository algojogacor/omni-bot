import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { initDatabase, db } from "../src/db";
import { LedgerService } from "../src/services/ledger/service";
import { formatRupiah } from "../src/services/ledger/math";

describe("LedgerService Database Operations", () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterAll(async () => {
    await LedgerService.resetAllData();
  });

  test("setInitialBalance and recordTransaction properly update wallets and recaps", async () => {
    // Measure baseline today recap
    const beforeRecap = await LedgerService.getRecap({ period: "today" });

    // 1. Set initial balance
    await LedgerService.setInitialBalance("tunai", 100000);
    await LedgerService.setInitialBalance("mandiri", 500000);
    await LedgerService.setInitialBalance("gopay", 50000);

    const initial = await LedgerService.getWallets();
    const tunai = initial.find((w) => w.id === "tunai");
    expect(tunai?.balance).toBe(100000);

    // 2. Record an expense: Makan soto 25k pakai tunai
    const today = new Date().toISOString().slice(0, 10);
    await LedgerService.recordTransaction({
      type: "expense",
      amount: 25000,
      walletId: "tunai",
      category: "Makanan",
      description: "Makan soto ayam",
      transactionDate: today,
    });

    const afterExpense = await LedgerService.getWallets();
    const tunaiAfter = afterExpense.find((w) => w.id === "tunai");
    expect(tunaiAfter?.balance).toBe(75000); // 100k - 25k

    // 3. Record a transfer: Tarik tunai 50k dari mandiri ke tunai
    await LedgerService.recordTransaction({
      type: "transfer",
      amount: 50000,
      walletId: "mandiri",
      toWalletId: "tunai",
      description: "Tarik tunai ATM",
      transactionDate: today,
    });

    const afterTransfer = await LedgerService.getWallets();
    const tunaiFinal = afterTransfer.find((w) => w.id === "tunai");
    const mandiriFinal = afterTransfer.find((w) => w.id === "mandiri");
    expect(tunaiFinal?.balance).toBe(125000); // 75k + 50k = 125k
    expect(mandiriFinal?.balance).toBe(450000); // 500k - 50k = 450k

    // 4. Test Recap delta
    const afterRecap = await LedgerService.getRecap({ period: "today" });
    expect(afterRecap.totalExpense - beforeRecap.totalExpense).toBe(25000);
    expect(afterRecap.dateRangeLabel).toBeDefined();

    // 5. Test CSV export
    const csv = await LedgerService.exportCSV();
    expect(csv).toContain("Makan soto ayam");
    expect(csv).toContain("Tarik tunai ATM");
  }, 15000);
});
