const form = document.getElementById('quick-form');
const input = document.getElementById('todo-input');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  // Stuur bericht naar background.js om webapp te openen
  chrome.runtime.sendMessage({
    action: 'open-quick-add',
    text: text
  });

  // Sluit de popup
  window.close();
});

// Focus direct op het invoerveld
input.focus();
