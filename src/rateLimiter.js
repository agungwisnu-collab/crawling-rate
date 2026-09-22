import { CONFIG } from './config.js';

export class RateLimiter {
  constructor(maxPerMinute = CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE, minIntervalMs = CONFIG.RATE_LIMIT.MIN_INTERVAL_MS) {
    this.maxPerMinute = maxPerMinute;
    this.minIntervalMs = minIntervalMs;
    this.timestamps = [];
    this.lastRequestTime = 0;
    this.totalRequests = 0;
  }

  updateConfig(maxPerMinute, minIntervalMs) {
    if (maxPerMinute) this.maxPerMinute = maxPerMinute;
    if (minIntervalMs) this.minIntervalMs = minIntervalMs;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Menunggu hingga aman untuk melakukan request berikutnya sesuai batas rate limit.
   */
  async acquire() {
    while (true) {
      const now = Date.now();

      // 1. Bersihkan timestamps yang lebih dari 60 detik lalu
      this.timestamps = this.timestamps.filter(t => now - t < 60000);

      // 2. Cek apakah batas 70 req/menit tercapai
      if (this.timestamps.length >= this.maxPerMinute) {
        const oldest = this.timestamps[0];
        const waitTime = 60000 - (now - oldest) + 50; // Buffer 50ms
        if (waitTime > 0) {
          console.log(`[RateLimiter] Kuota 1 menit penuh (${this.timestamps.length}/${this.maxPerMinute}). Menunggu ${Math.ceil(waitTime / 1000)} detik...`);
          await this.sleep(waitTime);
          continue;
        }
      }

      // 3. Jaga jeda minimum antar request (anti-burst)
      const elapsedSinceLast = now - this.lastRequestTime;
      if (elapsedSinceLast < this.minIntervalMs) {
        const spacingWait = this.minIntervalMs - elapsedSinceLast;
        await this.sleep(spacingWait);
      }

      // Aman untuk eksekusi
      const execTime = Date.now();
      this.timestamps.push(execTime);
      this.lastRequestTime = execTime;
      this.totalRequests++;
      return;
    }
  }

  getStats() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < 60000);
    return {
      requestsInLastMinute: this.timestamps.length,
      totalRequests: this.totalRequests
    };
  }
}

// Singleton limiter instance untuk pemanggilan rate API
export const defaultRateLimiter = new RateLimiter();
