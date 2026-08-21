// Full Drizzle schema: content tables (rebuilt from packs) + user tables
// (precious). Import `* as schema` from here everywhere a drizzle instance
// is created so both drivers (expo-sqlite on device, better-sqlite3 in
// tests) share one shape.
export * from './content';
export * from './user';
