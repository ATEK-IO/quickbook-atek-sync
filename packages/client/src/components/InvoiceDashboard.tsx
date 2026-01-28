import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, FileText, Users, TrendingUp } from 'lucide-react'

interface InvoiceDashboardProps {
  className?: string
}

export function InvoiceDashboard({ className }: InvoiceDashboardProps) {
  const { data: dashboardStats, isLoading } = trpc.invoiceSync.getDashboardStats.useQuery()

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const currentYear = new Date().getFullYear()
  const previousYear = currentYear - 1

  // Get totals for current and previous year
  const currentYearStats = dashboardStats?.totals[currentYear] || { synced: 0, amount: 0 }
  const previousYearStats = dashboardStats?.totals[previousYear] || { synced: 0, amount: 0 }

  // Calculate total across all years
  const totalSynced = Object.values(dashboardStats?.totals || {}).reduce(
    (sum, year) => sum + year.synced,
    0
  )
  const totalAmount = Object.values(dashboardStats?.totals || {}).reduce(
    (sum, year) => sum + year.amount,
    0
  )

  if (isLoading) {
    return (
      <div className={className}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {currentYear} Synced
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentYearStats.synced}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(currentYearStats.amount)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {previousYear} Synced
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{previousYearStats.synced}</div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(previousYearStats.amount)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Synced
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSynced}</div>
            <p className="text-xs text-muted-foreground">{formatCurrency(totalAmount)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              QB Customers
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.byCustomer.length || 0}</div>
            <p className="text-xs text-muted-foreground">with synced invoices</p>
          </CardContent>
        </Card>
      </div>

      {/* Customer Breakdown Table */}
      {dashboardStats?.byCustomer && dashboardStats.byCustomer.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Synced Invoices by Customer
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-center">Invoices</TableHead>
                  <TableHead className="text-right">{previousYear}</TableHead>
                  <TableHead className="text-right">{currentYear}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboardStats.byCustomer.slice(0, 10).map((customer) => (
                  <TableRow key={customer.qbCustomerId}>
                    <TableCell className="font-medium">{customer.qbCustomerName}</TableCell>
                    <TableCell className="text-center">{customer.invoiceCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {customer.amounts[previousYear]
                        ? formatCurrency(customer.amounts[previousYear])
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {customer.amounts[currentYear]
                        ? formatCurrency(customer.amounts[currentYear])
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(customer.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {dashboardStats.byCustomer.length > 10 && (
              <div className="p-2 text-center text-sm text-muted-foreground border-t">
                Showing top 10 of {dashboardStats.byCustomer.length} customers
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
