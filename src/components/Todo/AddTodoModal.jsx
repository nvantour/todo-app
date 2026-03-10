import { useState, useEffect, useRef } from 'react';
import { detectCategory } from '../../utils/categoryDetection';
import './TodoModal.css';

const TIME_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1u', value: 60 },
  { label: '2u', value: 120 },
];

export default function AddTodoModal({ isOpen, onClose, onSave, categories, prefillText }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [timeEstimate, setTimeEstimate] = useState('');
  const [detectedCategory, setDetectedCategory] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(prefillText || '');
      setCategoryId('');
      setDueDate('');
      setTimeEstimate('');
      setDetectedCategory(null);
      setTimeout(() => titleRef.current?.focus(), 100);

      if (prefillText) {
        const detected = detectCategory(prefillText, categories);
        if (detected) {
          setCategoryId(detected.id);
          setDetectedCategory(detected);
        }
      }
    }
  }, [isOpen, prefillText, categories]);

  const handleTitleChange = (value) => {
    setTitle(value);
    const detected = detectCategory(value, categories);
    if (detected && !categoryId) {
      setCategoryId(detected.id);
      setDetectedCategory(detected);
    } else if (!detected) {
      setDetectedCategory(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      categoryId: categoryId || null,
      dueDate: dueDate || null,
      timeEstimate: timeEstimate ? parseInt(timeEstimate) : null,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h2>Nieuwe todo</h2>
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
                onChange={e => handleTitleChange(e.target.value)}
              />
              {detectedCategory && (
                <span className="detected-badge" style={{ background: detectedCategory.color }}>
                  {detectedCategory.name} herkend
                </span>
              )}
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
            <button type="button" className="btn btn--secondary" onClick={onClose}>Annuleren</button>
            <button type="submit" className="btn btn--primary" disabled={!title.trim()}>Opslaan</button>
          </div>
        </form>
      </div>
    </div>
  );
}
