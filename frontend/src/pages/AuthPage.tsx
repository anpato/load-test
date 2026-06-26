import { useNavigate } from 'react-router';
import { AuthConfig } from '../components/AuthConfig';
import { SavedAuthPicker } from '../components/EnvironmentPicker';
import { useWizard } from '../contexts/WizardContext';

export default function AuthPage() {
  const navigate = useNavigate();
  const { authConfig, setAuthConfig } = useWizard();

  return (
    <div className="space-y-4">
      <h2 className="text-[15px] font-semibold text-fg">
        Authentication
      </h2>
      <SavedAuthPicker currentAuth={authConfig} onSelect={setAuthConfig} />
      <AuthConfig config={authConfig} onChange={setAuthConfig} />
      <div className="flex justify-between">
        <button
          onClick={() => navigate('/select')}
          className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => navigate('/config')}
          className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
