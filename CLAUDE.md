mongo => Read only

## QuickBooks Tax Codes (Quebec)

When syncing invoices to QuickBooks Online (Canada/Quebec), taxes must be explicitly set.

### Key Tax Codes (TaxCode entity IDs)
| ID | Name | Description |
|----|------|-------------|
| `9` | TPS/TVQ QC - 9,975 | GST 5% + QST 9.975% (standard Quebec taxable) |
| `6` | TPS | GST only (5%) |
| `10` | TVQ QC - 9,975 | QST only (9.975%) |
| `3` | Hors champ | No tax |
| `4` | Exonéré | Exempt |
| `5` | Détaxé | Zero-rated |

### Key Tax Rates (TaxRate entity IDs)
| ID | Name | Rate |
|----|------|------|
| `7` | TPS | 5% (GST) |
| `21` | TVQ 9,975 | 9.975% (QST) |

### How to Apply Taxes to QB Invoices
1. Set `TaxCodeRef: { value: '9' }` on each `SalesItemLineDetail`
2. Set `TxnTaxDetail` on the invoice with explicit `TaxLine` entries
3. Both TPS (rate `7`) and TVQ (rate `21`) must be in `TaxLine`
4. `TxnTaxDetail.TotalTax` must be computed: `subtotal * 0.05 + subtotal * 0.09975`
5. Using just `TaxCodeRef` alone does NOT apply taxes on updates - you MUST include `TxnTaxDetail`

### Common Pitfalls
- `TaxCodeRef: { value: 'TAX' }` does NOT work - QB uses numeric IDs, not string names
- Sparse updates that change `TaxCodeRef` fail with "Invalid Tax Rate id - 3" unless `TxnTaxDetail` is also provided
- Revenue recognition items require `ServiceDate` field on line items

### Query Tax Codes
Run `bun packages/server/src/scripts/query-tax-codes.ts` from project root to list all available tax codes and rates.