// Every migration must be exported here; data-source.ts registers Object.values of this module.
// migrations.spec.ts fails if a file in this directory is missing from the list.
export * from './1794017625000-CreateWarriors';
export * from './1794200000000-CreateProjects';
