import { useMemo } from 'react';
import CategorySection from './CategorySection';
import './TaskListView.css';

export default function TaskListView({ todos, categories, filter, onToggle, onEdit, onDelete, onAddClick, onSchedule }) {
  const filteredTodos = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    switch (filter) {
      case 'today':
        return todos.filter(t => {
          if (!t.dueDate) return false;
          const d = new Date(t.dueDate);
          d.setHours(0, 0, 0, 0);
          return d.getTime() === today.getTime();
        });
      case 'upcoming':
        return todos.filter(t => {
          if (!t.dueDate) return false;
          const d = new Date(t.dueDate);
          d.setHours(0, 0, 0, 0);
          return d >= today && d <= nextWeek;
        });
      case 'category':
        return todos;
      default:
        return todos;
    }
  }, [todos, filter]);

  const groupedTodos = useMemo(() => {
    const groups = {};
    const uncategorized = [];

    for (const todo of filteredTodos) {
      if (todo.categoryId) {
        if (!groups[todo.categoryId]) groups[todo.categoryId] = [];
        groups[todo.categoryId].push(todo);
      } else {
        uncategorized.push(todo);
      }
    }

    return { groups, uncategorized };
  }, [filteredTodos]);

  const getTitle = () => {
    switch (filter) {
      case 'today': return 'Vandaag';
      case 'upcoming': return 'Komend';
      default: return 'Alle taken';
    }
  };

  const openCount = filteredTodos.filter(t => !t.done).length;

  return (
    <div className="task-list">
      <div className="task-list-header">
        <h1 className="task-list-title">{getTitle()}</h1>
        <span className="task-list-count">{openCount} open</span>
        <button className="task-list-add" onClick={onAddClick}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nieuwe todo
        </button>
      </div>

      <div className="task-list-content">
        {categories
          .filter(cat => groupedTodos.groups[cat.id]?.length > 0)
          .map(cat => (
            <CategorySection
              key={cat.id}
              category={cat}
              todos={groupedTodos.groups[cat.id]}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onSchedule={onSchedule}
            />
          ))
        }

        {groupedTodos.uncategorized.length > 0 && (
          <CategorySection
            category={{ id: 'none', name: 'Zonder categorie', color: '#CCC' }}
            todos={groupedTodos.uncategorized}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}

        {filteredTodos.length === 0 && (
          <div className="task-list-empty">
            <p>Geen taken {filter === 'today' ? 'voor vandaag' : filter === 'upcoming' ? 'deze week' : ''}</p>
          </div>
        )}
      </div>
    </div>
  );
}
