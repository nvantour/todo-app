import { useState, useEffect, useRef } from 'react';
import './TodoModal.css';

const TIME_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1u', value: 60 },
  { label: '2u', value: 120 },
];

export default function EditTodoModal({ todo, isOpen, onClose, onSave, onDelete, onSchedule, categories }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [timeEstimate, setTimeEstimate] = useState('');
  const titleRef = useRef(null);

  useEffect(() => {
    if (isOpen && todo) {
      setTitle(todo.title || '');
      setCategoryId(todo.categoryId || '');
      setDueDate(todo.dueDate ? new Date(todo.dueDate).toISOString().split('T')[0] : '');
      setTimeEstimate(todo.timeEstimate ? String(todo.timeEstimate) : '');
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [isOpen, todo]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim() || !todo) return;
    onSave(todo.id, {
      title: title.trim(),
      categoryId: categoryId || null,
      dueDate: dueDate || null,
      timeEstimate: timeEstimate ? parseInt(timeEstimate) : null,
    });
    onClose();
  };

  if (!isOpen || !todo) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h2>Todo bewerken</h2>
            <button type="button" className="modal-close" onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="modal-body">
            <div className="form-group">
              <input
                ref={titleRef}
                type="text"
                className="form-input form-input--title"
                placeholder="Wat moet je doen?"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Categorie</label>
                <select
                  className="form-select"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">Geen categorie</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Due date</label>
                <input
                  type="date"
                  className="form-input"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Tijdsinschatting</label>
              <div className="time-presets">
                {TIME_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`time-preset ${parseInt(timeEstimate) === preset.value ? 'time-preset--active' : ''}`}
                    onClick={() => setTimeEstimate(String(preset.value))}
                  >
                    {preset.label}
                  </button>
                ))}
                <input
                  type="number"
                  className="form-input form-input--time"
                  placeholder="min"
                  value={timeEstimate}
                  onChange={e => setTimeEstimate(e.target.value)}
                  min="1"
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => { onDelete(todo.id); onClose(); }}
            >
              Verwijderen
            </button>
            <div className="modal-footer-right">
              {!todo.done && (timeEstimate || todo.timeEstimate) && (
                <button
                  type="button"
                  className="btn btn--calendar"
                  onClick={() => { onClose(); onSchedule?.(todo); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Inplannen
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={onClose}>Annuleren</button>
              <button type="submit" className="btn btn--primary" disabled={!title.trim()}>Opslaan</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
