import { getUniqueSKUsFromInvoices, InvoiceSKU } from './atek-invoices'
import { listItems, QBItem } from './qb-items'
import { normalizeString, stringSimilarity } from '../lib/fuzzy-match'
import { isConnected } from '../lib/quickbooks'

export interface SKUMatchResult {
  atekSku: InvoiceSKU
  qbItem: QBItem | null
  matchType: 'exact_code' | 'exact_name' | 'fuzzy_name' | 'no_match'
  confidence: number
}

// Compare ATEK invoice SKUs with QuickBooks items
export async function matchInvoiceSKUsWithQBItems(): Promise<SKUMatchResult[]> {
  // Get ATEK SKUs from invoices
  const atekSkus = await getUniqueSKUsFromInvoices()

  // Check if QB is connected
  const qbConnected = await isConnected()
  if (!qbConnected) {
    // Return all ATEK SKUs as unmatched if QB not connected
    return atekSkus.map((sku) => ({
      atekSku: sku,
      qbItem: null,
      matchType: 'no_match' as const,
      confidence: 0,
    }))
  }

  // Get QB items
  let qbItems: QBItem[] = []
  try {
    qbItems = await listItems({ maxResults: 1000, activeOnly: true })
  } catch (error) {
    console.error('Failed to fetch QB items:', error)
    // Return all ATEK SKUs as unmatched if QB fetch fails
    return atekSkus.map((sku) => ({
      atekSku: sku,
      qbItem: null,
      matchType: 'no_match' as const,
      confidence: 0,
    }))
  }

  // Build lookup maps for QB items
  const qbByCode = new Map<string, QBItem>()
  const qbByName = new Map<string, QBItem>()

  for (const item of qbItems) {
    // Skip inactive items (double-check even though query filters)
    // Use !== true to catch both false and undefined values
    if (item.Active !== true) continue

    // Skip soft-deleted items (QB marks them with "(supprimé)" suffix in French)
    // The QB API may return Active=true for these items incorrectly
    if (item.Name.includes('(supprimé)') || item.Name.includes('(deleted)')) continue

    // Index by SKU code (normalized)
    if (item.Sku) {
      qbByCode.set(normalizeString(item.Sku), item)
    }
    // Index by name (normalized)
    qbByName.set(normalizeString(item.Name), item)
  }

  const results: SKUMatchResult[] = []

  for (const atekSku of atekSkus) {
    let qbItem: QBItem | null = null
    let matchType: SKUMatchResult['matchType'] = 'no_match'
    let confidence = 0

    // Strategy 1: Exact code match
    if (atekSku.code) {
      const normalizedCode = normalizeString(atekSku.code)
      const codeMatch = qbByCode.get(normalizedCode)
      if (codeMatch) {
        qbItem = codeMatch
        matchType = 'exact_code'
        confidence = 1.0
      }
    }

    // Strategy 2: Exact name match (if no code match)
    if (!qbItem && atekSku.name) {
      const normalizedName = normalizeString(atekSku.name)
      const nameMatch = qbByName.get(normalizedName)
      if (nameMatch) {
        qbItem = nameMatch
        matchType = 'exact_name'
        confidence = 0.95
      }
    }

    // Strategy 3: Fuzzy name match (if no exact match)
    if (!qbItem && atekSku.name) {
      let bestMatch: QBItem | null = null
      let bestScore = 0

      for (const item of qbItems) {
        // Skip inactive or soft-deleted items
        if (item.Active !== true) continue
        if (item.Name.includes('(supprimé)') || item.Name.includes('(deleted)')) continue

        const similarity = stringSimilarity(atekSku.name, item.Name)
        if (similarity > bestScore && similarity >= 0.8) {
          bestScore = similarity
          bestMatch = item
        }
      }

      if (bestMatch && bestScore >= 0.8) {
        qbItem = bestMatch
        matchType = 'fuzzy_name'
        confidence = bestScore * 0.9 // Slightly reduce confidence for fuzzy matches
      }
    }

    results.push({
      atekSku,
      qbItem,
      matchType,
      confidence,
    })
  }

  return results
}

// Get summary stats
export async function getSKUMatchStats(): Promise<{
  total: number
  matched: number
  unmatched: number
  byMatchType: Record<string, number>
}> {
  const results = await matchInvoiceSKUsWithQBItems()

  const byMatchType: Record<string, number> = {
    exact_code: 0,
    exact_name: 0,
    fuzzy_name: 0,
    no_match: 0,
  }

  for (const r of results) {
    byMatchType[r.matchType]++
  }

  return {
    total: results.length,
    matched: results.filter((r) => r.qbItem !== null).length,
    unmatched: results.filter((r) => r.qbItem === null).length,
    byMatchType,
  }
}
