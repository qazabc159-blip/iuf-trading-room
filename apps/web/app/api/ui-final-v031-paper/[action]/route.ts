import { NextResponse } from "next/server";
import {
  previewPaperOrder,
  submitPaperOrder,
  type PaperOrderInput,
} from "@/lib/paper-orders-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

function parseInput(raw: unknown): PaperOrderInput {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  const side = body.side === "sell" ? "sell" : "buy";
  const orderType = body.orderType === "market" ? "market" : "limit";
  const qty = Number(body.qty);
  const quantityUnit = body.quantity_unit === "SHARE" ? "SHARE" : "LOT";
  let price: number | null = null;
  if (orderType !== "market") {
    const parsedPrice = Number(body.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) throw new Error("PRICE_REQUIRED");
    price = parsedPrice;
  }

  if (!symbol) throw new Error("SYMBOL_REQUIRED");
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("QTY_REQUIRED");

  return {
    symbol,
    side,
    orderType,
    qty,
    quantity_unit: quantityUnit,
    price,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (action !== "preview" && action !== "submit") {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_PAPER_ACTION" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const input = parseInput(await request.json());
    const data = action === "preview"
      ? await previewPaperOrder(input)
      : await submitPaperOrder(input);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "PAPER_ACTION_FAILED",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
