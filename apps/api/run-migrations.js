require('reflect-metadata');
const { AppDataSource } = require('./dist/src/database/data-source.js');

console.log('Initializing DataSource...');
AppDataSource.initialize()
  .then(async () => {
    console.log('DataSource initialized. Running migrations...');
    const runMigrations = await AppDataSource.runMigrations();
    console.log('Migrations run successfully:', runMigrations.map(m => m.name));
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error during migration execution:', err);
    process.exit(1);
  });
