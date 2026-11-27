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
const status = document.getElementById('status');
form.querySelector('button[type="submit"]').textContent = 'Find matches';

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!token) {
    status.textContent = 'Connect to a Steel browser and sign in to WaterlooWorks first.';
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.textContent = 'Searching WaterlooWorks…';
  connect.disabled = true;

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: Object.fromEntries(new FormData(form)),
        token,
        board: document.getElementById('board').value,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error);
    }
    renderJobs(result.jobs);
    status.textContent = result.keywordFallback
      ? 'No keyword matches. Showing ' + result.jobs.length + (result.jobs.length === 1 ? ' candidate' : ' candidates') + ' based on available filters.'
      : result.jobs.length + (result.jobs.length === 1 ? ' result' : ' results');
    token = undefined;
    viewer.removeAttribute('src');
    document.getElementById('session').hidden = true;
    connect.textContent = 'Connect';
    connectionStatus.textContent = 'Steel browser closed.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    connect.disabled = false;
  }
});

const connect = document.getElementById('connect');
const connectionStatus = document.getElementById('source-note');
const viewer = document.getElementById('viewer');
let token;

fetch('/api/config').then(async response => {
  const config = await response.json();
  connect.disabled = !config.liveReady;
  connectionStatus.textContent = config.liveReady
    ? 'Sign in through Steel to search WaterlooWorks.'
    : 'Set up Steel to enable WaterlooWorks search.';
}).catch(() => {
  connectionStatus.textContent = 'Could not check live search availability.';
});

connect.addEventListener('click', async () => {
  connect.disabled = true;
  connectionStatus.textContent = token ? 'Closing Steel browser…' : 'Starting Steel browser…';
  try {
    const response = await fetch(token ? '/api/disconnect' : '/api/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const session = await response.json();
    if (!response.ok) {
      throw new Error(session.error);
    }
    if (token) {
      token = undefined;
      viewer.removeAttribute('src');
      document.getElementById('session').hidden = true;
      connect.textContent = 'Connect';
      connectionStatus.textContent = 'Steel browser closed.';
    } else {
      token = session.token;
      viewer.src = session.viewer;
      document.getElementById('session').hidden = false;
      connect.textContent = 'Disconnect';
      connectionStatus.textContent = 'Steel browser ready.';
      document.getElementById('session-title').focus();
    }
  } catch (error) {
    connectionStatus.textContent = error.message;
  } finally {
    connect.disabled = false;
  }
});

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) {
    node.textContent = text;
  }
  if (className) {
    node.className = className;
  }
  return node;
}

function renderJobs(jobs) {
  const results = document.getElementById('results');
  results.replaceChildren();
  if (!jobs.length) {
    results.append(element('p', 'No matching postings. Try broadening your preferences.'));
    return;
  }
  const moreResults = element('details', '', 'more-results');
  if (jobs.length > 3) {
    moreResults.append(element('summary', 'Show ' + (jobs.length - 3) + ' more jobs'));
  }
  for (const [index, job] of jobs.entries()) {
    const card = element('details', '', 'job');
    const summary = element('summary', job.title, 'job-title');
    card.append(summary);
    const facts = element('dl', '', 'job-facts');
    for (const [label, value] of [
      ['Organization', job.company], ['City', job.location],
      ['Level', job.level], ['Application Deadline', job.applicationDeadline],
    ]) {
      const field = element('div');
      field.append(element('dt', label), element('dd', value || 'Not listed'));
      facts.append(field);
    }
    card.append(facts);
    if (job.jobId) {
      card.append(element('p', 'WaterlooWorks Job ID ' + job.jobId));
    }
    const details = element('div', '', 'job-details');
    const metadata = [job.term, job.duration].filter(Boolean);
    if (metadata.length) {
      details.append(element('p', metadata.join(' · ')));
    }
    if (job.description) {
      details.append(element('p', job.description, 'description'));
    }
    const application = element('section', '', 'application-details');
    application.append(element('h3', 'Application details'));
    const applicationFields = [
      { label: 'Application Deadline', value: job.applicationDeadline },
      ...(job.applicationDetails ?? []),
    ];
    for (const { label, value } of applicationFields) {
      if (!value) continue;
      const field = element('p', '', 'description');
      field.append(element('strong', label + ' — '), document.createTextNode(value));
      application.append(field);
    }
    if (job.applicationEmail) {
      const field = element('p', '', 'description');
      const email = element('a', job.applicationEmail);
      email.href = 'mailto:' + encodeURIComponent(job.applicationEmail).replace('%40', '@');
      field.append(element('strong', 'If by email, send to — '), email);
      application.append(field);
    }
    if (job.applicationUrl) {
      const link = element('a', 'Open application ↗', 'apply');
      link.href = job.applicationUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      application.append(link);
    } else if (!job.applicationEmail && !job.applicationDetails?.length) {
      application.append(element('p', job.tableOnly ? 'Open this posting in WaterlooWorks to check how to apply.' : 'See the posting in WaterlooWorks for application instructions.', 'description'));
    }
    details.append(application);
    card.append(details);
    const target = index < 3 ? results : moreResults;
    target.append(card);
  }
  if (jobs.length > 3) {
    results.append(moreResults);
  }
}
