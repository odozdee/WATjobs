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
