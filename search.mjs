const split = value => [...new Set(value.split(/[,;\n]/).map(part => part.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
const normalize = text => text.toLowerCase().replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeRole = text => normalize(text)
  .replace(/\b(?:engineers|engineering)\b/g, 'engineer')
  .replace(/\b(developer|system|intern)s\b/g, '$1');

export function profileFrom(input = {}) {
  const profile = {};
  for (const field of ['term', 'duration']) {
    const value = input?.[field];
    if (typeof value !== 'string' || !value.trim() || value.length > 450) {
      throw new Error('Enter a work term and duration (450 characters per field maximum).');
    }
    profile[field] = value.trim();
  }
  for (const field of ['program', 'roles', 'skills', 'location', 'level']) {
    const value = input?.[field] ?? '';
    if (typeof value !== 'string' || value.length > 450) {
      throw new Error('Enter no more than 450 characters per optional field.');
    }
    profile[field] = value.trim();
  }
  profile.roles = split(profile.roles);
  profile.skills = split(profile.skills);
  return profile;
}

function includes(haystack, needle) {
  const escaped = normalize(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\p{L}\\p{N}+#])' + escaped + '(?=$|[^\\p{L}\\p{N}+#])', 'u').test(haystack);
}

export function matchesLocationAndLevel(job, profile) {
  return (!profile.location || includes(normalize(job.location || ''), profile.location)) &&
    (!profile.level || includes(normalize(job.level || ''), profile.level));
}

export function filterJobs(jobs, profile) {
  return jobs.filter(job => {
    if (job.term?.replace(/\s*-\s*/, ' - ').toLowerCase() !== profile.term.toLowerCase()) {
      return false;
    }
    const months = [...(job.duration || '').matchAll(/\b(4|8|12|16)\b/g)]
      .map(match => match[0] + ' months');
    if (months.length && !months.includes(profile.duration)) {
      return false;
    }
    return matchesLocationAndLevel(job, profile);
  });
}

export function rank(jobs, profile, live, { includeUnmatched = false } = {}) {
  const keywords = [profile.program, ...profile.roles, ...profile.skills].filter(term => normalize(term));
  const terms = [...new Map(keywords.map(term => [normalize(term), term])).values()];
  return jobs.flatMap(job => {
    if (!matchesLocationAndLevel(job, profile)) {
      return [];
    }
    const text = normalize(job.title + ' ' + (job.description || ''));
    const roleText = normalizeRole(text);
    const matched = terms.filter(term =>
      [term, ...(profile.aliases?.get(term) || [])].some(alias => includes(text, alias)) ||
      (profile.roles.includes(term) && includes(roleText, normalizeRole(term))));
    if (job.term && job.term !== profile.term || job.duration && job.duration !== profile.duration || (!includeUnmatched && terms.length && !matched.length)) {
      return [];
    }
    return [{ ...job, matched, total: terms.length, live }];
  }).sort((a, b) => b.matched.length - a.matched.length || a.title.localeCompare(b.title));
}

export function summarizePosting(description) {
  const lines = description.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const shorten = (text, limit) => text.length <= limit ? text
    : text.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
  const headings = [
    ['Role', /^(?:Job Summary|Job Description|Position Summary)(?:\s*:\s*|$)/i],
    ['Responsibilities', /^(?:Job Responsibilities|Responsibilities|Duties|What You.ll Do)(?:\s*:\s*|$)/i],
    ['Qualifications', /^(?:Required Skills|Required Qualifications|Qualifications|Requirements|What You.ll Bring)(?:\s*:\s*|$)/i],
  ];
  const sections = [];
  for (const [label, heading] of headings) {
    const index = lines.findIndex(line => heading.test(line));
    if (index < 0) {
      continue;
    }
    const inline = lines[index].replace(heading, '').trim();
    const excerpts = inline ? [inline] : [];
    for (const line of lines.slice(index + 1, index + 3)) {
      if (headings.some(([, pattern]) => pattern.test(line)) ||
          /^(?:application information|job posting information|targeted clusters)$/i.test(line) ||
          /^[^:]{1,45}:$/.test(line) || excerpts.length === 2) {
        break;
      }
      excerpts.push(line);
    }
    if (excerpts.length) {
      sections.push(label + ' — ' + shorten(excerpts.join(' '), 240));
    }
  }
  if (sections.length) return sections.join('\n\n');
  return shorten(lines.filter(line => line.length >= 45 && !/^https?:/i.test(line)).slice(0, 3).join('\n\n'), 540);
}
