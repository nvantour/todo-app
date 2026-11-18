/** Scrolt naar een taak in de huidige lijst en laat de regel even oplichten. */
export function flashTodo(id: string, tries = 20) {
  const el = document.getElementById(`todo-${id}`)
  if (!el) {
    // de lijst is misschien nog aan het laden na een routewissel
    if (tries > 0) window.setTimeout(() => flashTodo(id, tries - 1), 50)
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('is-flash')
  window.setTimeout(() => el.classList.remove('is-flash'), 1800)
}
