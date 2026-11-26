import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../components/common/Card';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../api/authApi';
import { sanitizeErrorMessage } from '../utils/error';

export interface LoginPageProps {
  initialIsRegister?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ initialIsRegister = false }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(initialIsRegister);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      toast.error('Please enter both username and password.');
      return;
    }
    if (isRegister && password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await authApi.register({ username: cleanUser, password });
        toast.success('Account created! Please log in.');
        setIsRegister(false);
      } else {
        const formData = new FormData();
        formData.append('username', cleanUser);
        formData.append('password', password);
        const data = await authApi.login(formData);

        login(data.access_token, data.backend_session_id);
        navigate('/');
      }
    } catch (err: unknown) {
      toast.error(sanitizeErrorMessage(err, 'Authentication failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-[#0a0a0a] px-4 transition-colors">
      <div className="w-full max-w-md py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white mb-4 shadow-lg shadow-indigo-600/20 dark:shadow-indigo-900/30">
            <BrainCircuit size={32} />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-neutral-100 tracking-tight">Nexus MLOps</h2>
          <p className="text-slate-500 dark:text-neutral-400 mt-2 text-sm">
            {isRegister ? 'Create your platform account' : 'Welcome back, sign in to your cluster'}
          </p>
        </div>

        <Card className="p-8 border border-slate-200 dark:border-neutral-800 shadow-md">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                Username
              </label>
              <Input
                placeholder="Enter username"
                value={username}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                Password
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full py-2.5 text-base font-semibold"
              disabled={loading}
              loading={loading}
            >
              {isRegister ? 'Create Account' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors cursor-pointer"
              onClick={() => setIsRegister(!isRegister)}
            >
              {isRegister
                ? 'Already have an account? Sign In'
                : "Don't have an account? Register"}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
