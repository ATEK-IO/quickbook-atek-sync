import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ItemCreateDialog } from '@/components/ItemCreateDialog'
import { Plus, RefreshCw, Check, X, AlertCircle, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'

interface InvoiceSKU {
  skuId: string
  code: string | null
  name: string | null
  description: string | null
  unitPrice: number | null
  taxable: boolean
  invoiceCount: number
}

interface QBItem {
  Id: string
  Name: string
  Description?: string
  Type: string
  Sku?: string
  UnitPrice?: number
  PurchaseCost?: number
}

interface SKUMatchResult {
  atekSku: InvoiceSKU
  qbItem: QBItem | null
  matchType: 'exact_code' | 'exact_name' | 'fuzzy_name' | 'no_match'
  confidence: number
}

export default function SkuMapping() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedSku, setSelectedSku] = useState<InvoiceSKU | null>(null)

  // Fetch SKU matches
  const {
    data: skuMatches,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.skuMapping.list.useQuery()

  // Fetch stats
  const { data: stats } = trpc.skuMapping.stats.useQuery()

  // Mutation to approve a single match
  const approveMatch = trpc.skuMapping.approveMatch.useMutation({
    onSuccess: () => {
      toast.success('SKU mapping approved')
      refetch()
    },
    onError: (error) => {
      toast.error(`Failed to approve mapping: ${error.message}`)
    },
  })

  // Mutation to approve all matches
  const approveAllMatches = trpc.skuMapping.approveAllMatches.useMutation({
    onSuccess: (result) => {
      toast.success(`Approved ${result.approvedCount} SKU mappings`)
      refetch()
    },
    onError: (error) => {
      toast.error(`Failed to approve all matches: ${error.message}`)
    },
  })

  const handleApproveMatch = (match: SKUMatchResult) => {
    if (!match.qbItem) return

    approveMatch.mutate({
      atekSkuId: match.atekSku.skuId,
      atekSkuCode: match.atekSku.code || '',
      atekSkuName: match.atekSku.name || '',
      quickbooksItemId: match.qbItem.Id,
      quickbooksItemName: match.qbItem.Name,
      quickbooksItemType: match.qbItem.Type,
      matchType: match.matchType as 'exact_code' | 'exact_name' | 'fuzzy_name' | 'manual',
      confidenceScore: match.confidence,
    })
  }

  const handleApproveAll = () => {
    approveAllMatches.mutate()
  }

  const formatPrice = (price?: number | null) => {
    if (price === undefined || price === null) return '-'
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(price)
  }

  const getMatchBadge = (matchType: string, confidence: number) => {
    switch (matchType) {
      case 'exact_code':
        return <Badge variant="default" className="bg-green-600">Code exact</Badge>
      case 'exact_name':
        return <Badge variant="default" className="bg-green-500">Nom exact</Badge>
      case 'fuzzy_name':
        return <Badge variant="secondary">Similaire ({Math.round(confidence * 100)}%)</Badge>
      default:
        return <Badge variant="destructive">Non trouvé</Badge>
    }
  }

  const handleCreateSku = (sku: InvoiceSKU) => {
    setSelectedSku(sku)
    setCreateDialogOpen(true)
  }

  const handleDialogClose = (open: boolean) => {
    setCreateDialogOpen(open)
    if (!open) {
      setSelectedSku(null)
    }
  }

  const unmatchedCount = stats?.unmatched || 0
  const matchedCount = stats?.matched || 0
  const totalCount = stats?.total || 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SKU / Item Mapping</h1>
          <p className="text-muted-foreground">
            SKUs des factures ATEK → Items QuickBooks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Rafraîchir
          </Button>
          {matchedCount > 0 && (
            <Button
              size="sm"
              onClick={handleApproveAll}
              disabled={approveAllMatches.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              {approveAllMatches.isPending ? 'Approving...' : `Approve All Matches (${matchedCount})`}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total SKUs</CardDescription>
            <CardTitle className="text-2xl">{totalCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Associés</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              <Check className="inline h-5 w-5 mr-1" />
              {matchedCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Manquants dans QB</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              <X className="inline h-5 w-5 mr-1" />
              {unmatchedCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Taux de correspondance</CardDescription>
            <CardTitle className="text-2xl">
              {totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* SKU Mapping Table */}
      <Card>
        <CardHeader>
          <CardTitle>SKUs des factures ATEK</CardTitle>
          <CardDescription>
            {unmatchedCount > 0 && (
              <span className="text-red-600">
                <AlertCircle className="inline h-4 w-4 mr-1" />
                {unmatchedCount} SKU(s) à créer dans QuickBooks
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : !skuMatches?.length ? (
            <div className="text-center py-8 text-muted-foreground">Aucun SKU trouvé dans les factures</div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code ATEK</TableHead>
                    <TableHead>Nom ATEK</TableHead>
                    <TableHead className="text-right">Prix</TableHead>
                    <TableHead className="text-center">Factures</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Item QB</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skuMatches.map((match: SKUMatchResult) => (
                    <TableRow
                      key={match.atekSku.skuId}
                      className={match.matchType === 'no_match' ? 'bg-red-50' : ''}
                    >
                      <TableCell>
                        {match.atekSku.code ? (
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {match.atekSku.code}
                          </code>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium max-w-xs">
                        <div className="truncate" title={match.atekSku.name || ''}>
                          {match.atekSku.name || <span className="text-muted-foreground">Sans nom</span>}
                        </div>
                        {match.atekSku.description && (
                          <div className="text-xs text-muted-foreground truncate" title={match.atekSku.description}>
                            {match.atekSku.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(match.atekSku.unitPrice)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{match.atekSku.invoiceCount}</Badge>
                      </TableCell>
                      <TableCell>
                        {getMatchBadge(match.matchType, match.confidence)}
                      </TableCell>
                      <TableCell>
                        {match.qbItem ? (
                          <div>
                            <div className="font-medium text-sm">{match.qbItem.Name}</div>
                            {match.qbItem.Sku && (
                              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                                {match.qbItem.Sku}
                              </code>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {match.matchType !== 'no_match' && match.qbItem && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApproveMatch(match)}
                              disabled={approveMatch.isPending}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Approuver
                            </Button>
                          )}
                          {match.matchType === 'no_match' && (
                            <Button
                              size="sm"
                              onClick={() => handleCreateSku(match.atekSku)}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Créer
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Item Dialog */}
      <ItemCreateDialog
        open={createDialogOpen}
        onOpenChange={handleDialogClose}
        onSuccess={() => refetch()}
        defaultName={selectedSku?.name || ''}
        defaultSku={selectedSku?.code || ''}
        defaultDescription={selectedSku?.description || ''}
        defaultPrice={selectedSku?.unitPrice || undefined}
        defaultTaxable={selectedSku?.taxable}
        atekSkuId={selectedSku?.skuId}
        atekSkuCode={selectedSku?.code || undefined}
        atekSkuName={selectedSku?.name || undefined}
      />
    </div>
  )
}
