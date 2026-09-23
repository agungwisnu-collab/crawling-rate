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
 * Memanggil BebasKirim Partner API untuk kalkulasi tarif pengiriman.
 */
async function postBebasKirimRates(kelId, { retryCount = 0 } = {}) {
  const url = `${CONFIG.BEBASKIRIM.BASE_URL}/v1/rates`;
  await defaultRateLimiter.acquire();

  try {
    const headers = {
      'Authorization': CONFIG.BEBASKIRIM.API_KEY,
      'X-Tenant-Id': CONFIG.BEBASKIRIM.TENANT_ID,
      'Content-Type': 'application/json'
    };
    if (CONFIG.BEBASKIRIM.APP_ID) {
      headers['X-App-Id'] = CONFIG.BEBASKIRIM.APP_ID;
    }

    const body = JSON.stringify({
      origin_code: CONFIG.BEBASKIRIM.ORIGIN_CODE,
      destination_code: kelId,
      weight: CONFIG.BEBASKIRIM.WEIGHT,
      cod_only: false
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    // Handle 429 Too Many Requests dari BebasKirim Gateway
    if (response.status === 429) {
      if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES) {
        const retryAfterHeader = response.headers.get('retry-after');
        const backoffMs = retryAfterHeader
          ? (parseInt(retryAfterHeader, 10) * 1000 || 2000)
          : (CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount));

        console.warn(`[HTTP 429] Batas rate limit BebasKirim tercapai. Menunggu ${Math.ceil(backoffMs / 1000)}s sebelum retry (${retryCount + 1}/${CONFIG.RATE_LIMIT.MAX_RETRIES})...`);
        await defaultRateLimiter.sleep(backoffMs);
        return postBebasKirimRates(kelId, { retryCount: retryCount + 1 });
      }
      throw new Error(`BebasKirim Rate limit exceeded (HTTP 429) setelah ${CONFIG.RATE_LIMIT.MAX_RETRIES} kali retry.`);
    }

    // Handle 5xx Server Error
    if (response.status >= 500) {
      if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES) {
        const backoffMs = CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.warn(`[HTTP ${response.status}] Server error BebasKirim. Retry dalam ${backoffMs / 1000}s...`);
        await defaultRateLimiter.sleep(backoffMs);
        return postBebasKirimRates(kelId, { retryCount: retryCount + 1 });
      }
      throw new Error(`Server error HTTP ${response.status} saat memanggil BebasKirim Rates`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error saat memanggil BebasKirim Rates: ${await response.text()}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    if (retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES && (err.name === 'FetchError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('fetch failed'))) {
      const backoffMs = CONFIG.RATE_LIMIT.INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[Jaringan Error] ${err.message}. Mencoba lagi dalam ${backoffMs / 1000}s...`);
      await defaultRateLimiter.sleep(backoffMs);
      return postBebasKirimRates(kelId, { retryCount: retryCount + 1 });
    }
    throw err;
  }
}

/**
 * Mendapatkan daftar shipping rate untuk kode kelurahan tertentu.
 * Menggunakan BebasKirim Partner API jika kredensial tersedia, atau fallback ke Ethos.
 * @param {string} kelId - Contoh: '33.07.03.1008'
 */
export async function getShippingRates(kelId, retries = 2) {
  const isBebasKirim = CONFIG.PROVIDER === 'BEBASKIRIM' && !!CONFIG.BEBASKIRIM.API_KEY && !!CONFIG.BEBASKIRIM.TENANT_ID;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let resultRates = [];

    if (isBebasKirim) {
      const response = await postBebasKirimRates(kelId);
      if (response && response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
        resultRates = response.data;
      }
    } else {
      const response = await postRequest('list', {
        key: CONFIG.API_KEY,
        id: kelId,
        wh: CONFIG.WAREHOUSE_ID
      }, { useRateLimiter: true });

      if (response && response.code === 200 && Array.isArray(response.data) && response.data.length > 0) {
        resultRates = response.data;
      }
    }

    if (resultRates.length > 0) {
      return resultRates;
    }

    // Jika response kosong dari agregator kurir, coba lagi jika masih ada kuota retry
    if (attempt < retries) {
      await defaultRateLimiter.sleep(1500);
    }
  }

  // Jika setelah dicoba ulang memang tetap kosong dari server pusat
  return [];
}

