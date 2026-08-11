import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import type { SessionUser } from '../shared/contracts';
import { ApiError, getSession, signOut } from './api';
import { AppShell } from './components/AppShell';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { SignInPage } from './pages/SignInPage';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: SessionUser };

export function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    void getSession()
      .then((user) => {
        if (active) setSession({ status: 'signed-in', user });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setSession({ status: 'signed-out' });
          return;
        }
        setSession({ status: 'signed-out' });
      });

    return () => {
      active = false;
    };
  }, []);

  if (session.status === 'loading') {
    return <main className="loading-page" role="status">Loading your workspace…</main>;
  }

  if (session.status === 'signed-out') {
    return (
      <SignInPage
        onSignedIn={(user) => {
          setSession({ status: 'signed-in', user });
          navigate('/projects');
        }}
      />
    );
  }

  async function handleSignOut() {
    await signOut();
    setSession({ status: 'signed-out' });
    navigate('/');
  }

  return (
    <Routes>
      <Route element={<AppShell user={session.user} onSignOut={handleSignOut} />}>
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="*" element={<Navigate replace to="/projects" />} />
      </Route>
    </Routes>
  );
}
