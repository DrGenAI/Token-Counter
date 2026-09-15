const DEFAULTS = { contextLimit: 128000, showBar: true, showUsage: true, showCache: true, debug: false };
const fields = Object.keys(DEFAULTS);
chrome.storage.sync.get(DEFAULTS, (v) => {
  for (const k of fields) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v[k]; else el.value = v[k];
    el.addEventListener('change', () => {
      const val = el.type === 'checkbox' ? el.checked : Number(el.value) || DEFAULTS[k];
      chrome.storage.sync.set({ [k]: val });
    });
  }
});
