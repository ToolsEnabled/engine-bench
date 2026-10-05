// Picks the colour theme before the page paints: the saved choice, else the system setting.
(function () {
  var t = null;
  try { t = localStorage.getItem('te-theme'); } catch (e) { /* storage off */ }
  if (t !== 'dark' && t !== 'light') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
})();
