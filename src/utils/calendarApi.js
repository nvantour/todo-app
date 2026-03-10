const BASE_URL = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error?.message || `Calendar API error: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Maak een agenda-event aan voor een todo
 */
export async function createCalendarEvent(accessToken, { title, startTime, endTime, description }) {
  const event = {
    summary: title,
    description: description || '',
    start: { dateTime: startTime.toISOString(), timeZone: 'Europe/Amsterdam' },
    end: { dateTime: endTime.toISOString(), timeZone: 'Europe/Amsterdam' },
    reminders: { useDefault: true },
  };

  return calendarFetch(`${BASE_URL}/calendars/primary/events`, accessToken, {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

/**
 * Verwijder een agenda-event
 */
export async function deleteCalendarEvent(accessToken, eventId) {
  return calendarFetch(`${BASE_URL}/calendars/primary/events/${eventId}`, accessToken, {
    method: 'DELETE',
  });
}

/**
 * Haal drukke tijden op voor een periode
 */
export async function getFreeBusy(accessToken, timeMin, timeMax) {
  const result = await calendarFetch(`${BASE_URL}/freeBusy`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'Europe/Amsterdam',
      items: [{ id: 'primary' }],
    }),
  });

  return result.calendars?.primary?.busy || [];
}

/**
 * Vind vrije slots in de komende werkdagen
 * @param {string} accessToken
 * @param {number} durationMinutes - hoe lang het slot moet zijn
 * @param {object} options - { daysAhead: 5, workdayStart: 9, workdayEnd: 17.5 }
 * @returns {Array<{ start: Date, end: Date }>} - beschikbare slots
 */
export async function findFreeSlots(accessToken, durationMinutes, options = {}) {
  const { daysAhead = 5, workdayStart = 9, workdayEnd = 17.5 } = options;

  const now = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead + 2); // extra marge voor weekenddagen

  const busyTimes = await getFreeBusy(accessToken, now, endDate);

  // Zet busy times om naar Date objects
  const busy = busyTimes.map(b => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  const slots = [];
  const durationMs = durationMinutes * 60 * 1000;
  let workdaysFound = 0;
  let currentDate = new Date(now);
  currentDate.setHours(0, 0, 0, 0);

  while (workdaysFound < daysAhead && slots.length < 10) {
    const dayOfWeek = currentDate.getDay();

    // Sla weekend over
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    workdaysFound++;

    // Werkdag start en einde
    const dayStart = new Date(currentDate);
    dayStart.setHours(Math.floor(workdayStart), (workdayStart % 1) * 60, 0, 0);
    const dayEnd = new Date(currentDate);
    dayEnd.setHours(Math.floor(workdayEnd), (workdayEnd % 1) * 60, 0, 0);

    // Als het vandaag is, begin op z'n vroegst nu (afgerond naar volgende kwartier)
    let windowStart = new Date(Math.max(dayStart.getTime(), now.getTime()));
    const mins = windowStart.getMinutes();
    const roundUp = Math.ceil(mins / 15) * 15;
    windowStart.setMinutes(roundUp, 0, 0);
    if (windowStart < dayStart) windowStart = new Date(dayStart);

    // Zoek gaten in de busy times voor deze dag
    const dayBusy = busy
      .filter(b => b.end > windowStart && b.start < dayEnd)
      .sort((a, b) => a.start - b.start);

    let cursor = new Date(windowStart);

    for (const block of dayBusy) {
      const gapEnd = new Date(Math.min(block.start.getTime(), dayEnd.getTime()));

      if (gapEnd - cursor >= durationMs) {
        slots.push({
          start: new Date(cursor),
          end: new Date(cursor.getTime() + durationMs),
        });
        if (slots.length >= 10) break;
      }

      cursor = new Date(Math.max(cursor.getTime(), block.end.getTime()));
    }

    // Check resterende tijd na laatste busy block
    if (slots.length < 10 && dayEnd - cursor >= durationMs) {
      slots.push({
        start: new Date(cursor),
        end: new Date(cursor.getTime() + durationMs),
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return slots;
}

/**
 * Formatteer een slot voor weergave
 */
export function formatSlot(slot) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slotDate = new Date(start);
  slotDate.setHours(0, 0, 0, 0);

  let dayLabel;
  if (slotDate.getTime() === today.getTime()) {
    dayLabel = 'Vandaag';
  } else if (slotDate.getTime() === tomorrow.getTime()) {
    dayLabel = 'Morgen';
  } else {
    dayLabel = start.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  const timeStart = start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const timeEnd = end.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  return { dayLabel, timeRange: `${timeStart} – ${timeEnd}` };
}
