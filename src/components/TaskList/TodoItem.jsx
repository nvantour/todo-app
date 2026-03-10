import { formatDueDate, formatTimeEstimate } from '../../utils/formatting';
import './TodoItem.css';

export default function TodoItem({ todo, category, onToggle, onEdit, onDelete, onSchedule }) {
  const isOverdue = todo.dueDate && !todo.done && new Date(todo.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
  const isToday = todo.dueDate && new Date(todo.dueDate).toDateString() === new Date().toDateString();

  return (
    <div className={`todo-item ${todo.done ? 'todo-item--done' : ''}`}>
      <button
        className="todo-checkbox"
        onClick={() => onToggle(todo.id)}
        style={{ borderColor: category?.color || 'var(--color-border)' }}
      >
        {todo.done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div className="todo-content" onClick={() => onEdit?.(todo)}>
        <span className="todo-title">{todo.title}</span>
        <div className="todo-meta">
          {todo.dueDate && (
            <span className={`todo-due ${isOverdue ? 'todo-due--overdue' : ''} ${isToday ? 'todo-due--today' : ''}`}>
              {formatDueDate(todo.dueDate)}
            </span>
          )}
          {todo.timeEstimate && (
            <span className="todo-time">{formatTimeEstimate(todo.timeEstimate)}</span>
          )}
          {todo.calendarEventId && (
            <span className="todo-calendar-badge" title="Ingepland in agenda">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
          )}
        </div>
      </div>

      {!todo.done && todo.timeEstimate && !todo.calendarEventId && (
        <button
          className="todo-schedule"
          onClick={(e) => { e.stopPropagation(); onSchedule?.(todo); }}
          title="Inplannen in agenda"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </button>
      )}

      <button className="todo-delete" onClick={() => onDelete(todo.id)} title="Verwijderen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
