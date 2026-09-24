import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVercelApp } from './vercel-app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = createVercelApp();
const app = express();
app.use((req, res, next) => req.url.startsWith('/api') ? api(req, res, next) : next());
app.use(express.static(path.join(root, 'dist')));
const server = app.listen(Number(process.env.PREVIEW_PORT || 3002), '127.0.0.1', () => console.log(`Prévia da API Vercel: http://127.0.0.1:${server.address().port}`));
