// Demo only. A real site would POST to its backend. There is no backend here,
// so we intercept submit and navigate to the confirmation page passing ONLY the
// non-sensitive category — never the other field values.
document.getElementById('complaint-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const category = document.getElementById('category').value || 'gen';
  location.href = `success.html?category=${encodeURIComponent(category)}`;
});
