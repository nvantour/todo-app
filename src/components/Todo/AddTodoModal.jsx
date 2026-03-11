import { useState, useEffect, useRef } from 'react';
import { detectCategory } from '../../utils/categoryDetection';
import { parseVoiceText } from '../../utils/voiceParser';
import { useVoiceInput } from '../../hooks/useVoiceInput';
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
  const [voiceTodos, setVoiceTodos] = useState([]);
  const [showVoiceList, setShowVoiceList] = useState(false);
  const titleRef = useRef(null);

  const { isListening, transcript, supported, toggleListening, stopListening } = useVoiceInput({
    lang: 'nl-NL',
    onResult: (text) => {
      setTitle(text);
      const detected = detectCategory(text, categories);
      if (detected) {
        setCategoryId(detected.id);
        setDetectedCategory(detected);
      }
    },
  });

  useEffect(() => {
    if (isOpen) {
      setTitle(prefillText || '');
      setCategoryId('');
      setDueDate('');
      setTimeEstimate('');
      setDetectedCategory(null);
      setVoiceTodos([]);
      setShowVoiceList(false);
      setTimeout(() => titleRef.current?.focus(), 100);

      if (prefillText) {
        const detected = detectCategory(prefillText, categories);
        if (detected) {
          setCategoryId(detected.id);
          setDetectedCategory(detected);
        }
      }
    } else {
      if (isListening) stopListening();
    }
  }, [isOpen, prefillText, categories]);

  // Wanneer spraak stopt: check op meerdere todo's
  useEffect(() => {
    if (!isListening && transcript && isOpen) {
      const parsed = parseVoiceText(transcript);
      if (parsed.length > 1) {
        const items = parsed.map(text => ({
          text,
          category: detectCategory(text, categories),
          checked: true,
        }));
        setVoiceTodos(items);
        setShowVoiceList(true);
      }
    }
  }, [isListening, transcript, categories, isOpen]);

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

  const handleSaveVoiceTodos = () => {
    const selected = voiceTodos.filter(t => t.checked);
    for (const item of selected) {
      onSave({
        title: item.text,
        categoryId: item.category?.id || null,
        dueDate: null,
        timeEstimate: null,
      });
    }
    onClose();
  };

  const toggleVoiceTodo = (index) => {
    setVoiceTodos(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      )
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {/* Multi-todo modus na spraak */}
        {showVoiceList ? (
          <>
            <div className="modal-header">
              <h2>{voiceTodos.length} todo's herkend</h2>
              <button type="button" className="modal-close" onClick={() => setShowVoiceList(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="voice-list-hint">Deselecteer todo's die je niet wilt toevoegen:</p>
              <div className="voice-todo-list">
                {voiceTodos.map((item, i) => (
                  <label key={i} className={`voice-todo-item ${!item.checked ? 'voice-todo-item--unchecked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggleVoiceTodo(i)}
                    />
                    <span className="voice-todo-text">{item.text}</span>
                    {item.category && (
                      <span
                        className="voice-todo-cat"
                        style={{ backgroundColor: item.category.color + '20', color: item.category.color }}
                      >
                        {item.category.name}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--secondary" onClick={() => setShowVoiceList(false)}>
                Terug
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSaveVoiceTodos}
                disabled={!voiceTodos.some(t => t.checked)}
              >
                {voiceTodos.filter(t => t.checked).length} todo's opslaan
              </button>
            </div>
          </>
        ) : (
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
                <div className="input-with-mic">
                  <input
                    ref={titleRef}
                    type="text"
                    className="form-input form-input--title"
                    placeholder={isListening ? 'Luisteren...' : 'Wat moet je doen?'}
                    value={title}
                    onChange={e => handleTitleChange(e.target.value)}
                  />
                  {supported && (
                    <button
                      type="button"
                      className={`mic-btn ${isListening ? 'mic-btn--active' : ''}`}
                      onClick={toggleListening}
                      title={isListening ? 'Stop opname' : 'Spraak invoer'}
                    >
                      {isListening ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                          <line x1="12" y1="19" x2="12" y2="23"/>
                          <line x1="8" y1="23" x2="16" y2="23"/>
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                {isListening && (
                  <div className="voice-indicator">
                    <span className="voice-dot" />
                    Luisteren... Zeg &quot;en&quot; of &quot;ook&quot; voor meerdere todo's
                  </div>
                )}
                {detectedCategory && !isListening && (
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
        )}
      </div>
    </div>
  );
}
