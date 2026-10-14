(function () {
  try {
    var theme = JSON.parse(localStorage.getItem('ttc:theme:v1'));
    var dark =
      theme === 'dark' ||
      (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (!dark) return;
    document.documentElement.dataset.theme = 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#111f29');
  } catch (error) {}
})();
