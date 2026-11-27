const get = id => document.getElementById(id);
const form = get('profile');
const term = form.elements.term;
const firstYear = 2027;
const lastYear = Math.max(firstYear, new Date().getFullYear()) + 4;
for (let year = firstYear; year <= lastYear; year++) {
  for (const season of ['Winter', 'Spring', 'Fall']) {
    term.add(new Option(year + ' - ' + season));
  }
}
term.value = firstYear + ' - Winter';

let token;
let liveReady = false;
const status = get('status');
const connect = get('connect');
const connectionStatus = get('source-note');

async function request(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error);
  }
  return result;
}

function showSession(session) {
  token = session?.token;
  get('session').hidden = !token;
  if (session) {
    get('viewer').src = session.viewer;
  }
  else {
    get('viewer').removeAttribute('src');
  }
  connect.textContent = token ? 'Disconnect' : 'Connect';
}

request('config').then(config => {
  liveReady = config.liveReady;
  connect.disabled = !liveReady;
  connectionStatus.textContent = liveReady ? 'Sign in through Steel to search WaterlooWorks.' : 'Set up Steel to enable WaterlooWorks search.';
}).catch(() => {
  connectionStatus.textContent = 'Could not check live search availability.';
});

connect.addEventListener('click', async () => {
  connect.disabled = get('search').disabled = true;
  connectionStatus.textContent = token ? 'Closing Steel browser…' : 'Starting Steel browser…';
  try {
    if (token) {
      await request('disconnect', { token });
      showSession();
      connectionStatus.textContent = 'Steel browser closed.';
    } else {
      showSession(await request('connect', {}));
      connectionStatus.textContent = 'Steel browser ready.';
      get('session-title').focus();
    }
  } catch (error) {
    connectionStatus.textContent = error.message;
  } finally {
    connect.disabled = !liveReady;
    get('search').disabled = false;
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

const saveSearch = get('save-search');
const savedSearches = get('saved-searches');
const savedSearchKey = 'watjobs.savedSearches.v1';
let currentSearch;
let history = [];
try {
  const stored = JSON.parse(localStorage.getItem(savedSearchKey) || '[]');
  if (Array.isArray(stored)) {
    history = stored;
  }
} catch {
  // Searching still works when browser storage is unavailable.
}

function updateSavedSearches() {
  savedSearches.replaceChildren(new Option('Choose a saved search', ''));
  for (const search of history) {
    savedSearches.add(new Option(search.label, search.id));
  }
}

updateSavedSearches();

saveSearch.addEventListener('click', () => {
  if (!currentSearch || history.some(search => search.id === currentSearch.id)) {
    return;
  }
  try {
    const nextHistory = [currentSearch, ...history];
    localStorage.setItem(savedSearchKey, JSON.stringify(nextHistory));
    history = nextHistory;
    updateSavedSearches();
    savedSearches.value = currentSearch.id;
    saveSearch.disabled = true;
    status.textContent = 'Search saved in this browser.';
  } catch {
    status.textContent = 'Could not save this search. Browser storage may be full or unavailable.';
  }
});

savedSearches.addEventListener('change', () => {
  const search = history.find(item => item.id === savedSearches.value);
  if (!search) {
    return;
  }
  currentSearch = search;
  saveSearch.disabled = true;
  renderJobs(search.jobs);
  const summary = search.summary.split(' · ')[0];
  status.textContent = 'Saved search from ' + new Date(search.savedAt).toLocaleString() + ' · ' + summary;
});

function renderJobs(jobs) {
  const results = get('results');
  results.replaceChildren();
  if (!jobs.length) {
    const empty = element('div', '', 'empty');
    empty.append(element('strong', 'No matching postings'), element('p', 'Try a different work term or duration, or broaden your optional filters.'));
    results.append(empty);
  }
  const visibleCount = 3;
  const remaining = jobs.length - visibleCount;
  const moreResults = element('details', '', 'more-results');
  if (remaining > 0) {
    const toggle = element('summary');
    const label = remaining + (remaining === 1 ? ' more job' : ' more jobs');
    toggle.textContent = 'Show ' + label;
    moreResults.addEventListener('toggle', () => {
      toggle.textContent = moreResults.open ? 'Hide additional jobs' : 'Show ' + label;
    });
    moreResults.append(toggle);
  }
  for (const [index, job] of jobs.entries()) {
    const card = element('details', '', 'job');
    const summary = element('summary', '', 'job-summary');
    summary.append(element('strong', job.title, 'job-title'));
    const facts = element('span', '', 'job-facts');
    for (const [label, value] of [
      ['Organization', job.company],
      ['City', job.location],
      ['Level', job.level],
      ['Application Deadline', job.applicationDeadline],
    ]) {
      const fact = element('span', '', 'job-fact');
      fact.append(element('strong', label), element('span', value || 'Not listed'));
      facts.append(fact);
    }
    summary.append(facts);
    const source = [job.board === 'full' ? 'Full-Cycle Service' : job.board === 'direct' ? 'Employer-Student Direct' : '', job.jobId && 'WaterlooWorks Job ID ' + job.jobId].filter(Boolean);
    if (source.length) {
      summary.append(element('span', source.join(' · '), 'meta'));
    }
    if (job.duration && job.tableOnly) {
      summary.append(element('span', 'Posting details unverified', 'meta'));
    }
    card.append(summary);
    const details = element('div', '', 'job-details');
    const meta = [job.term, job.duration, job.jobId && 'Job ID ' + job.jobId].filter(Boolean);
    if (meta.length) {
      details.append(element('p', meta.join(' · '), 'meta'));
    }
    if (job.description) {
      details.append(element('p', job.description, 'description'));
    }
    if (job.tableOnly) {
      details.append(element('p', 'Listed on WaterlooWorks. Full description, skills, and application link were not verified.', 'description'));
    }
    if (job.matched.length) {
      const tags = element('div', '', 'tags');
      for (const keyword of job.matched) {
        tags.append(element('span', keyword, 'tag'));
      }
      details.append(tags);
    }
    const application = element('section', '', 'application-details');
    application.append(element('h3', 'Application details'));
    const applicationFields = [
      { label: 'Application Deadline', value: job.applicationDeadline },
      ...(job.applicationDetails ?? []),
    ];
    for (const { label, value } of applicationFields) {
      if (!value) {
        continue;
      }
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
    const target = index < visibleCount ? results : moreResults;
    target.append(card);
  }
  if (remaining > 0) {
    results.append(moreResults);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!token) {
    status.textContent = 'Connect to a Steel browser and sign in to WaterlooWorks first.';
    return;
  }
  connect.disabled = get('search').disabled = true;
  saveSearch.disabled = savedSearches.disabled = true;
  status.textContent = 'Searching WaterlooWorks…';
  try {
    const profile = Object.fromEntries(new FormData(form));
    const { jobs, keywordFallback } =
      await request('search', { profile, token, board: get('board').value });
    showSession();
    connectionStatus.textContent = 'Steel browser closed.';
    const mode = get('mode');
    if (mode) {
      mode.textContent = 'WaterlooWorks';
    }
    renderJobs(jobs);
    const summary = keywordFallback
      ? 'No keyword matches. Showing ' + jobs.length + (jobs.length === 1 ? ' candidate' : ' candidates') + ' based on available filters.'
      : jobs.length + (jobs.length === 1 ? ' result' : ' results');
    status.textContent = summary;
    const savedAt = new Date();
    currentSearch = {
      id: crypto.randomUUID(),
      savedAt: savedAt.toISOString(),
      label: [profile.roles || profile.term, savedAt.toLocaleString(), jobs.length + ' results'].join(' · '),
      summary: status.textContent,
      jobs,
    };
    savedSearches.value = '';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    savedSearches.disabled = false;
    saveSearch.disabled = !currentSearch?.jobs.length || history.some(search => search.id === currentSearch.id);
    connect.disabled = !liveReady;
    get('search').disabled = false;
  }
});
