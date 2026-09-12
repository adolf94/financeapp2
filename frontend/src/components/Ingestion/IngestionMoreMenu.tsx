import { MoreHorizontal, RotateCcw, Landmark } from 'lucide-react'
import { uuidv7 } from 'uuidv7'
import { useReclassifyIngestion } from '@/hooks/useIngestions'
import { getLoansAppUrl } from '@/lib/loansApp'
import DropdownMenu from '@/components/ui/DropdownMenu'

interface IngestionMoreMenuProps {
  ingestionId: string
}

export default function IngestionMoreMenu({ ingestionId }: IngestionMoreMenuProps) {
  const reclassifyMutation = useReclassifyIngestion()

  const handleReclassify = () => {
    const opId = uuidv7()
    window.dispatchEvent(new CustomEvent('reclassifyStarted', { detail: { operationId: opId } }))
    reclassifyMutation.mutate({ id: ingestionId, operationId: opId })
  }

  const handleOpenLoansApp = () => {
    window.open(getLoansAppUrl(ingestionId), '_blank', 'noopener')
  }

  return (
    <DropdownMenu
      triggerTitle="More options"
      trigger={<MoreHorizontal className="w-4 h-4" strokeWidth={1.5} />}
      items={[
        {
          label: 'Reclassify',
          icon: RotateCcw,
          onSelect: handleReclassify,
          disabled: reclassifyMutation.isPending,
        },
        {
          label: 'Integration: Loans App',
          icon: Landmark,
          onSelect: handleOpenLoansApp,
        },
      ]}
    />
  )
}
