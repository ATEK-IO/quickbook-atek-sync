import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CustomerCreateDialog } from '@/components/CustomerCreateDialog'
import { Check, X, RefreshCw, Filter, Plus } from 'lucide-react'

type MappingStatus = 'all' | 'proposed' | 'approved' | 'rejected' | 'needs_review'

interface DisplayRow {
  mappingId: number
  orgId: string
  orgNum: string | null
  orgName: string
  orgDisplayName: string // "XXXX OrgName" format
  sensorCount: number
  managerId: string | null
  managerName: string
  managerEmail: string
  qbCustomerId: string | null
  qbCustomerName: string | null
  confidenceScore: number | null
  mappingStatus: string | null
  isFirstRowForOrg: boolean // Only first row per org shows editable dropdown
}

export default function CustomerMapping() {
  const [statusFilter, setStatusFilter] = useState<MappingStatus>('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch stats
  const { data: stats, refetch: refetchStats } = trpc.customerMapping.stats.useQuery()

  // Fetch mappings
  const {
    data: mappings,
    isLoading,
    refetch: refetchMappings,
  } = trpc.customerMapping.list.useQuery(
    statusFilter === 'all' ? { limit: 500 } : { status: statusFilter, limit: 500 }
  )

  // Fetch organizations for org numbers
  const { data: organizations } = trpc.atek.organizations.customers.useQuery({})

  // Fetch QB customers for dropdown
  const { data: qbCustomers, refetch: refetchQbCustomers } = trpc.quickbooks.customers.list.useQuery({ activeOnly: true })

  // Fetch sensor counts by organization (excluding archived)
  const { data: sensorCounts } = trpc.atek.sensors.countsByOrganization.useQuery()

  // Run matching mutation
  const runMatching = trpc.customerMapping.runMatching.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchMappings()
    },
  })

  // Approve mutation
  const approveMutation = trpc.customerMapping.approve.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchMappings()
    },
  })

  // Reject mutation
  const rejectMutation = trpc.customerMapping.reject.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchMappings()
    },
  })

  // Update QB customer mutation
  const updateQbCustomer = trpc.customerMapping.updateQbCustomer.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchMappings()
    },
  })

  // Build org number lookup
  const orgNumLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    if (organizations) {
      for (const org of organizations) {
        if (org.orgNumber) {
          lookup.set(org.id, String(org.orgNumber).padStart(4, '0'))
        }
      }
    }
    return lookup
  }, [organizations])

  // Create display rows directly from mappings (each mapping is now one row)
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!mappings) return []

    const rows: DisplayRow[] = mappings.map((mapping) => {
      const orgId = mapping.atekOrganizationId
      const orgNum = orgNumLookup.get(orgId) || null
      const orgName = mapping.atekOrganizationName
      const orgDisplayName = orgNum ? `${orgNum} ${orgName}` : orgName

      return {
        mappingId: mapping.mappingId,
        orgId,
        orgNum,
        orgName,
        orgDisplayName,
        sensorCount: sensorCounts?.[orgId] || 0,
        managerId: mapping.atekContractualManagerId || null,
        managerName: mapping.atekContractualManagerName || '-',
        managerEmail: mapping.atekContractualManagerEmail || '',
        qbCustomerId: mapping.quickbooksCustomerId,
        qbCustomerName: mapping.quickbooksCustomerName,
        confidenceScore: mapping.confidenceScore,
        mappingStatus: mapping.mappingStatus,
        isFirstRowForOrg: true, // Each row is independent now
      }
    })

    // Sort by org number, then by manager name
    rows.sort((a, b) => {
      const aNum = a.orgNum || 'zzzz'
      const bNum = b.orgNum || 'zzzz'
      const numCompare = aNum.localeCompare(bNum)
      if (numCompare !== 0) return numCompare
      return a.managerName.localeCompare(b.managerName)
    })

    return rows
  }, [mappings, orgNumLookup, sensorCounts])

  // Build QB customer options for dropdown, filtered by org number
  const getQbCustomerOptions = (orgNum: string | null) => {
    if (!qbCustomers) return []

    let filtered = qbCustomers
    if (orgNum) {
      // Filter by first 4 digits matching org number
      filtered = qbCustomers.filter((c) => c.DisplayName?.startsWith(orgNum))
    }

    return filtered.map((c) => ({
      value: c.Id,
      label: c.DisplayName || c.Id,
    }))
  }

  // Get confidence badge variant
  const getConfidenceBadge = (score: number | null) => {
    if (score === null) return { variant: 'outline' as const, label: 'N/A' }
    const pct = Math.round(score * 100)
    if (pct >= 95) return { variant: 'success' as const, label: `${pct}%` }
    if (pct >= 70) return { variant: 'warning' as const, label: `${pct}%` }
    return { variant: 'destructive' as const, label: `${pct}%` }
  }

  // Get status badge variant
  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return { variant: 'success' as const, label: 'Approved' }
      case 'rejected':
        return { variant: 'destructive' as const, label: 'Rejected' }
      case 'proposed':
        return { variant: 'secondary' as const, label: 'Proposed' }
      case 'needs_review':
        return { variant: 'warning' as const, label: 'Needs Review' }
      default:
        return { variant: 'outline' as const, label: status || 'Unknown' }
    }
  }

  // Handle QB customer selection
  const handleQbCustomerChange = (mappingId: number, qbCustomerId: string) => {
    const customer = qbCustomers?.find((c) => c.Id === qbCustomerId)
    if (customer) {
      updateQbCustomer.mutate({
        mappingId,
        qbCustomerId: customer.Id,
        qbCustomerName: customer.DisplayName || customer.Id,
      })
    }
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customer Mapping</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Customer
          </Button>
          <Button onClick={() => runMatching.mutate()} disabled={runMatching.isPending}>
            <RefreshCw className={runMatching.isPending ? 'animate-spin' : ''} />
            {runMatching.isPending ? 'Running...' : 'Run Matching'}
          </Button>
        </div>
      </div>

      <CustomerCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={() => refetchQbCustomers()}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              High Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.highConfidence || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats?.approved || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Needs Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats?.needsReview || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Buttons */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Filter:</span>
        {(['all', 'proposed', 'approved', 'rejected', 'needs_review'] as const).map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(status)}
          >
            {status === 'all'
              ? 'All'
              : status === 'needs_review'
                ? 'Needs Review'
                : status.charAt(0).toUpperCase() + status.slice(1)}
          </Button>
        ))}
      </div>

      {/* Mappings Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ATEK Organisation</TableHead>
                <TableHead>Sensors</TableHead>
                <TableHead>Contractual Manager</TableHead>
                <TableHead className="w-[300px]">QB Customer</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !displayRows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    No mappings found. Click "Run Matching" to generate mappings.
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row, idx) => {
                  const confidence = getConfidenceBadge(row.confidenceScore)
                  const status = getStatusBadge(row.mappingStatus)
                  const qbOptions = getQbCustomerOptions(row.orgNum)

                  return (
                    <TableRow key={`${row.mappingId}-${row.managerId || idx}`}>
                      <TableCell className="font-medium">{row.orgDisplayName}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{row.sensorCount}</span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{row.managerName}</div>
                          {row.managerEmail && (
                            <div className="text-xs text-muted-foreground">{row.managerEmail}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.isFirstRowForOrg ? (
                          <Select
                            options={qbOptions}
                            value={row.qbCustomerId || undefined}
                            onChange={(value) => handleQbCustomerChange(row.mappingId, value)}
                            placeholder="Select QB Customer..."
                            searchable
                            disabled={updateQbCustomer.isPending || row.mappingStatus === 'approved'}
                            className="w-full"
                          />
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            {row.qbCustomerName || '-'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.isFirstRowForOrg ? (
                          <Badge variant={confidence.variant}>{confidence.label}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.isFirstRowForOrg ? (
                          <Badge variant={status.variant}>{status.label}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.isFirstRowForOrg ? (
                          <div className="flex items-center gap-1">
                            {row.mappingStatus !== 'approved' && row.qbCustomerId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  approveMutation.mutate({
                                    mappingId: row.mappingId,
                                    approvedBy: 'admin',
                                  })
                                }
                                disabled={approveMutation.isPending}
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                            )}
                            {row.mappingStatus !== 'rejected' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  rejectMutation.mutate({
                                    mappingId: row.mappingId,
                                  })
                                }
                                disabled={rejectMutation.isPending}
                              >
                                <X className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
