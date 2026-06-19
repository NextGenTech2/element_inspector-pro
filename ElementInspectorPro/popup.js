/* Popup script for Element Inspector Pro */
console.log('Popup script loaded');

// Apply saved theme (default dark)
const savedTheme = localStorage.getItem('eip-theme') || 'dark';
document.body.dataset.theme = savedTheme;
console.log('Applied theme', savedTheme);

// Theme toggle button
const toggle = document.getElementById('theme-toggle');
if (toggle) {
  toggle.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
  toggle.addEventListener('click', () => {
    const newTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = newTheme;
    localStorage.setItem('eip-theme', newTheme);
    toggle.textContent = newTheme === 'dark' ? '🌙' : '☀️';
    console.log('Theme toggled to', newTheme);
  });
}

// Open inspector handler
const openBtn = document.getElementById('open-inspector');
if (openBtn) {
  openBtn.addEventListener('click', async () => {
    console.log('Open Inspector button clicked');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('Current tab', tab);
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      alert('Cannot inspect internal browser pages.');
      return;
    }
    try {
      await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      console.log('Content script injected');
    } catch (e) {
      console.error('Failed to inject script', e);
    }
    window.close();
  });
} else {
  console.warn('Open Inspector button not found');
}

// Close panel handler
const closeBtn = document.getElementById('close-panel');
if (closeBtn) {
  closeBtn.addEventListener('click', async () => {
    console.log('Close Panel button clicked');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__elementInspectorPanel) {
            window.__elementInspectorPanel.style.display = 'none';
            // Also dispatch custom event or disable hover mode if active
            const hoverBtn = window.__elementInspectorPanel.shadowRoot ? window.__elementInspectorPanel.shadowRoot.querySelector('#eip-hover-btn') : null;
            if (hoverBtn && hoverBtn.classList.contains('eip-btn-active')) {
              hoverBtn.click();
            }
          }
        }
      });
    } catch (e) {
      console.error('Failed to close panel', e);
    }
    window.close();
  });
}

