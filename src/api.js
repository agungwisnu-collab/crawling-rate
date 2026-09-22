import { CONFIG } from './config.js';
import { defaultRateLimiter } from './rateLimiter.js';

/**
 * Melakukan HTTP POST form-urlencoded ke API Ethos Ratecard dengan retry backoff.
 */
async function postRequest(endpoint, params, { useRateLimiter = false, retryCount = 0 } = {}) {
  const url = `${CONFIG.API_BASE}/${endpoint}`;
  const body = new URLSearchParams(params).toString();

  if (useRateLimiter) {
    await defaultRateLimiter.acquire();
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body
    });

    // Handle 429 Too Many Requests
    if (response.status === 429) {
      if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES) {
        const backoffMs = CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.warn(`[HTTP 429] Terkena rate limit saat memanggil ${endpoint}. Backoff ${backoffMs / 1000}s (Retry ${retryCount + 1}/${CONFIG.RATE_LIMIT.MAX_RETRIES})...`);
        await defaultRateLimiter.sleep(backoffMs);
        return postRequest(endpoint, params, { useRateLimiter: true, retryCount: retryCount + 1 });
      }
      throw new Error(`Rate limit exceeded (HTTP 429) setelah ${CONFIG.RATE_LIMIT.MAX_RETRIES} kali retry.`);
    }

    // Handle 5xx Server Error
    if (response.status >= 500) {
      if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES) {
        const backoffMs = CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.warn(`[HTTP ${response.status}] Server error pada ${endpoint}. Retry dalam ${backoffMs / 1000}s...`);
        await defaultRateLimiter.sleep(backoffMs);
        return postRequest(endpoint, params, { useRateLimiter, retryCount: retryCount + 1 });
      }
      throw new Error(`Server error HTTP ${response.status} saat memanggil ${endpoint}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error saat memanggil ${endpoint}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES && (err.name === 'FetchError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('fetch failed'))) {
      const backoffMs = CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[Jaringan Error] ${err.message}. Mencoba lagi dalam ${backoffMs / 1000}s...`);
      await defaultRateLimiter.sleep(backoffMs);
      return postRequest(endpoint, params, { useRateLimiter, retryCount: retryCount + 1 });
    }
    throw err;
  }
}

/**
 * Mendapatkan daftar Kabupaten untuk kode provinsi tertentu.
 * @param {string} provCode - Contoh: '33'
 */
export async function getKabupaten(provCode) {
  const result = await postRequest('getKab', { src: provCode, term: '' });
  return Array.isArray(result) ? result : [];
}

/**
 * Mendapatkan daftar Kecamatan untuk kode kabupaten tertentu.
 * @param {string} kabId - Contoh: '33.07'
 */
export async function getKecamatan(kabId) {
  const result = await postRequest('getKec', { src: kabId, term: '' });
  return Array.isArray(result) ? result : [];
}

/**
 * Mendapatkan daftar Kelurahan untuk kode kecamatan tertentu.
 * @param {string} kecId - Contoh: '33.07.03'
 */
export async function getKelurahan(kecId) {
  const result = await postRequest('getKel', { src: kecId, term: '' });
  return Array.isArray(result) ? result : [];
}

/**
 * Mendapatkan daftar shipping rate untuk kode kelurahan tertentu.
 * Dibatasi oleh RateLimiter (maks 70 req/menit).
 * @param {string} kelId - Contoh: '33.07.03.1008'
 */
export async function getShippingRates(kelId, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await postRequest('list', {
      key: CONFIG.API_KEY,
      id: kelId,
      wh: CONFIG.WAREHOUSE_ID
    }, { useRateLimiter: true });

    if (response && response.code === 200 && Array.isArray(response.data) && response.data.length > 0) {
      return response.data;
    }

    // Jika response kosong atau server mengembalikan error sementara, coba lagi jika masih ada kuota retry
    if (attempt < retries) {
      await defaultRateLimiter.sleep(1500);
    }
  }

  // Jika setelah dicoba ulang memang tetap kosong dari server pusat
  return [];
}
