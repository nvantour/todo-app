import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTodos } from '../../hooks/useTodos';
import { useCategories } from '../../hooks/useCategories';
import { detectCategory } from '../../utils/categoryDetection';
import { parseVoiceText } from '../../utils/voiceParser';
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
  const [savedCount, setSavedCount] = useState(0);
  // Multi-todo state
  const [multiTodos, setMultiTodos] = useState([]);
  const [showMultiList, setShowMultiList] = useState(false);
  const inputRef = useRef(null);
  const autoSaveTriggered = useRef(false);

  const isAutoSave = searchParams.get('autosave') === 'true';

  // Lees tekst uit URL parameter
  useEffect(() => {
    const text = searchParams.get('text');
    if (text) {
      const decoded = decodeURIComponent(text);
      setTitle(decoded);

      // Check voor meerdere todo's
      const parsed = parseVoiceText(decoded);
      if (parsed.length > 1) {
        setShowMultiList(true);
        // Items worden gezet zodra categories geladen zijn (zie volgend effect)
      }
    }
  }, [searchParams]);

  // Multi-todo items bijwerken wanneer categories laden
  useEffect(() => {
    if (showMultiList && categories.length > 0) {
      const parsed = parseVoiceText(title);
      if (parsed.length > 1) {
        const items = parsed.map(text => ({
          text,
          category: detectCategory(text, categories),
          checked: true,
        }));
        setMultiTodos(items);
      }
    }
  }, [showMultiList, categories, title]);

  // Auto-detect categorie voor enkele todo
  useEffect(() => {
    if (title && categories.length > 0 && !showMultiList) {
      const detected = detectCategory(title, categories);
      if (detected) {
        setDetectedCategory(detected);
        setCategoryId(detected.id);
      } else {
        setDetectedCategory(null);
        if (!categoryId) setCategoryId('');
      }
    }
  }, [title, categories, showMultiList]);

  // Focus op input na laden
  useEffect(() => {
    if (user && !catsLoading && inputRef.current && !isAutoSave) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [user, catsLoading, isAutoSave]);

  // Enkele todo opslaan
  const handleSaveSingle = useCallback(async () => {
    if (!title.trim() || saving) return;

    setSaving(true);
    try {
      await addTodo({
        title: title.trim(),
        categoryId: categoryId || null,
        dueDate: null,
        timeEstimate: null,
      });
      setSavedCount(1);
      setSaved(true);
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      console.error('Fout bij opslaan:', err);
      setSaving(false);
    }
  }, [title, categoryId, saving, addTodo]);

  // Meerdere todo's opslaan
  const handleSaveMulti = useCallback(async () => {
    const selected = multiTodos.filter(t => t.checked);
    if (selected.length === 0 || saving) return;

    setSaving(true);
    try {
      for (const item of selected) {
        await addTodo({
          title: item.text,
          categoryId: item.category?.id || null,
          dueDate: null,
          timeEstimate: null,
        });
      }
      setSavedCount(selected.length);
      setSaved(true);
      setTimeout(() => window.close(), 1500);
    } catch (err) {
      console.error('Fout bij opslaan:', err);
      setSaving(false);
    }
  }, [multiTodos, saving, addTodo]);

  // Auto-save: automatisch opslaan zodra alles geladen is
  useEffect(() => {
    if (!isAutoSave || !user || catsLoading || autoSaveTriggered.current) return;
    if (!title.trim()) return;

    autoSaveTriggered.current = true;

    // Korte delay zodat categorie-detectie kan draaien
    const timer = setTimeout(() => {
      if (showMultiList && multiTodos.length > 0) {
        handleSaveMulti();
      } else {
        handleSaveSingle();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [isAutoSave, user, catsLoading, title, showMultiList, multiTodos, handleSaveMulti, handleSaveSingle]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveSingle();
    }
    if (e.key === 'Escape') {
      window.close();
    }
  };

  const toggleMultiTodo = (index) => {
    setMultiTodos(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      )
    );
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
          <p className="quick-add-message">Log eerst in om todo&apos;s toe te voegen</p>
          <button className="quick-add-login-btn" onClick={signIn}>
            Inloggen met Google
          </button>
        </div>
      </div>
    );
  }

  // Auto-save laadscherm
  if (isAutoSave && !saved) {
    return (
      <div className="quick-add-page">
        <div className="quick-add-card">
          <div className="quick-add-autosave">
            <div className="autosave-spinner" />
            <p className="autosave-text">
              {saving ? 'Opslaan...' : 'Verwerken...'}
            </p>
            {showMultiList && multiTodos.length > 0 && (
              <div className="autosave-preview">
                {multiTodos.map((item, i) => (
                  <div key={i} className="autosave-item">
                    <span className="autosave-bullet">&#8226;</span>
                    <span>{item.text}</span>
                    {item.category && (
                      <span
                        className="autosave-cat"
                        style={{ backgroundColor: item.category.color + '20', color: item.category.color }}
                      >
                        {item.category.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!showMultiList && title && (
              <div className="autosave-preview">
                <div className="autosave-item">
                  <span className="autosave-bullet">&#8226;</span>
                  <span>{title}</span>
                  {detectedCategory && (
                    <span
                      className="autosave-cat"
                      style={{ backgroundColor: detectedCategory.color + '20', color: detectedCategory.color }}
                    >
                      {detectedCategory.name}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
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
          <p className="success-text">
            {savedCount > 1 ? `${savedCount} todo's opgeslagen!` : 'Todo opgeslagen!'}
          </p>
          {savedCount === 1 && detectedCategory && (
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

  // Multi-todo lijst
  if (showMultiList && multiTodos.length > 0) {
    return (
      <div className="quick-add-page">
        <div className="quick-add-card">
          <div className="quick-add-header">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <h1>{multiTodos.length} todo&apos;s herkend</h1>
          </div>

          <div className="quick-add-form">
            <p className="quick-add-multi-hint">Deselecteer todo&apos;s die je niet wilt toevoegen:</p>
            <div className="quick-add-multi-list">
              {multiTodos.map((item, i) => (
                <label key={i} className={`quick-add-multi-item ${!item.checked ? 'quick-add-multi-item--unchecked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleMultiTodo(i)}
                  />
                  <span className="quick-add-multi-text">{item.text}</span>
                  {item.category && (
                    <span
                      className="quick-add-multi-cat"
                      style={{ backgroundColor: item.category.color + '20', color: item.category.color }}
                    >
                      {item.category.name}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="quick-add-actions">
              <button
                className="quick-add-cancel"
                onClick={() => {
                  setShowMultiList(false);
                  setMultiTodos([]);
                }}
              >
                Terug
              </button>
              <button
                className="quick-add-save"
                onClick={handleSaveMulti}
                disabled={!multiTodos.some(t => t.checked) || saving}
              >
                {saving ? 'Opslaan...' : `${multiTodos.filter(t => t.checked).length} todo's opslaan`}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standaard formulier (enkele todo)
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
              onClick={handleSaveSingle}
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
