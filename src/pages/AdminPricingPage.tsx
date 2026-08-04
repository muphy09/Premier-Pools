import { useNavigate, useSearchParams } from 'react-router-dom';
import PricingDataModal from '../components/PricingDataModal';

interface AdminPricingPageProps {
  franchiseId?: string | null;
  franchiseCode?: string | null;
}

function AdminPricingPage({ franchiseId, franchiseCode }: AdminPricingPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialModelId = searchParams.get('model');

  return (
    <PricingDataModal
      franchiseId={franchiseId}
      franchiseCode={franchiseCode}
      initialModelId={initialModelId}
      onClose={() => navigate('/admin')}
    />
  );
}

export default AdminPricingPage;
