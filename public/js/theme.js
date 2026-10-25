// Night is the main mode; day only if chosen in the pantry. Runs before the page paints, so there is no flash.
try {
  if (localStorage.getItem('laventina.theme') === 'day') {
    document.documentElement.dataset.theme = 'day';
    document.querySelector('meta[name="theme-color"]').content = '#F8F5FC';
  }
} catch {}
