import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { getKabupaten, getKecamatan, getKelurahan, getShippingRates } from './api.js';
import { defaultRateLimiter } from './rateLimiter.js';

/**
 * Memastikan direktori target tersedia.
 */
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Mendapatkan path file checkpoint untuk provinsi tertentu.
 */
function getCheckpointPath(provCode) {
  return path.join(CONFIG.PATHS.DATA_CHECKPOINTS, `checkpoint-${provCode}.json`);
}

/**
 * Mendapatkan path file hasil akhir untuk provinsi tertentu.
 */
function getFinalOutputPath(province) {
  return path.join(CONFIG.PATHS.DATA_RATES, `${province.code}-${province.slug}.json`);
}

/**
 * Membaca data checkpoint jika ada.
 */
function loadCheckpoint(provCode) {
  const filePath = getCheckpointPath(provCode);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.warn(`[Checkpoint] Gagal membaca checkpoint lama, membuat baru: ${e.message}`);
    }
  }
  return null;
}

/**
 * Menyimpan checkpoint per kecamatan secara aman (atomic write).
 */
function saveCheckpoint(provCode, checkpointData) {
  ensureDirExists(CONFIG.PATHS.DATA_CHECKPOINTS);
  const filePath = getCheckpointPath(provCode);
  const tempPath = `${filePath}.tmp`;

  checkpointData.lastUpdated = new Date().toISOString();
  // Format compact untuk menghemat I/O disk dan kecepatan simpan
  fs.writeFileSync(tempPath, JSON.stringify(checkpointData), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Menghapus file checkpoint setelah proses provinsi selesai tuntas.
 */
function removeCheckpoint(provCode) {
  const filePath = getCheckpointPath(provCode);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn(`[Checkpoint] Gagal menghapus file checkpoint: ${e.message}`);
    }
  }
}

/**
 * Melakukan crawling untuk satu provinsi.
 * @param {object} province - Objek provinsi { code, name, slug }
 * @param {object} options - Opsi crawling (e.g. { maxKab, maxKec })
 */
export async function crawlProvince(province, options = {}) {
  ensureDirExists(CONFIG.PATHS.DATA_RATES);
  ensureDirExists(CONFIG.PATHS.DATA_CHECKPOINTS);

  const finalOutputFile = getFinalOutputPath(province);

  // Jika file hasil akhir sudah ada dan tidak dipaksa re-crawl, lewati
  if (fs.existsSync(finalOutputFile) && !options.force) {
    console.log(`[Skip] Provinsi ${province.name} (${province.code}) sudah selesai sebelumnya di ${finalOutputFile}`);
    return { status: 'already_completed', file: finalOutputFile };
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🚀 Memulai Crawl Provinsi: ${province.name} (Kode: ${province.code})`);
  console.log(`${'='.repeat(70)}`);

  // Inisialisasi atau muat checkpoint
  let checkpoint = loadCheckpoint(province.code);
  if (!checkpoint) {
    checkpoint = {
      provCode: province.code,
      provName: province.name,
      completedKecamatanIds: [],
      kabupatenData: {}
    };
  } else {
    console.log(`[Resume] Melanjutkan dari checkpoint: ${checkpoint.completedKecamatanIds.length} kecamatan sudah selesai.`);
  }

  // 1. Ambil daftar Kabupaten
  console.log(`[1/4] Mengambil daftar kabupaten di ${province.name}...`);
  const fullKabList = await getKabupaten(province.code);
  if (!fullKabList || fullKabList.length === 0) {
    console.error(`[Error] Tidak ada data kabupaten untuk provinsi ${province.name}`);
    return { status: 'error', message: 'No kabupaten found' };
  }

  let kabList = fullKabList;
  if (options.maxKab) {
    kabList = kabList.slice(0, options.maxKab);
  }

  const isPartial = Boolean((options.maxKab && options.maxKab < fullKabList.length) || options.maxKec);
  console.log(`Ditemukan ${fullKabList.length} kabupaten/kota (Target proses: ${kabList.length} kabupaten).`);

  let totalKelurahanCrawled = 0;

  // 2. Iterasi Kabupaten
  for (let kabIdx = 0; kabIdx < kabList.length; kabIdx++) {
    const kab = kabList[kabIdx];
    console.log(`\n📌 [Kabupaten ${kabIdx + 1}/${kabList.length}] ${kab.text} (ID: ${kab.id})`);

    if (!checkpoint.kabupatenData[kab.id]) {
      checkpoint.kabupatenData[kab.id] = {
        id: kab.id,
        nama: kab.text,
        kecamatan: {}
      };
    }

    // Ambil daftar Kecamatan
    let kecList = await getKecamatan(kab.id);
    if (options.maxKec) {
      kecList = kecList.slice(0, options.maxKec);
    }

    console.log(`   Ditemukan ${kecList.length} kecamatan di ${kab.text}.`);

    // 3. Iterasi Kecamatan
    for (let kecIdx = 0; kecIdx < kecList.length; kecIdx++) {
      const kec = kecList[kecIdx];

      // Cek apakah kecamatan sudah selesai di checkpoint
      if (checkpoint.completedKecamatanIds.includes(kec.id)) {
        console.log(`   ⏩ [Kecamatan ${kecIdx + 1}/${kecList.length}] ${kec.text} (ID: ${kec.id}) - SELESAI (dari checkpoint)`);
        continue;
      }

      console.log(`   ⏳ [Kecamatan ${kecIdx + 1}/${kecList.length}] ${kec.text} (ID: ${kec.id})...`);

      // Ambil daftar Kelurahan
      const kelList = await getKelurahan(kec.id);
      const kelurahanResults = [];

      for (let kelIdx = 0; kelIdx < kelList.length; kelIdx++) {
        const kel = kelList[kelIdx];
        const rates = await getShippingRates(kel.id);
        const stats = defaultRateLimiter.getStats();

        kelurahanResults.push({
          id: kel.id,
          nama: kel.text,
          rates: rates
        });

        totalKelurahanCrawled++;
        process.stdout.write(`\r      -> Kelurahan [${kelIdx + 1}/${kelList.length}] ${kel.text.slice(0, 30)} | Rates: ${rates.length} | 1m Req: ${stats.requestsInLastMinute}/${CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE}`);
      }
      process.stdout.write('\n');

      // Simpan data kecamatan ke checkpoint
      checkpoint.kabupatenData[kab.id].kecamatan[kec.id] = {
        id: kec.id,
        nama: kec.text,
        kelurahan: kelurahanResults
      };
      checkpoint.completedKecamatanIds.push(kec.id);

      // Simpan checkpoint ke disk per kecamatan
      saveCheckpoint(province.code, checkpoint);
      console.log(`      💾 Checkpoint disimpan (${checkpoint.completedKecamatanIds.length} kecamatan selesai).`);
    }
  }

  // Jika crawl dibatasi secara parsial (misal untuk testing / target bertahap)
  if (isPartial) {
    console.log(`\n⏸️ [Target Parsial Selesai] Selesai memproses hingga batasan yang diminta (${kabList.length}/${fullKabList.length} Kabupaten).`);
    console.log(`💾 Checkpoint tetap dipertahankan di ${getCheckpointPath(province.code)} (${checkpoint.completedKecamatanIds.length} kecamatan selesai).`);
    return {
      status: 'partial_completed',
      stats: {
        completedKabupaten: kabList.length,
        completedKecamatan: checkpoint.completedKecamatanIds.length
      }
    };
  }

  // 4. Susun struktur final JSON (Hanya jika seluruh kabupaten telah selesai)
  console.log(`\n[4/4] Menyusun file JSON hasil akhir untuk ${province.name}...`);
  const finalKabupatenList = Object.values(checkpoint.kabupatenData).map(k => ({
    id: k.id,
    nama: k.nama,
    kecamatan: Object.values(k.kecamatan)
  }));

  let totalKec = 0;
  let totalKel = 0;
  for (const k of finalKabupatenList) {
    totalKec += k.kecamatan.length;
    for (const kc of k.kecamatan) {
      totalKel += kc.kelurahan.length;
    }
  }

  const finalOutput = {
    provinsi_kode: province.code,
    provinsi_nama: province.name,
    warehouse_id: CONFIG.WAREHOUSE_ID,
    last_updated: new Date().toISOString(),
    total_kabupaten: finalKabupatenList.length,
    total_kecamatan: totalKec,
    total_kelurahan: totalKel,
    kabupaten: finalKabupatenList
  };

  fs.writeFileSync(finalOutputFile, JSON.stringify(finalOutput, null, 2), 'utf-8');
  console.log(`✅ File berhasil disimpan: ${finalOutputFile}`);
  console.log(`📊 Statistik: ${finalKabupatenList.length} Kabupaten, ${totalKec} Kecamatan, ${totalKel} Kelurahan.`);

  // Bersihkan checkpoint karena sudah sukses tuntas
  removeCheckpoint(province.code);

  return {
    status: 'completed',
    file: finalOutputFile,
    stats: {
      kabupaten: finalKabupatenList.length,
      kecamatan: totalKec,
      kelurahan: totalKel
    }
  };
}

/**
 * Mendapatkan status progres detail sebuah provinsi (baik dari file final maupun checkpoint).
 */
export function getProvinceProgress(province) {
  ensureDirExists(CONFIG.PATHS.DATA_RATES);
  ensureDirExists(CONFIG.PATHS.DATA_CHECKPOINTS);

  const finalFile = getFinalOutputPath(province);
  if (fs.existsSync(finalFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(finalFile, 'utf-8'));
      const kabList = (data.kabupaten || []).map(k => ({
        id: k.id,
        nama: k.nama,
        kecamatanCount: (k.kecamatan || []).length,
        kelurahanCount: (k.kecamatan || []).reduce((acc, kc) => acc + (kc.kelurahan || []).length, 0)
      }));

      return {
        status: 'DONE',
        kabupatenCount: data.total_kabupaten || kabList.length,
        kecamatanCount: data.total_kecamatan || 0,
        kelurahanCount: data.total_kelurahan || 0,
        kabupatenList: kabList,
        lastUpdated: data.last_updated
      };
    } catch (e) {
      console.warn(`[getProvinceProgress] Gagal membaca final file: ${e.message}`);
    }
  }

  const cpFile = getCheckpointPath(province.code);
  if (fs.existsSync(cpFile)) {
    try {
      const cp = JSON.parse(fs.readFileSync(cpFile, 'utf-8'));
      const kabKeys = Object.keys(cp.kabupatenData || {});
      const kabList = kabKeys.map(kId => {
        const kab = cp.kabupatenData[kId];
        const kecKeys = Object.keys(kab.kecamatan || {});
        let kelCount = 0;
        for (const kecId of kecKeys) {
          kelCount += (kab.kecamatan[kecId].kelurahan || []).length;
        }
        return {
          id: kab.id,
          nama: kab.nama,
          kecamatanCount: kecKeys.length,
          kelurahanCount: kelCount
        };
      });

      let totalKel = 0;
      for (const k of kabList) {
        totalKel += k.kelurahanCount;
      }

      return {
        status: 'IN_PROGRESS',
        kabupatenCount: kabList.length,
        kecamatanCount: (cp.completedKecamatanIds || []).length,
        kelurahanCount: totalKel,
        kabupatenList: kabList,
        lastUpdated: cp.lastUpdated
      };
    } catch (e) {
      console.warn(`[getProvinceProgress] Gagal membaca checkpoint: ${e.message}`);
    }
  }

  return {
    status: 'NOT_STARTED',
    kabupatenCount: 0,
    kecamatanCount: 0,
    kelurahanCount: 0,
    kabupatenList: []
  };
}

/**
 * Mendapatkan daftar provinsi yang belum selesai di-crawl.
 */
export function getIncompleteProvinces() {
  ensureDirExists(CONFIG.PATHS.DATA_RATES);
  return CONFIG.PROVINCES.filter(prov => {
    const finalFile = getFinalOutputPath(prov);
    return !fs.existsSync(finalFile);
  });
}


