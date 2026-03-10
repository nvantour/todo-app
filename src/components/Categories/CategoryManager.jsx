import { useState } from 'react';
import './CategoryManager.css';

const COLOR_OPTIONS = [
  '#4A90D9', '#E85D75', '#50C878', '#F5A623', '#9B59B6',
  '#95A5A6', '#E67E22', '#1ABC9C', '#E74C3C', '#3498DB',
];

export default function CategoryManager({ categories, onAdd, onUpdate, onDelete }) {
  const [newName, setNewName] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editColor, setEditColor] = useState('');

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onAdd({
      name: newName.trim(),
      keywords: newKeywords ? newKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [],
      color: newColor,
    });
    setNewName('');
    setNewKeywords('');
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditKeywords((cat.keywords || []).join(', '));
    setEditColor(cat.color);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    await onUpdate(editingId, {
      name: editName.trim(),
      keywords: editKeywords ? editKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [],
      color: editColor,
    });
    setEditingId(null);
  };

  return (
    <div className="category-manager">
      <h1 className="category-manager-title">Categorieën</h1>

      <div className="category-list">
        {categories.map(cat => (
          <div key={cat.id} className="category-card">
            {editingId === cat.id ? (
              <div className="category-edit">
                <input
                  type="text"
                  className="form-input"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Naam"
                />
                <input
                  type="text"
                  className="form-input"
                  value={editKeywords}
                  onChange={e => setEditKeywords(e.target.value)}
                  placeholder="Keywords (komma-gescheiden)"
                />
                <div className="color-picker">
                  {COLOR_OPTIONS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${editColor === color ? 'color-option--active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setEditColor(color)}
                    />
                  ))}
                </div>
                <div className="category-edit-actions">
                  <button className="btn btn--secondary" onClick={() => setEditingId(null)}>Annuleren</button>
                  <button className="btn btn--primary" onClick={saveEdit}>Opslaan</button>
                </div>
              </div>
            ) : (
              <div className="category-display">
                <span className="category-dot" style={{ background: cat.color }} />
                <div className="category-info">
                  <span className="category-card-name">{cat.name}</span>
                  <span className="category-keywords">{(cat.keywords || []).join(', ')}</span>
                </div>
                <button className="btn btn--secondary" onClick={() => startEdit(cat)}>Bewerken</button>
                <button className="btn btn--danger" onClick={() => onDelete(cat.id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="category-add-form" onSubmit={handleAdd}>
        <h3>Nieuwe categorie</h3>
        <input
          type="text"
          className="form-input"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Naam (bijv. Sunny Cars)"
        />
        <input
          type="text"
          className="form-input"
          value={newKeywords}
          onChange={e => setNewKeywords(e.target.value)}
          placeholder="Keywords (bijv. sunny, sunny cars)"
        />
        <div className="color-picker">
          {COLOR_OPTIONS.map(color => (
            <button
              key={color}
              type="button"
              className={`color-option ${newColor === color ? 'color-option--active' : ''}`}
              style={{ background: color }}
              onClick={() => setNewColor(color)}
            />
          ))}
        </div>
        <button type="submit" className="btn btn--primary" disabled={!newName.trim()}>
          Toevoegen
        </button>
      </form>
    </div>
  );
}
