// Apply the saved theme before first paint. The theme is not sensitive, so it
// is kept outside the encrypted vault (the lock screen needs it too).
try {
  if (localStorage.getItem('spendly.theme') === 'light') document.documentElement.classList.add('theme-light');
} catch (e) { /* storage blocked: stay dark */ }
