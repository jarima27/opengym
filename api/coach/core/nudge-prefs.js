/**
 * Which engagement nudges a person wants (S.nudges), over the defaults — the part of
 * nudges.js that Settings needs. Its own module so the web app can read and write the choices
 * without downloading the planner and its copy in every language, which only the phone needs.
 */
export const NUDGE_KINDS = ['today', 'comeback', 'weekly', 'trial'];
export const NUDGE_DEFAULTS = { today: true, todayTime: '20:00', comeback: true, weekly: true, trial: true };
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The person's choices over the defaults; anything malformed falls back to the default. */
export function nudgePrefs(S) {
  const p = S?.nudges && typeof S.nudges === 'object' && !Array.isArray(S.nudges) ? S.nudges : {};
  const out = { ...NUDGE_DEFAULTS };
  for (const k of NUDGE_KINDS) if (typeof p[k] === 'boolean') out[k] = p[k];
  if (HHMM.test(p.todayTime || '')) out.todayTime = p.todayTime;
  return out;
}
