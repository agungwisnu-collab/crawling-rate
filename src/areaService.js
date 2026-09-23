import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { CONFIG } from './config.js';

const MASTER_CSV_PATH = path.join(CONFIG.PATHS.ROOT, 'master_origin.csv');

/**
 * Cek apakah file master_origin.csv tersedia di direktori proyek.
 */
export function isMasterCsvAvailable() {
  return fs.existsSync(MASTER_CSV_PATH);
}

/**
 * Membaca dan menyusun hierarki Kabupaten > Kecamatan > Kelurahan untuk kode provinsi tertentu dari CSV.
 * @param {string} provCode - Contoh: '36' (Banten), '51' (Bali)
 * @returns {Promise<Array|null>} Array kabupaten atau null jika file tidak ditemukan
 */
export async function getProvinceHierarchyFromCsv(provCode) {
  if (!isMasterCsvAvailable()) {
    return null;
  }

  const startTime = Date.now();
  const rl = readline.createInterface({
    input: fs.createReadStream(MASTER_CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });

  const targetCode = String(provCode).trim();
  const kabMap = new Map();
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1 || !line) continue;

    // Header: "region_id","Kode Region","Desa","Kode Desa","Kecamatan","Kode Kecamatan","Kota/Kabupaten","Kode Kota/Kabupaten","Provinsi","Kode Provinsi","Kode Pos"
    const parts = line.split(',');
    if (parts.length < 10) continue;

    const kodePos = parts[parts.length - 1].replace(/"/g, '').trim();
    const kodeProv = parts[parts.length - 2].replace(/"/g, '').trim();

    // Filter baris hanya untuk provinsi target
    if (kodeProv !== targetCode) continue;

    const kodeKab = parts[parts.length - 4].replace(/"/g, '').trim();
    const kabNama = parts[parts.length - 5].replace(/"/g, '').trim();
    const kodeKec = parts[parts.length - 6].replace(/"/g, '').trim();
    const kecNama = parts[parts.length - 7].replace(/"/g, '').trim();
    const kodeDesa = parts[parts.length - 8].replace(/"/g, '').trim();
    const desaNama = parts[parts.length - 9].replace(/"/g, '').trim();
    const regionId = parts[0].replace(/"/g, '').trim();

    if (!kabMap.has(kodeKab)) {
      kabMap.set(kodeKab, {
        id: kodeKab,
        text: kabNama,
        kecMap: new Map()
      });
    }

    const kabObj = kabMap.get(kodeKab);
    if (!kabObj.kecMap.has(kodeKec)) {
      kabObj.kecMap.set(kodeKec, {
        id: kodeKec,
        text: kecNama,
        kelurahan: []
      });
    }

    const kecObj = kabObj.kecMap.get(kodeKec);
    kecObj.kelurahan.push({
      id: kodeDesa,
      text: kodePos ? `${desaNama} [${kodePos}]` : desaNama,
      nama: desaNama,
      kode_pos: kodePos,
      region_id: regionId
    });
  }

  if (kabMap.size === 0) {
    return null;
  }

  // Format array yang kompatibel dengan alur crawler
  const result = Array.from(kabMap.values()).map(k => ({
    id: k.id,
    text: k.text,
    kecamatan: Array.from(k.kecMap.values())
  }));

  const duration = Date.now() - startTime;
  console.log(`[AreaService] Berhasil memuat ${result.length} kabupaten dari master_origin.csv (${duration}ms) ⚡`);

  return result;
}
