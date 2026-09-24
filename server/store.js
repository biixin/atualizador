import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './domain.js';

export function initialState() {
  return { settings: { ...DEFAULT_SETTINGS }, snapshot: null, events: [], subscriptions: [], outbox: [], lastCheck: null, lastChange: null, checks: 0, error: null };
}

export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'state.json');
    this.state = initialState();
    if (fs.existsSync(this.file)) this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
  }
  save() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
