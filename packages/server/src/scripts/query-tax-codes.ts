import { qbApiCall } from '../lib/quickbooks'

async function main() {
  console.log('=== Querying QB TaxCode entities ===')

  // Query all tax codes
  const taxCodesResponse = await qbApiCall<{ QueryResponse: { TaxCode?: any[] } }>(
    'GET',
    `query?query=${encodeURIComponent('SELECT * FROM TaxCode')}`
  )
  console.log('\n--- TaxCodes ---')
  const taxCodes = taxCodesResponse.QueryResponse?.TaxCode || []
  for (const tc of taxCodes) {
    console.log(JSON.stringify(tc, null, 2))
  }

  // Also query tax rates
  const taxRatesResponse = await qbApiCall<{ QueryResponse: { TaxRate?: any[] } }>(
    'GET',
    `query?query=${encodeURIComponent('SELECT * FROM TaxRate')}`
  )
  console.log('\n--- TaxRates ---')
  const taxRates = taxRatesResponse.QueryResponse?.TaxRate || []
  for (const tr of taxRates) {
    console.log(JSON.stringify(tr, null, 2))
  }

  // Check invoice 4904 tax details
  const invoiceResponse = await qbApiCall<{ QueryResponse: { Invoice?: any[] } }>(
    'GET',
    `query?query=${encodeURIComponent("SELECT * FROM Invoice WHERE DocNumber = '4904'")}`
  )
  console.log('\n--- Invoice 4904 Tax Details ---')
  const inv = invoiceResponse.QueryResponse?.Invoice?.[0]
  if (inv) {
    console.log('TxnTaxDetail:', JSON.stringify(inv.TxnTaxDetail, null, 2))
    console.log('Line items:')
    for (const line of inv.Line || []) {
      if (line.SalesItemLineDetail) {
        console.log(`  TaxCodeRef:`, JSON.stringify(line.SalesItemLineDetail.TaxCodeRef))
      }
    }
  }
}

main().catch(console.error)
