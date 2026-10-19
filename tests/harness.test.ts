import { describe, expect, test, beforeEach } from "bun:test";
import { DraftManager } from "../src/services/draft/manager";
import { formatRupiah, isExtremeAmount } from "../src/services/ledger/math";
import { parseDeterministicMessage } from "../src/services/parser/deterministic";
import { db } from "../src/db";
import { drafts, wallets, transactions, processedUpdates } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../src/bot/middlewares/auth";
import { dedupeMiddleware } from "../src/bot/middlewares/dedupe";
import { env } from "../src/config/env";

describe("Omni-Bot End-to-End Behavioral Harness Test", () => {
  const TEST_USER_ID = "6675963892";
  const UNAUTHORIZED_USER_ID = "9999999999";

  test("Area 1: Access Control - Unauthorized users are silently dropped", async () => {
    let nextCalled = false;
    let replyCalled = false;

    const mockCtxUnauthorized = {
      from: { id: parseInt(UNAUTHORIZED_USER_ID, 10) },
      reply: async () => {
        replyCalled = true;
      },
    } as any;

    await authMiddleware(mockCtxUnauthorized, async () => {
      nextCalled = true;
    });

    // Should NOT call next and NOT reply
    expect(nextCalled).toBe(false);
    expect(replyCalled).toBe(false);

    // Authorized user should proceed
    let authorizedNextCalled = false;
    const mockCtxAuthorized = {
      from: { id: parseInt(TEST_USER_ID, 10) },
    } as any;

    await authMiddleware(mockCtxAuthorized, async () => {
      authorizedNextCalled = true;
    });

    expect(authorizedNextCalled).toBe(true);
  });

  test("Area 2 & 4: Multi-Item Draft Confirmation, Balance Persistence, and Idempotency", async () => {
    // 1. Create a multi-item draft
    const items = [
      {
        type: "expense" as const,
        amount: 18000,
        wallet: "GoPay",
        category: "Makanan",
        description: "Kopi",
        transactionDate: "2026-10-19",
      },
      {
        type: "expense" as const,
        amount: 3000,
        wallet: "GoPay",
        category: "Transport",
        description: "Parkir",
        transactionDate: "2026-10-19",
      },
      {
        type: "expense" as const,
        amount: 20000,
        wallet: "GoPay",
        category: "Kuliah/Organisasi",
        description: "Bayar kas",
        transactionDate: "2026-10-19",
      },
    ];

    const totalAmount = items.reduce((sum, it) => sum + it.amount, 0); // 41000
    const draft = await DraftManager.createDraft(TEST_USER_ID, "transaction", {
      type: "expense",
      amount: totalAmount,
      wallet: "GoPay",
      category: "Lainnya",
      description: "Transaksi Jamak",
      transactionDate: "2026-10-19",
      items,
    });

    expect(draft).toBeDefined();
    expect(draft!.status).toBe("pending");

    // 2. Format draft card check
    const cardText = DraftManager.formatDraftCard(draft);
    expect(cardText).toContain("DRAF TRANSAKSI (3 Item)");
    expect(cardText).toContain("Total*: Rp41.000");

    // 3. Commit draft
    const updatedWallets = await DraftManager.commitDraft(draft!.id);
    expect(updatedWallets).toBeDefined();

    const committedDraft = await DraftManager.getDraft(draft!.id);
    expect(committedDraft!.status).toBe("approved");

    // 4. Double click idempotency: Attempting to commit an already approved draft should throw
    let doubleClickError: string | null = null;
    try {
      await DraftManager.commitDraft(draft!.id);
    } catch (err: any) {
      doubleClickError = err.message;
    }
    expect(doubleClickError).toContain("Draf sudah berstatus 'approved'");
  });

  test("Area 3: Conversational Item Deletion and Price Correction", async () => {
    // 1. Create a multi-item draft with Kopi and Parkir
    const draft = await DraftManager.createDraft(TEST_USER_ID, "transaction", {
      type: "expense",
      amount: 21000,
      wallet: "GoPay",
      category: "Lainnya",
      description: "Transaksi Jamak",
      transactionDate: "2026-10-19",
      items: [
        {
          type: "expense" as const,
          amount: 18000,
          wallet: "GoPay",
          category: "Makanan",
          description: "Kopi",
          transactionDate: "2026-10-19",
        },
        {
          type: "expense" as const,
          amount: 3000,
          wallet: "GoPay",
          category: "Transport",
          description: "Parkir",
          transactionDate: "2026-10-19",
        },
      ],
    });

    // 2. Simulate conversational edit: delete item index 0 ("Kopi")
    const afterDelete = await DraftManager.deleteItem(draft!.id, 0);
    expect(afterDelete).toBeDefined();

    const payloadAfterDel = JSON.parse(afterDelete!.payload);
    expect(payloadAfterDel.items.length).toBe(1);
    expect(payloadAfterDel.items[0].description).toBe("Parkir");
    expect(payloadAfterDel.amount).toBe(3000);

    // 3. Simulate conversational modification: "yang parkir harusnya 5rb"
    payloadAfterDel.items[0].amount = 5000;
    payloadAfterDel.amount = 5000;
    const afterPriceEdit = await DraftManager.updateDraft(draft!.id, payloadAfterDel);
    const payloadAfterEdit = JSON.parse(afterPriceEdit!.payload);

    expect(payloadAfterEdit.amount).toBe(5000);
    expect(payloadAfterEdit.items[0].amount).toBe(5000);

    // Clean up
    await DraftManager.cancelDraft(draft!.id);
  });

  test("Area 4: Extreme Amount Warning Flag", () => {
    expect(isExtremeAmount(18000)).toBe(false);
    expect(isExtremeAmount(10000000)).toBe(false);
    expect(isExtremeAmount(15000000)).toBe(true);

    const extremeDraftMock = {
      type: "transaction",
      payload: JSON.stringify({
        type: "expense",
        amount: 50000000,
        wallet: "Mandiri",
        category: "Lainnya",
        description: "Beli laptop",
        transactionDate: "2026-10-19",
      }),
    };

    const card = DraftManager.formatDraftCard(extremeDraftMock);
    expect(card).toContain("Perhatian: Nominal besar (> Rp 10.000.000)");
  });

  test("Area 12: Telegram Update Deduplication Middleware", async () => {
    const testUpdateId = Math.floor(Math.random() * 900000000) + 100000000;
    let executionCount = 0;

    const mockCtx = {
      update: { update_id: testUpdateId },
    } as any;

    const mockNext = async () => {
      executionCount++;
    };

    // First time update arrives: should execute
    await dedupeMiddleware(mockCtx, mockNext);
    expect(executionCount).toBe(1);

    // Second time duplicate update arrives: should drop silently
    await dedupeMiddleware(mockCtx, mockNext);
    expect(executionCount).toBe(1); // Still 1!
  });
});
