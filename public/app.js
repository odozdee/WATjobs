const term = document.getElementById('term');
const firstYear = 2027;
const lastYear = Math.max(firstYear, new Date().getFullYear()) + 4;

for (let year = firstYear; year <= lastYear; year++) {
  for (const season of ['Winter', 'Spring', 'Fall']) {
    const value = year + ' - ' + season;
    term.add(new Option(season + ' ' + year, value));
  }
}

term.value = firstYear + ' - Winter';

const form = document.querySelector('form');
const status = document.getElementById('form-status');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.textContent = 'Checking preferences…';

  try {
    const response = await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error);
    }
    status.textContent = 'Preferences checked. WaterlooWorks search will be connected in a later update.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
