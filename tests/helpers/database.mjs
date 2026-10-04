import { DatabaseSync } from 'node:sqlite';
import { after } from 'node:test';

/** A D1-shaped adapter backed by real SQLite, including transactional batches. */
export function createDatabase(schema) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  after(() => sqlite.close());
  return {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return { meta: { changes: Number(statement.run(...values).changes) } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
