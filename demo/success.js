// Demo only: derive a pseudo reference number from the submitted category.
(function () {
  const params = new URLSearchParams(location.search);
  const cat = (params.get('category') || 'gen').slice(0, 3).toUpperCase();
  const n = String(Math.floor(Date.now() / 1000) % 1000000).padStart(6, '0');
  document.getElementById('ref').textContent = `DEMO-${cat}-${n}`;
  document.getElementById('time').textContent = new Date().toLocaleString();
})();
