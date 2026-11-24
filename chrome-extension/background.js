const WEBAPP_URL = 'https://work-apps-48770.web.app';

// Registreer context menu bij installatie
chrome.runtime.onInstalled.addListener(() => {
  // Menu-item bij geselecteerde tekst
  chrome.contextMenus.create({
    id: 'add-todo-selection',
    title: 'Toevoegen als taak: "%s"',
    contexts: ['selection']
  });
  // Menu-item zonder selectie (opent lege quick-add)
  chrome.contextMenus.create({
    id: 'add-todo-page',
    title: 'Nieuwe taak toevoegen',
    contexts: ['page']
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'add-todo-selection' && info.selectionText) {
    const text = encodeURIComponent(info.selectionText.trim());
    openQuickAdd(text);
  } else if (info.menuItemId === 'add-todo-page') {
    openQuickAdd('');
  }
});

// Open de webapp quick-add pagina in een popup-venster
function openQuickAdd(text) {
  const url = text
    ? `${WEBAPP_URL}/quick-add?text=${text}`
    : `${WEBAPP_URL}/quick-add`;

  chrome.windows.create({
    url: url,
    type: 'popup',
    width: 480,
    height: 520,
    top: 120,
    left: Math.round(screen.availWidth / 2 - 240)
  });
}

// Luister naar berichten van de popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'open-quick-add') {
    openQuickAdd(message.text || '');
  }
});
