import { useNavigate } from 'react-router';
import CompareRuns from '../components/CompareRuns';

export default function ComparePage() {
  const navigate = useNavigate();

  return (
    <CompareRuns onClose={() => navigate(-1)} />
  );
}
