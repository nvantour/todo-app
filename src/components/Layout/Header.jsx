import { useAuth } from '../../context/AuthContext';
import './Header.css';

export default function Header({ onMenuClick }) {
  const { user, signOut } = useAuth();

  return (
    <header className="header">
      <button className="header-menu" onClick={onMenuClick}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span className="header-title">Todo</span>
      <div className="header-right">
        {user && (
          <button className="header-avatar" onClick={signOut} title="Uitloggen">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" />
            ) : (
              <span>{user.displayName?.[0] || '?'}</span>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
