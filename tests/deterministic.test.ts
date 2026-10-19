import { describe, expect, test } from "bun:test";
import { parseDeterministicMessage } from "../src/services/parser/deterministic";

describe("Deterministic Offline Parser", () => {
  test("parses simple expense with wallet", () => {
    const res = parseDeterministicMessage("kopi 18rb gopay");
    expect(res.intent).toBe("transaction");
    if (res.intent === "transaction") {
      expect(res.data.type).toBe("expense");
      expect(res.data.amount).toBe(18000);
      expect(res.data.wallet).toBe("GoPay");
      expect(res.data.description.toLowerCase()).toContain("kopi");
      expect(res.data.category).toBe("Makanan");
    }
  });

  test("parses expense without wallet (prompts for wallet)", () => {
    const res = parseDeterministicMessage("bensin motor 20k");
    expect(res.intent).toBe("transaction");
    if (res.intent === "transaction") {
      expect(res.data.type).toBe("expense");
      expect(res.data.amount).toBe(20000);
      expect(res.data.wallet).toBeNull();
      expect(res.data.category).toBe("Transport");
    }
  });

  test("parses wallet transfer", () => {
    const res = parseDeterministicMessage("transfer 50rb dari mandiri ke gopay");
    expect(res.intent).toBe("transfer");
    if (res.intent === "transfer") {
      expect(res.data.amount).toBe(50000);
      expect(res.data.fromWallet).toBe("Mandiri");
      expect(res.data.toWallet).toBe("GoPay");
    }
  });

  test("parses balance query", () => {
    const res = parseDeterministicMessage("cek saldo");
    expect(res.intent).toBe("recap");
    if (res.intent === "recap") {
      expect(res.data.askBalance).toBe(true);
    }
  });

  test("parses recap queries for yesterday, specific date, and periods", () => {
    const yesterday = parseDeterministicMessage("kemarin keluar berapa?");
    expect(yesterday.intent).toBe("recap");
    if (yesterday.intent === "recap") {
      expect(yesterday.data.startDate).toBeDefined();
      expect(yesterday.data.startDate).toBe(yesterday.data.endDate);
    }

    const specificDate = parseDeterministicMessage("pengeluaran tanggal 15 berapa?");
    expect(specificDate.intent).toBe("recap");
    if (specificDate.intent === "recap") {
      expect(specificDate.data.startDate).toContain("-15");
    }

    const weekRecap = parseDeterministicMessage("rekap minggu ini");
    expect(weekRecap.intent).toBe("recap");
    if (weekRecap.intent === "recap") {
      expect(weekRecap.data.period).toBe("this_week");
    }

    const monthFood = parseDeterministicMessage("pengeluaran makanan bulan ini");
    expect(monthFood.intent).toBe("recap");
    if (monthFood.intent === "recap") {
      expect(monthFood.data.period).toBe("this_month");
      expect(monthFood.data.category).toBe("Makanan");
    }
  });

  test("detects group logs as unprocessable offline", () => {
    const multiline = `[10/19, 09:00] Budi: Rapat jam 1 siang nanti ya teman-teman
[10/19, 09:01] Siti: Siap, Arya jangan lupa bawa materi hukum perdata
[10/19, 09:05] Arya: Oke siap`;
    const res = parseDeterministicMessage(multiline);
    expect(res.intent).toBe("group_log_unsupported");
  });
});
