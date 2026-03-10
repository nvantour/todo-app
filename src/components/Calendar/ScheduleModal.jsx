import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { findFreeSlots, formatSlot, createCalendarEvent, deleteCalendarEvent } from '../../utils/calendarApi';
import { formatTimeEstimate } from '../../utils/formatting';
import '../Todo/TodoModal.css';
import './ScheduleModal.css';

export default function ScheduleModal({ todo, isOpen, onClose, onEventCreated, onEventRemoved, category }) {
  const { accessToken, refreshAccessToken } = useAuth();
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && todo?.timeEstimate && accessToken) {
      loadSlots();
    }
  }, [isOpen, todo, accessToken]);

  const getToken = async () => {
    if (accessToken) return accessToken;
    return await refreshAccessToken();
  };

  const loadSlots = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Geen Calendar-toegang. Log opnieuw in.');
        setLoading(false);
        return;
      }
      const freeSlots = await findFreeSlots(token, todo.timeEstimate);
      setSlots(freeSlots);
    } catch (err) {
      if (err.message.includes('401') || err.message.includes('403')) {
        // Token verlopen, probeer te vernieuwen
        try {
          const newToken = await refreshAccessToken();
          if (newToken) {
            const freeSlots = await findFreeSlots(newToken, todo.timeEstimate);
            setSlots(freeSlots);
          } else {
            setError('Calendar-toegang verlopen. Log opnieuw in.');
          }
        } catch {
          setError('Calendar-toegang verlopen. Log opnieuw in.');
        }
      } else {
        setError(`Fout bij laden slots: ${err.message}`);
      }
    }
    setLoading(false);
  };

  const handleSchedule = async (slot) => {
    setScheduling(true);
    setError(null);
    try {
      const token = await getToken();
      const categoryName = category?.name ? `[${category.name}] ` : '';
      const event = await createCalendarEvent(token, {
        title: `${categoryName}${todo.title}`,
        startTime: new Date(slot.start),
        endTime: new Date(slot.end),
        description: `Todo uit Nino Todo app`,
      });
      setSuccess(true);
      onEventCreated(todo.id, event.id);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      setError(`Fout bij inplannen: ${err.message}`);
    }
    setScheduling(false);
  };

  const handleRemoveEvent = async () => {
    if (!todo.calendarEventId) return;
    setScheduling(true);
    setError(null);
    try {
      const token = await getToken();
      await deleteCalendarEvent(token, todo.calendarEventId);
      onEventRemoved(todo.id);
      onClose();
    } catch (err) {
      setError(`Fout bij verwijderen: ${err.message}`);
    }
    setScheduling(false);
  };

  if (!isOpen || !todo) return null;

  // Geen tijdsinschatting
  if (!todo.timeEstimate) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal schedule-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Inplannen</h2>
            <button type="button" className="modal-close" onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <div className="schedule-empty">
              <p>Voeg eerst een tijdsinschatting toe aan deze todo.</p>
              <p className="schedule-empty-hint">Bewerk de todo en stel een tijdsinschatting in (bijv. 30m, 1u).</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal schedule-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Inplannen</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="schedule-todo-info">
            <span className="schedule-todo-title">{todo.title}</span>
            <span className="schedule-todo-duration">{formatTimeEstimate(todo.timeEstimate)}</span>
          </div>

          {todo.calendarEventId && (
            <div className="schedule-existing">
              <div className="schedule-existing-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#50C878" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span>Al ingepland in je agenda</span>
              </div>
              <button
                className="btn btn--danger"
                onClick={handleRemoveEvent}
                disabled={scheduling}
              >
                Verwijderen uit agenda
              </button>
            </div>
          )}

          {!todo.calendarEventId && (
            <>
              <p className="schedule-subtitle">Kies een vrij moment:</p>

              {loading && (
                <div className="schedule-loading">Vrije slots zoeken...</div>
              )}

              {error && (
                <div className="schedule-error">{error}</div>
              )}

              {success && (
                <div className="schedule-success">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#50C878" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  Ingepland!
                </div>
              )}

              {!loading && !success && slots.length > 0 && (
                <div className="schedule-slots">
                  {slots.map((slot, i) => {
                    const formatted = formatSlot(slot);
                    return (
                      <button
                        key={i}
                        className="schedule-slot"
                        onClick={() => handleSchedule(slot)}
                        disabled={scheduling}
                      >
                        <span className="slot-day">{formatted.dayLabel}</span>
                        <span className="slot-time">{formatted.timeRange}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!loading && !success && slots.length === 0 && !error && (
                <div className="schedule-empty">
                  <p>Geen vrije slots gevonden in de komende 5 werkdagen.</p>
                </div>
              )}

              {!loading && !success && (
                <button className="btn btn--secondary schedule-refresh" onClick={loadSlots}>
                  Opnieuw zoeken
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
