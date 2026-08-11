import { Link, NavLink, Outlet } from 'react-router-dom';

import type { SessionUser } from '../../shared/contracts';

interface AppShellProps {
  user: SessionUser;
  onSignOut: () => Promise<void>;
}

export function AppShell({ user, onSignOut }: AppShellProps) {
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" to="/projects" aria-label="Book Illustration Studio">
          <span className="brand-mark" aria-hidden="true">G</span>
          <span>Book Illustration Studio</span>
        </Link>
        <nav aria-label="Primary navigation">
          <NavLink to="/projects">Projects</NavLink>
        </nav>
        <div className="user-menu">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="user-name">{user.name}</span>
          <button className="text-button" type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
      <footer className="footer">GRADION <b>|</b> Scaling Business</footer>
    </div>
  );
}
