import { Routes, Route } from 'react-router';
import AppLayout from './layouts/AppLayout';
import DiscoverPage from './pages/DiscoverPage';
import SelectPage from './pages/SelectPage';
import AuthPage from './pages/AuthPage';
import ConfigPage from './pages/ConfigPage';
import RunningPage from './pages/RunningPage';
import ResultsPage from './pages/ResultsPage';
import HistoryPage from './pages/HistoryPage';
import ComparePage from './pages/ComparePage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DiscoverPage />} />
        <Route path="select" element={<SelectPage />} />
        <Route path="auth" element={<AuthPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="running/:runId" element={<RunningPage />} />
        <Route path="results/:runId" element={<ResultsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="compare" element={<ComparePage />} />
      </Route>
    </Routes>
  );
}
