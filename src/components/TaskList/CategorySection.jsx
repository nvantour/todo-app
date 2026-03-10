import { useState } from 'react';
import TodoItem from './TodoItem';
import { totalTimeEstimate } from '../../utils/formatting';
import './CategorySection.css';

export default function CategorySection({ category, todos, onToggle, onEdit, onDelete }) {
  const [collapsed, setCollapsed] = useState(false);
  const openTodos = todos.filter(t => !t.done);
  const doneTodos = todos.filter(t => t.done);
  const [showDone, setShowDone] = useState(false);

  return (
    <div className="category-section">
      <button className="category-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="category-dot" style={{ background: category.color }} />
        <span className="category-name">{category.name}</span>
        <span className="category-count">{openTodos.length}</span>
        {openTodos.length > 0 && (
          <span className="category-time">{totalTimeEstimate(openTodos)}</span>
        )}
        <span className={`category-chevron ${collapsed ? 'category-chevron--collapsed' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {!collapsed && (
        <div className="category-todos">
          {openTodos.map(todo => (
            <TodoItem
              key={todo.id}
              todo={todo}
              category={category}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}

          {doneTodos.length > 0 && (
            <>
              <button className="category-done-toggle" onClick={() => setShowDone(!showDone)}>
                Afgerond ({doneTodos.length}) {showDone ? '▴' : '▾'}
              </button>
              {showDone && doneTodos.map(todo => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  category={category}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
