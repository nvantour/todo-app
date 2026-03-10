export function formatDueDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateOnly = new Date(d);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) return 'Vandaag';
  if (dateOnly.getTime() === tomorrow.getTime()) return 'Morgen';

  const diff = Math.ceil((dateOnly - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d geleden`;
  if (diff < 7) {
    return d.toLocaleDateString('nl-NL', { weekday: 'short' });
  }
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

export function formatTimeEstimate(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}u ${mins}m` : `${hours}u`;
}

export function totalTimeEstimate(todos) {
  const total = todos.reduce((sum, t) => sum + (t.timeEstimate || 0), 0);
  return formatTimeEstimate(total);
}
