import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";

function buildQuotePayload(items, orderType) {
  const payloadItems = items
    .filter((item) => item.productId)
    .map((item) => ({
      gstRate: Number(item.gstRate || 0),
      packageCount: item.packageCount ? Number(item.packageCount || 0) : null,
      packageSize: item.packageSize ? Number(item.packageSize || 0) : null,
      packageSizeUnit: item.packageSizeUnit || null,
      productId: Number(item.productId),
      quantity: Number(item.quantity || 0),
      rate: Number(item.rate || 0),
      unitLabel: item.unitLabel || "Pieces",
      unitType: item.unitType || "pieces",
    }));

  if (
    !payloadItems.length ||
    payloadItems.some((item) => !item.productId || item.quantity <= 0 || item.rate < 0 || item.gstRate < 0)
  ) {
    return null;
  }

  return {
    type: orderType,
    items: payloadItems,
  };
}

export function useOrderQuote({ items, orderType, enabled }) {
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const requestRef = useRef(0);

  const quotePayload = useMemo(() => buildQuotePayload(items, orderType), [items, orderType]);

  useEffect(() => {
    if (!enabled || !quotePayload) {
      requestRef.current += 1;
      setQuote(null);
      setQuoteError("");
      setQuoteLoading(false);
      return undefined;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setQuoteLoading(true);
    setQuoteError("");

    const timer = setTimeout(async () => {
      try {
        const quoted = await api.quoteOrder(quotePayload);
        if (requestRef.current === requestId) {
          setQuote(quoted);
        }
      } catch (error) {
        if (requestRef.current === requestId) {
          setQuote(null);
          setQuoteError(error?.message || "Live pricing is unavailable");
        }
      } finally {
        if (requestRef.current === requestId) {
          setQuoteLoading(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [enabled, quotePayload]);

  const quotedItemsByProduct = useMemo(() => {
    const lines = Array.isArray(quote?.items) ? quote.items : [];
    return Object.fromEntries(lines.map((line) => [String(line.productId ?? line.product_id), line]));
  }, [quote]);

  return {
    quote,
    quoteError,
    quoteLoading,
    quotedItemsByProduct,
  };
}
