const TZ = 'Europe/Amsterdam'

/** Vandaag als 'YYYY-MM-DD' in de tijd van Nederland (de server draait zelf in UTC). */
export function todayAmsterdam(now: Date = new Date()): string {
  // 'en-CA' geeft precies YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
