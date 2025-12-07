import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type AuthMode = 'login' | 'signup' | 'reset';

interface AuthModalProps {
  open: boolean;
  initialMode: AuthMode;
  onClose: () => void;
  onModeChange?: (mode: AuthMode) => void;
}

const titles: Record<AuthMode, string> = {
  login: 'Log in to SnapLine',
  signup: 'Create your SnapLine account',
  reset: 'Reset your password',
};

const primaryLabels: Record<AuthMode, string> = {
  login: 'Log In',
  signup: 'Create Account',
  reset: 'Update Password',
};

const AuthModal: React.FC<AuthModalProps> = ({ open, initialMode, onClose, onModeChange }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const { signUp, login, resetPassword, user } = useAuth();

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setStatus('');
      setError('');
      setPassword('');
      setConfirmPassword('');
    }
  }, [open, initialMode]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  const description = useMemo(() => {
    if (mode === 'login') return 'Access your dashboard and saved listings.';
    if (mode === 'signup') return 'Sign up with your email to start generating listings.';
    return 'Enter the email you registered with and set a new password.';
  }, [mode]);

  const showPasswordConfirm = mode === 'signup' || mode === 'reset';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setStatus('');

    if (showPasswordConfirm && password !== confirmPassword) {
      setError('Passwords do not match.');
      setSubmitting(false);
      return;
    }

    try {
      if (mode === 'signup') {
        await signUp(email, password);
        setStatus('Account created. You are signed in and ready to go.');
        onClose();
      } else if (mode === 'login') {
        await login(email, password);
        setStatus('Welcome back!');
        onClose();
      } else {
        await resetPassword(email, password);
        setStatus('Password updated. You can log in with your new password.');
        setMode('login');
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-teal-600">Account</p>
            <h3 className="text-lg font-semibold text-gray-900">{titles[mode]}</h3>
          </div>
          <button
            aria-label="Close auth modal"
            className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">{description}</p>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {status && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">{status}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-800" htmlFor="auth-email">
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-800" htmlFor="auth-password">
                {mode === 'reset' ? 'New password' : 'Password'}
              </label>
              <input
                id="auth-password"
                type="password"
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                placeholder="Enter at least 6 characters"
              />
            </div>

            {showPasswordConfirm && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-800" htmlFor="auth-confirm">
                  Confirm password
                </label>
                <input
                  id="auth-confirm"
                  type="password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                  placeholder="Re-enter your password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-200 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Please wait…' : primaryLabels[mode]}
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm text-gray-600">
            {mode !== 'login' && (
              <button className="text-teal-700 hover:underline" onClick={() => setMode('login')}>
                Back to Log In
              </button>
            )}
            {mode !== 'signup' && (
              <button className="text-teal-700 hover:underline" onClick={() => setMode('signup')}>
                Create an account
              </button>
            )}
            {mode !== 'reset' && (
              <button className="text-gray-600 hover:underline" onClick={() => setMode('reset')}>
                Forgot password?
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
