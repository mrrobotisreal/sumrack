let counter = 0;

/**
 * Generate a unique row id for user tables: time-ordered (sorts by creation),
 * dependency-free, and works in both Hermes and Node (tests). Collision-safe
 * for a single-user, single-device app; content ids are never generated here
 * (those are authored stable ids from packs).
 */
export function newId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const seq = (counter++ % 1296).toString(36).padStart(2, '0');
  return `${time}-${rand}${seq}`;
}
