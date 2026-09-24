import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { getKabupaten, getKecamatan, getKelurahan, getShippingRates } from './api.js';
import { defaultRateLimiter } from './rateLimiter.js';
import { getProvinceHierarchyFromCsv } from './areaService.js';

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

  // 1. Ambil daftar Kabupaten (Prioritas 1: master_origin.csv offline jika ada, Prioritas 2: API)
  console.log(`[1/4] Mengambil struktur wilayah di ${province.name}...`);
  const csvHierarchy = await getProvinceHierarchyFromCsv(province.code);
  const usingCsv = Boolean(csvHierarchy && csvHierarchy.length > 0);

  const fullKabList = usingCsv ? csvHierarchy : await getKabupaten(province.code);
  if (!fullKabList || fullKabList.length === 0) {
    console.error(`[Error] Tidak ada data kabupaten untuk provinsi ${province.name}`);
    return { status: 'error', message: 'No kabupaten found' };
  }

  let kabList = fullKabList;
  if (options.maxKab) {
    kabList = kabList.slice(0, options.maxKab);
  }

  const isPartial = Boolean((options.maxKab && options.maxKab < fullKabList.length) || options.maxKec);
  console.log(`Ditemukan ${fullKabList.length} kabupaten/kota (Target proses: ${kabList.length} kabupaten) [Sumber: ${usingCsv ? 'master_origin.csv (Offline) ⚡' : 'Area API (Online)'}].`);

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

    // Ambil daftar Kecamatan (Offline dari CSV atau online via API)
    let kecList = usingCsv ? kab.kecamatan : await getKecamatan(kab.id);
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

      // Ambil daftar Kelurahan (Offline dari CSV atau online via API)
      const kelList = usingCsv ? kec.kelurahan : await getKelurahan(kec.id);
      const kelurahanResults = [];

      for (let kelIdx = 0; kelIdx < kelList.length; kelIdx++) {
        const kel = kelList[kelIdx];
        const rates = await getShippingRates(kel.id);
        const stats = defaultRateLimiter.getStats();

        kelurahanResults.push({
          id: kel.id,
          nama: kel.text,
          rates: rates,
          ...(kel.kode_pos ? { kode_pos: kel.kode_pos } : {}),
          ...(kel.region_id ? { region_id: kel.region_id } : {})
        });

        totalKelurahanCrawled++;
        process.stdout.write(`\r      -> Kelurahan [${kelIdx + 1}/${kelList.length}] ${kel.text.slice(0, 30)} | Rates: ${rates.length} | 1m Req: ${stats.requestsInLastMinute}/${defaultRateLimiter.maxPerMinute}`);
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

  fs.writeFileSync(finalOutputFile, JSON.stringify(finalOutput), 'utf-8');
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

/**
 * Memeriksa dan menambal (auto-heal) kelurahan yang datanya kosong atau terlewat.
 */
export async function healProvince(province, options = {}) {
  ensureDirExists(CONFIG.PATHS.DATA_RATES);
  ensureDirExists(CONFIG.PATHS.DATA_CHECKPOINTS);

  const finalFile = getFinalOutputPath(province);
  const cpFile = getCheckpointPath(province.code);

  let targetFile = null;
  let isCheckpoint = false;
  let data = null;

  if (fs.existsSync(finalFile)) {
    targetFile = finalFile;
    isCheckpoint = false;
    data = JSON.parse(fs.readFileSync(finalFile, 'utf-8'));
  } else if (fs.existsSync(cpFile)) {
    targetFile = cpFile;
    isCheckpoint = true;
    data = JSON.parse(fs.readFileSync(cpFile, 'utf-8'));
  } else {
    console.log(`[Heal Skip] Belum ada data untuk Provinsi ${province.name} (${province.code}).`);
    return { status: 'no_data', fixed: 0, empty: 0 };
  }

  console.log(`\n🩺 Memulai pemeriksaan Auto-Heal untuk Provinsi ${province.name}...`);
  console.log(`Target file: ${targetFile} ${isCheckpoint ? '(Checkpoint Aktif)' : '(File Final)'}`);

  // Kumpulkan semua kelurahan yang kosong
  const emptyList = [];

  if (isCheckpoint) {
    for (const kabId in data.kabupatenData || {}) {
      const kab = data.kabupatenData[kabId];
      for (const kecId in kab.kecamatan || {}) {
        const kec = kab.kecamatan[kecId];
        for (const kel of kec.kelurahan || []) {
          if (!kel.rates || kel.rates.length === 0) {
            emptyList.push(kel);
          }
        }
      }
    }
  } else {
    for (const kab of data.kabupaten || []) {
      for (const kec of kab.kecamatan || []) {
        for (const kel of kec.kelurahan || []) {
          if (!kel.rates || kel.rates.length === 0) {
            emptyList.push(kel);
          }
        }
      }
    }
  }

  if (emptyList.length === 0) {
    console.log(`✨ Sempurna! Semua kelurahan di Provinsi ${province.name} sudah memiliki data rates lengkap 100%.`);
    return { status: 'all_valid', fixed: 0, empty: 0 };
  }

  console.log(`⚠️ Ditemukan ${emptyList.length} kelurahan dengan rates kosong. Memulai penambalan otomatis...`);

  let fixedCount = 0;
  let remainingEmpty = 0;

  for (let i = 0; i < emptyList.length; i++) {
    const kel = emptyList[i];
    try {
      const rates = await getShippingRates(kel.id, 2);
      if (rates && rates.length > 0) {
        kel.rates = rates;
        fixedCount++;
        console.log(`   ✔ [${i + 1}/${emptyList.length}] Berhasil ditambal: ${kel.nama} (${rates.length} rates)`);
      } else {
        remainingEmpty++;
        console.log(`   ❌ [${i + 1}/${emptyList.length}] Tetap kosong dari server pusat: ${kel.nama}`);
      }
    } catch (err) {
      remainingEmpty++;
      console.error(`   ❌ [${i + 1}/${emptyList.length}] Error saat menambal ${kel.nama}: ${err.message}`);
    }
  }

  // Simpan kembali data yang sudah ditambal
  if (isCheckpoint) {
    saveCheckpoint(province.code, data);
  } else {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(finalFile, JSON.stringify(data), 'utf-8');
  }

  console.log(`\n🎉 Selesai Auto-Heal untuk Provinsi ${province.name}!`);
  console.log(`   ✔ Berhasil ditambal : ${fixedCount}`);
  console.log(`   ❌ Masih kosong     : ${remainingEmpty}`);

  return { status: 'healed', fixed: fixedCount, empty: remainingEmpty };
}

/**
 * Menjalankan Auto-Heal untuk seluruh provinsi yang sudah memiliki data / checkpoint.
 */
export async function healAllProvinces(options = {}) {
  console.log('\n🩺 ================= AUTO-HEAL SELURUH PROVINSI =================');
  let totalFixed = 0;
  let totalEmpty = 0;

  for (const prov of CONFIG.PROVINCES) {
    const finalFile = getFinalOutputPath(prov);
    const cpFile = getCheckpointPath(prov.code);

    if (fs.existsSync(finalFile) || fs.existsSync(cpFile)) {
      const res = await healProvince(prov, options);
      totalFixed += (res.fixed || 0);
      totalEmpty += (res.empty || 0);
    }
  }

  console.log('\n================================================================');
  console.log(`🏁 Rekap Auto-Heal Nasional:`);
  console.log(`   Total berhasil ditambal : ${totalFixed} kelurahan`);
  console.log(`   Total masih kosong      : ${totalEmpty} kelurahan`);
  console.log('================================================================\n');
}



