const split = value => [...new Set(value.split(/[,;\n]/).map(part => part.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
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
