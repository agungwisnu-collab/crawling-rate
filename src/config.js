import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Auto-load .env.local jika ada di ROOT_DIR
import fs from 'fs';
const envLocalPath = path.join(ROOT_DIR, '.env.local');
if (fs.existsSync(envLocalPath)) {
  try {
    const envContent = fs.readFileSync(envLocalPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...val] = trimmed.split('=');
      if (key && val.length) {
        const k = key.trim();
        const v = val.join('=').trim();
        if (!process.env[k]) {
          process.env[k] = v;
        }
      }
    });
  } catch (e) {
    // Ignore error reading .env.local
  }
}

export const CONFIG = {
  // Mode Provider: 'BEBASKIRIM' (default jika ada kredensial) atau 'ETHOS'
  PROVIDER: process.env.CRAWLER_PROVIDER || (process.env.BEBASKIRIM_API_KEY ? 'BEBASKIRIM' : 'ETHOS'),

  // BebasKirim Partner API Configuration
  BEBASKIRIM: {
    BASE_URL: process.env.BEBASKIRIM_BASE_URL || 'https://open.bebaskirim.com/api/partner',
    API_KEY: process.env.BEBASKIRIM_API_KEY || '',
    TENANT_ID: process.env.BEBASKIRIM_TENANT_ID || '',
    APP_ID: process.env.BEBASKIRIM_APP_ID || '',
    ORIGIN_CODE: process.env.BEBASKIRIM_ORIGIN_CODE || '31.72.06.1002', // Default: Jakarta Utara (Kelapa Gading Barat)
    WEIGHT: parseInt(process.env.BEBASKIRIM_WEIGHT || '1000', 10), // 1000 gram (1 kg)
  },

  // Ethos Ratecard Legacy Configuration (Fallback)
  API_BASE: 'https://ratecard.ethos.co.id/ratecardv2',
  API_KEY: process.env.ETHOS_API_KEY || 'c4f6971bdd907dbe11f4beb83754cd6ec0790f151418acaa0cdfae259db65c88',
  WAREHOUSE_ID: 2, // Default ID Warehouse: 2 (Jakarta)
  
  // Rate Limit: Default dioptimasi untuk BebasKirim (280 req/min, jeda 220ms) atau Ethos (120 req/min)
  RATE_LIMIT: {
    MAX_REQUESTS_PER_MINUTE: parseInt(
      process.env.RATE_LIMIT || process.env.ETHOS_RATE_LIMIT || (process.env.BEBASKIRIM_API_KEY ? '280' : '120'),
      10
    ),
    MIN_INTERVAL_MS: parseInt(
      process.env.MIN_INTERVAL || process.env.ETHOS_MIN_INTERVAL || (process.env.BEBASKIRIM_API_KEY ? '220' : '500'),
      10
    ),
    MAX_RETRIES: 5,
    INITIAL_RETRY_DELAY_MS: 2000
  },

  PATHS: {
    ROOT: ROOT_DIR,
    DATA_RATES: path.join(ROOT_DIR, 'data', 'rates'),
    DATA_CHECKPOINTS: path.join(ROOT_DIR, 'data', 'checkpoints')
  },

  PROVINCES: [
    { code: '11', name: 'Aceh', slug: 'aceh' },
    { code: '51', name: 'Bali', slug: 'bali' },
    { code: '36', name: 'Banten', slug: 'banten' },
    { code: '17', name: 'Bengkulu', slug: 'bengkulu' },
    { code: '34', name: 'Daerah Istimewa Yogyakarta', slug: 'daerah-istimewa-yogyakarta' },
    { code: '31', name: 'DKI Jakarta', slug: 'dki-jakarta' },
    { code: '75', name: 'Gorontalo', slug: 'gorontalo' },
    { code: '15', name: 'Jambi', slug: 'jambi' },
    { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
    { code: '33', name: 'Jawa Tengah', slug: 'jawa-tengah' },
    { code: '35', name: 'Jawa Timur', slug: 'jawa-timur' },
    { code: '61', name: 'Kalimantan Barat', slug: 'kalimantan-barat' },
    { code: '63', name: 'Kalimantan Selatan', slug: 'kalimantan-selatan' },
    { code: '62', name: 'Kalimantan Tengah', slug: 'kalimantan-tengah' },
    { code: '64', name: 'Kalimantan Timur', slug: 'kalimantan-timur' },
    { code: '65', name: 'Kalimantan Utara', slug: 'kalimantan-utara' },
    { code: '19', name: 'Kepulauan Bangka Belitung', slug: 'kepulauan-bangka-belitung' },
    { code: '21', name: 'Kepulauan Riau', slug: 'kepulauan-riau' },
    { code: '18', name: 'Lampung', slug: 'lampung' },
    { code: '81', name: 'Maluku', slug: 'maluku' },
    { code: '82', name: 'Maluku Utara', slug: 'maluku-utara' },
    { code: '52', name: 'Nusa Tenggara Barat', slug: 'nusa-tenggara-barat' },
    { code: '53', name: 'Nusa Tenggara Timur', slug: 'nusa-tenggara-timur' },
    { code: '91', name: 'Papua', slug: 'papua' },
    { code: '92', name: 'Papua Barat', slug: 'papua-barat' },
    { code: '96', name: 'Papua Barat Daya', slug: 'papua-barat-daya' },
    { code: '95', name: 'Papua Pegunungan', slug: 'papua-pegunungan' },
    { code: '93', name: 'Papua Selatan', slug: 'papua-selatan' },
    { code: '94', name: 'Papua Tengah', slug: 'papua-tengah' },
    { code: '14', name: 'Riau', slug: 'riau' },
    { code: '76', name: 'Sulawesi Barat', slug: 'sulawesi-barat' },
    { code: '73', name: 'Sulawesi Selatan', slug: 'sulawesi-selatan' },
    { code: '72', name: 'Sulawesi Tengah', slug: 'sulawesi-tengah' },
    { code: '74', name: 'Sulawesi Tenggara', slug: 'sulawesi-tenggara' },
    { code: '71', name: 'Sulawesi Utara', slug: 'sulawesi-utara' },
    { code: '13', name: 'Sumatera Barat', slug: 'sumatera-barat' },
    { code: '16', name: 'Sumatera Selatan', slug: 'sumatera-selatan' },
    { code: '12', name: 'Sumatera Utara', slug: 'sumatera-utara' }
  ]
};
