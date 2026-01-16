/**
 * Fuzzy string matching utilities using Levenshtein distance
 */

// Calculate Levenshtein distance between two strings
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Handle edge cases
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// Calculate similarity score (0-1) based on Levenshtein distance
export function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0

  const normalizedA = normalizeString(a)
  const normalizedB = normalizeString(b)

  if (normalizedA === normalizedB) return 1

  const distance = levenshteinDistance(normalizedA, normalizedB)
  const maxLength = Math.max(normalizedA.length, normalizedB.length)

  return maxLength === 0 ? 1 : 1 - distance / maxLength
}

// Normalize string for comparison
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s]/g, ' ') // Replace special chars with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
}

// Check if string starts with a 4-digit org number
export function extractOrgNumber(displayName: string): string | null {
  const match = displayName.match(/^(\d{4})/)
  return match ? match[1] : null
}

// Extract the name part after org number (e.g., "0000 JGH" -> "JGH")
export function extractNameFromDisplayName(displayName: string): string {
  // Remove org number prefix (e.g., "0000 " or "0000-01 ")
  const withoutOrgNum = displayName.replace(/^\d{4}(-\d{2})?\s*/, '')
  return withoutOrgNum.trim()
}

// Check if QB customer is a sub-customer (has -XX suffix in org number)
export function isSubCustomer(displayName: string): boolean {
  return /^\d{4}-\d{2}/.test(displayName)
}

// Extract parent org number from sub-customer (e.g., "0013-08 Name" -> "0013")
export function extractParentOrgNumber(displayName: string): string | null {
  const match = displayName.match(/^(\d{4})-\d{2}/)
  return match ? match[1] : null
}

// Pad org number to 4 digits
export function padOrgNumber(orgNum: string | number | null): string {
  if (orgNum === null || orgNum === undefined) return ''
  const num = typeof orgNum === 'string' ? orgNum : String(orgNum)
  return num.padStart(4, '0')
}

// Token-based similarity (good for comparing organization names)
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeString(a).split(' ').filter(Boolean))
  const tokensB = new Set(normalizeString(b).split(' ').filter(Boolean))

  if (tokensA.size === 0 && tokensB.size === 0) return 1
  if (tokensA.size === 0 || tokensB.size === 0) return 0

  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)))
  const union = new Set([...tokensA, ...tokensB])

  return intersection.size / union.size
}

// Combined similarity using both Levenshtein and token-based
export function combinedSimilarity(a: string, b: string): number {
  const levenshtein = stringSimilarity(a, b)
  const token = tokenSimilarity(a, b)

  // Weight: 60% Levenshtein, 40% token-based
  return levenshtein * 0.6 + token * 0.4
}
