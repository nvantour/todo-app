import { useLocation, useNavigate } from 'react-router-dom';
import './Sidebar.css';

export default function Sidebar({ categories, todoCounts, isOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();

  const smartFilters = [
    { path: '/', label: 'Alle taken', icon: 'inbox', count: todoCounts.all },
    { path: '/today', label: 'Vandaag', icon: 'today', count: todoCounts.today },
    { path: '/upcoming', label: 'Komend', icon: 'upcoming', count: todoCounts.upcoming },
  ];

  const handleNav = (path) => {
    navigate(path);
    onClose?.();
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-section">
          {smartFilters.map(filter => (
            <button
              key={filter.path}
              className={`sidebar-item ${location.pathname === filter.path ? 'sidebar-item--active' : ''}`}
              onClick={() => handleNav(filter.path)}
            >
              <span className={`sidebar-icon sidebar-icon--${filter.icon}`} />
              <span className="sidebar-label">{filter.label}</span>
              {filter.count > 0 && <span className="sidebar-count">{filter.count}</span>}
            </button>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div className="sidebar-heading">Categorieën</div>
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`sidebar-item ${location.pathname === `/category/${cat.id}` ? 'sidebar-item--active' : ''}`}
              onClick={() => handleNav(`/category/${cat.id}`)}
            >
              <span className="sidebar-dot" style={{ background: cat.color }} />
              <span className="sidebar-label">{cat.name}</span>
              {(todoCounts.byCategory?.[cat.id] || 0) > 0 && (
                <span className="sidebar-count">{todoCounts.byCategory[cat.id]}</span>
              )}
            </button>
          ))}
          <button className="sidebar-item sidebar-item--add" onClick={() => handleNav('/categories')}>
            <span className="sidebar-icon sidebar-icon--add" />
            <span className="sidebar-label">Categorie beheren</span>
          </button>
        </div>
      </aside>
    </>
  );
}
