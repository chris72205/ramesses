import { createRouter } from 'sv-router';
import Dashboard from '../components/Dashboard.svelte';
import NotFound from '../components/NotFound.svelte';

/**
 * Path-style routes. Vite serves index.html for every path in development; in production the
 * backend's static handler does the same for anything outside /api and /ws. The project pages
 * load lazily, which also keeps them from importing this module in a cycle.
 */
// eslint-disable-next-line @typescript-eslint/unbound-method -- sv-router's functions are closures that never read `this`
export const { p, navigate, isActive, route } = createRouter({
  '/': Dashboard,
  '/projects': () => import('../components/ProjectsPage.svelte'),
  '/projects/:name': () => import('../components/ProjectDetailPage.svelte'),
  '/settings': () => import('../components/SettingsPage.svelte'),
  '*': NotFound,
});
