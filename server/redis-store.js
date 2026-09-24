import { randomUUID } from 'node:crypto';
import { initialState } from './store.js';
import { sourceRequest } from './source.js';

// All writes verify ownership of the distributed lock. A function that times
// out cannot overwrite changes made by another instance after its lease ends.
export const SAVE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2]); return 1 else return 0 end`;
export const UNLOCK_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export function redisEnvironment(env) {
  return {
    url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
    token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
    prefix: env.REDIS_PREFIX || `ras-radar:${env.VERCEL_ENV || 'production'}`,
  };
}

export function createRedisCommand({ url, token }, requester = sourceRequest) {
  if (!url.startsWith('https://')) throw new Error('O endereço REST do armazenamento precisa usar HTTPS.');
  return async (...command) => {
    const response = await requester(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Não foi possível acessar o armazenamento. Confira as variáveis do Redis na Vercel.');
    const data = await response.json();
    if (data.error) throw new Error('O armazenamento recusou a operação. Confira a conexão e os limites do Redis.');
    return data.result;
  };
}

export class RedisRepository {
  constructor(command, prefix) { this.command = command; this.prefix = prefix; }
  async read() {
    const value = await this.command('GET', `${this.prefix}:state`);
    return { ...initialState(), ...(value ? JSON.parse(value) : {}) };
  }
  async locked(callback) {
    const owner = randomUUID();
    const lock = `${this.prefix}:lock`;
    if (await this.command('SET', lock, owner, 'NX', 'PX', 90_000) !== 'OK') return { busy: true };
    try {
      const state = await this.read();
      const store = { state, save: async () => {
        const result = await this.command('EVAL', SAVE_SCRIPT, 2, lock, `${this.prefix}:state`, owner, JSON.stringify(state));
        if (result !== 1) throw new Error('A consulta excedeu seu tempo de execução. Tente novamente.');
      } };
      return { busy: false, result: await callback(store) };
    } finally { await this.command('EVAL', UNLOCK_SCRIPT, 1, lock, owner); }
  }
  async loginAllowed() {
    const key = `${this.prefix}:login-attempts`;
    // INCR and TTL are atomic; expired functions cannot leave a permanent lockout.
    const count = await this.command('EVAL', "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 900) end; return count", 1, key);
    return count <= 10;
  }
  async resetLoginAttempts() { await this.command('DEL', `${this.prefix}:login-attempts`); }
}
