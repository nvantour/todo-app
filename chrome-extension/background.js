const WEBAPP_URL = 'https://nvantour.github.io/todo-app';

// Registreer context menu bij installatie
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-todo',
    title: 'Toevoegen als todo',
    contexts: ['selection']
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'add-todo' && info.selectionText) {
    const text = encodeURIComponent(info.selectionText.trim());
    openQuickAdd(text);
  }
});

// Open de webapp quick-add pagina in een popup-venster
function openQuickAdd(text) {
  const url = text
    ? `${WEBAPP_URL}/#/quick-add?text=${text}`
    : `${WEBAPP_URL}/#/quick-add`;

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
