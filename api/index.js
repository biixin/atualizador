import { createVercelApp } from '../server/vercel-app.js';

// Vercel invokes this handler per request. It never starts a local HTTP server
// and never writes to the deployment filesystem.
export default createVercelApp();
