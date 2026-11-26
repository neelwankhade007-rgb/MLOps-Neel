import React, { Suspense, lazy } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { TrainingProvider } from './context/TrainingContext';
import AppLayout from './components/layout/AppLayout';
import ThemeToggle from './components/layout/ThemeToggle';
import Loading from './components/common/Loading';

// Code-split pages for performance optimization
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DatasetsPage = lazy(() => import('./pages/DatasetsPage'));
const TrainingPage = lazy(() => import('./pages/TrainingPage'));
const RegistryPage = lazy(() => import('./pages/RegistryPage'));
const PredictPage = lazy(() => import('./pages/PredictPage'));
const InferenceMonitoringPage = lazy(() => import('./pages/InferenceMonitoringPage'));

const PageFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loading message="Loading module..." />
  </div>
);

const AppContent: React.FC = () => {
  const { auth, loadingApp } = useAuth();

  if (loadingApp) {
    return <Loading fullScreen message="Checking authentication..." />;
  }

  if (!auth) {
    return (
      <Router>
        <Toaster position="top-right" />
        <ThemeToggle fixed />
        <Suspense fallback={<Loading fullScreen message="Loading..." />}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<LoginPage />} />
          </Routes>
        </Suspense>
      </Router>
    );
  }

  return (
    <Router>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--surface-card, #ffffff)',
            color: 'var(--text-primary, #0f172a)',
            border: '1px solid var(--border-subtle, #e2e8f0)',
            fontSize: '13px',
          },
        }}
      />
      <TrainingProvider>
        <AppLayout>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/registry" element={<RegistryPage />} />
              <Route path="/predict" element={<PredictPage />} />
              <Route path="/inference-monitoring" element={<InferenceMonitoringPage />} />
              <Route path="/adaptive-load-balancing" element={<Navigate to="/inference-monitoring" replace />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/register" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </TrainingProvider>
    </Router>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
