const replace = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end " +
  "redis.call('SET', KEYS[1], ARGV[2]); return 1";

export function redisStore(env = process.env, request = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('The review store is not configured.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:') throw new Error('The review store requires HTTPS.');

  async function command(args) {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('The review store is unavailable.');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('The review store is unavailable.');
    return data.result;
  }
  const key = id => 'remittance-review:v1:' + id;
  return {
    async read(id) {
      const state = await command(['GET', key(id)]);
      return state === null ? null : { state };
    },
    async insert(id, state) {
      if (await command(['SET', key(id), state, 'NX']) !== 'OK') throw new Error('Could not create a review.');
    },
    async replace(id, before, after) {
      return await command(['EVAL', replace, 1, key(id), before, after]) === 1;
    },
    async check() {
      return await command(['PING']) === 'PONG';
    },
  };
}
