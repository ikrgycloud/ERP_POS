# Invoice payment lifecycle API

All endpoints use the existing bearer token and tenant headers. Money is returned as JSON decimal strings.

## Receive a payment

```http
POST /api/v1/invoices/45/payments
Idempotency-Key: inv-45-payment-txn12345
Content-Type: application/json

{
  "amount": "2500.00",
  "paymentMethod": "upi",
  "transactionReference": "TXN12345",
  "notes": "First instalment",
  "receivedBy": "Rahul Sharma"
}
```

```json
{
  "payment": {
    "id": 101,
    "receiptNumber": "RCP-2026-0001",
    "invoiceId": 45,
    "amount": "2500.00",
    "paymentMethod": "upi",
    "transactionReference": "TXN12345",
    "transactionType": "payment",
    "status": "successful",
    "previousPaidAmount": "0.00",
    "totalPaidAfter": "2500.00",
    "remainingAfter": "7500.00",
    "paymentStatusAfter": "Partially Paid"
  },
  "summary": {
    "invoiceId": 45,
    "invoiceNumber": "INV-2026-00045",
    "grandTotal": "10000.00",
    "paidAmount": "2500.00",
    "remainingAmount": "7500.00",
    "paymentPercentage": "25.00",
    "paymentStatus": "Partially Paid",
    "invoiceStatus": "Generated",
    "paymentCount": 1
  }
}
```

## Read and reverse

```http
GET /api/v1/invoices/45/payments
GET /api/v1/invoices/45/summary
GET /api/v1/payments/101/receipt
POST /api/v1/payments/101/reverse
Idempotency-Key: reverse-payment-101
```

Reversal creates a new receipt-bearing ledger row, marks the original transaction reversed, and recalculates the invoice. Neither row is deleted.
