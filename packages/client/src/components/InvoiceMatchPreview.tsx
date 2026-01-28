import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Check, X, AlertTriangle } from 'lucide-react'

interface InvoiceMatchPreviewProps {
  matchScore: number | null
  comparison?: {
    totalMatch?: boolean
    lineCountMatch?: boolean
    dateMatch?: boolean
    customerMatch?: boolean
  }
  onClick?: () => void
  className?: string
}

export function InvoiceMatchPreview({
  matchScore,
  comparison,
  onClick,
  className,
}: InvoiceMatchPreviewProps) {
  if (matchScore === null) {
    return (
      <span className={`text-xs text-muted-foreground ${className}`}>
        No QB
      </span>
    )
  }

  // Determine color based on score
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-green-500 hover:bg-green-600'
    if (score >= 70) return 'bg-yellow-500 hover:bg-yellow-600'
    return 'bg-red-500 hover:bg-red-600'
  }

  const getScoreVariant = (score: number): 'default' | 'secondary' | 'destructive' => {
    if (score >= 90) return 'default'
    if (score >= 70) return 'secondary'
    return 'destructive'
  }

  const MatchIcon = ({ match }: { match?: boolean }) => {
    if (match === undefined) return <AlertTriangle className="h-3 w-3 text-muted-foreground" />
    return match ? (
      <Check className="h-3 w-3 text-green-600" />
    ) : (
      <X className="h-3 w-3 text-red-500" />
    )
  }

  const content = (
    <Badge
      variant={getScoreVariant(matchScore)}
      className={`${getScoreColor(matchScore)} cursor-pointer text-white ${className}`}
      onClick={onClick}
    >
      {matchScore}%
    </Badge>
  )

  // If no comparison details, just show the badge
  if (!comparison) {
    return content
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent className="p-3 space-y-2">
          <div className="text-sm font-medium">Match Details</div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <MatchIcon match={comparison.totalMatch} />
              <span>Total Amount</span>
            </div>
            <div className="flex items-center gap-2">
              <MatchIcon match={comparison.lineCountMatch} />
              <span>Line Items Count</span>
            </div>
            <div className="flex items-center gap-2">
              <MatchIcon match={comparison.dateMatch} />
              <span>Invoice Date</span>
            </div>
            <div className="flex items-center gap-2">
              <MatchIcon match={comparison.customerMatch} />
              <span>Customer Match</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pt-1 border-t">
            Click to view full comparison
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
