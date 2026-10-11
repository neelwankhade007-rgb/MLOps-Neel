import React from 'react';
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
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DatasetsPage from './pages/DatasetsPage';
import TrainingPage from './pages/TrainingPage';
import RegistryPage from './pages/RegistryPage';
import PredictPage from './pages/PredictPage';

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
        <LoginPage />
      </Router>
    );
  }

  return (
    <Router>
      <Toaster position="top-right" />
      <TrainingProvider>
        <AppLayout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/registry" element={<RegistryPage />} />
            <Route path="/predict" element={<PredictPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
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
