import { Redis } from 'ioredis';

// Create a mock Redis implementation for testing environments
class MockRedis {
  private data: Map<string, any> = new Map();

  private expires = new Map<string, number>();

  async get(key: string) {
    if ((this.expires.get(key) ?? Infinity) <= Date.now()) await this.del(key);
    return this.data.get(key);
  }

  async set(key: string, value: any, mode?: string, ttl?: number) {
    this.expires.delete(key);
    if (mode === 'EX' && ttl !== undefined)
      this.expires.set(key, Date.now() + ttl * 1000);
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    this.expires.delete(key);
    return this.data.delete(key) ? 1 : 0;
  }

  async rpush(key: string, value: any) {
    this.data.set(key, [...(this.data.get(key) || []), value]);
    return this.data.get(key).length;
  }

  async lrange(key: string, start: number, end: number) {
    const list = this.data.get(key) || [];
    return list.slice(start, end === -1 ? undefined : end + 1);
  }

  async expire() {
    return 1;
  }

  // Add other Redis methods as needed for your tests
}

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
export const ioRedis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
    })
  : (new MockRedis() as unknown as Redis); // Type cast to Redis to maintain interface compatibility
