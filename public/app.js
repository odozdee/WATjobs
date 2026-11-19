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
