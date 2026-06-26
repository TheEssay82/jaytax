// 위저드 스텝 공용 props (WizardTab → 각 스텝)
import type { BillingRecord, Client } from '../../types';
import type { Target } from '../../lib/targetsApi';

export interface WizardStepProps {
  clients: Client[];
  records: BillingRecord[];
  targets: Target[];
  refreshClients: () => Promise<void>;
  refreshBilling: () => Promise<void>;
}
