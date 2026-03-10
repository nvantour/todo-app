import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTodos } from '../../hooks/useTodos';
import { useCategories } from '../../hooks/useCategories';
import { detectCategory } from '../../utils/categoryDetection';
import './QuickAddPage.css';

export default function QuickAddPage() {
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, signIn } = useAuth();
  const { addTodo } = useTodos();
  const { categories, loading: catsLoading } = useCategories();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [detectedCategory, setDetectedCategory] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  // Lees tekst uit URL parameter
  useEffect(() => {
    const text = searchParams.get('text');
    if (text) {
      setTitle(decodeURIComponent(text));
    }
  }, [searchParams]);

  // Auto-detect categorie wanneer titel of categorieën veranderen
  useEffect(() => {
    if (title && categories.length > 0) {
      const detected = detectCategory(title, categories);
      if (detected) {
        setDetectedCategory(detected);
        setCategoryId(detected.id);
      } else {
        setDetectedCategory(null);
        if (!categoryId) setCategoryId('');
      }
    }
  }, [title, categories]);

  // Focus op input na laden
  useEffect(() => {
    if (user && !catsLoading && inputRef.current) {
      inputRef.current.focus();
      // Zet cursor aan het einde
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [user, catsLoading]);

  const handleSave = async () => {
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      await addTodo({
        title: title.trim(),
        categoryId: categoryId || null,
        dueDate: null,
        timeEstimate: null
      });
      setSaved(true);

      // Sluit venster na 1.2 seconden
      setTimeout(() => {
        window.close();
      }, 1200);
    } catch (err) {
      console.error('Fout bij opslaan:', err);
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    // Escape sluit het venster
    if (e.key === 'Escape') {
      window.close();
    }
  };

  // Laadscherm
  if (authLoading) {
    return (
      <div className="quick-add-page">
        <div className="quick-add-card">
          <div className="quick-add-loading">Laden...</div>
        </div>
      </div>
    );
  }

  // Niet ingelogd
  if (!user) {
    return (
      <div className="quick-add-page">
        <div className="quick-add-card">
          <div className="quick-add-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <h1>Nino Todo</h1>
          </div>
          <p className="quick-add-message">Log eerst in om todo's toe te voegen</p>
          <button className="quick-add-login-btn" onClick={signIn}>
            Inloggen met Google
          </button>
        </div>
      </div>
    );
  }

  // Opgeslagen feedback
  if (saved) {
    return (
      <div className="quick-add-page">
        <div className="quick-add-card quick-add-success">
          <div className="success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#50C878" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <p className="success-text">Todo opgeslagen!</p>
          {detectedCategory && (
            <span
              className="success-category"
              style={{ backgroundColor: detectedCategory.color + '20', color: detectedCategory.color }}
            >
              {detectedCategory.name}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Formulier
  return (
    <div className="quick-add-page">
      <div className="quick-add-card">
        <div className="quick-add-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <h1>Snel toevoegen</h1>
        </div>

        <div className="quick-add-form">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Wat moet je doen?"
            className="quick-add-input"
            autoFocus
          />

          {detectedCategory && (
            <div className="quick-add-detected">
              <span
                className="detected-badge"
                style={{ backgroundColor: detectedCategory.color + '20', color: detectedCategory.color }}
              >
                {detectedCategory.name}
              </span>
              <span className="detected-label">automatisch herkend</span>
            </div>
          )}

          <div className="quick-add-category">
            <label htmlFor="category-select">Categorie</label>
            <select
              id="category-select"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setDetectedCategory(null);
              }}
            >
              <option value="">Geen categorie</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="quick-add-actions">
            <button
              className="quick-add-cancel"
              onClick={() => window.close()}
            >
              Annuleren
            </button>
            <button
              className="quick-add-save"
              onClick={handleSave}
              disabled={!title.trim() || saving}
            >
              {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </div>

          <p className="quick-add-hint">Enter = opslaan &middot; Escape = sluiten</p>
        </div>
      </div>
    </div>
  );
}
