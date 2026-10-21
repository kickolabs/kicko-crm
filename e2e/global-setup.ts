import { execSync } from 'node:child_process';

// Each E2E run starts by removing agencies left by earlier runs (@example.test owners),
// so the local database and the admin console don't fill up with test workspaces.
export default function globalSetup() {
  if (process.env.E2E_BASE_URL) return; // testing someone else's server: leave its data alone
  execSync('npm run db:clean-test', { stdio: 'inherit' });
}
