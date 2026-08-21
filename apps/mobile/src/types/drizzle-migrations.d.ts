// drizzle-kit (driver: 'expo') emits drizzle/migrations.js with no types;
// it's consumed only by drizzle's useMigrations().
declare module '*drizzle/migrations' {
  const migrations: {
    journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
    migrations: Record<string, string>;
  };
  export default migrations;
}
