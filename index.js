import { CONFIG } from './src/config.js';
import { crawlProvince, getIncompleteProvinces, getProvinceProgress, healProvince, healAllProvinces } from './src/crawler.js';
import { defaultRateLimiter } from './src/rateLimiter.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    if (arg.startsWith('--prov=')) {
      options.prov = arg.split('=')[1].trim();
    } else if (arg === '--all') {
      options.prov = 'ALL';
    } else if (arg === '--next') {
      options.prov = 'NEXT';
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--max-kab=')) {
      options.maxKab = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-kec=')) {
      options.maxKec = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--rate=')) {
      options.rate = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--interval=')) {
      options.interval = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--heal=')) {
      options.heal = arg.split('=')[1].trim();
    } else if (arg === '--heal') {
      options.heal = 'ALL';
    }
  }

  return options;
}

function printStatusList() {
  let doneCount = 0;
  let inProgressCount = 0;
  let notStartedCount = 0;
  let totalKelTerkumpul = 0;

  const results = [];

  for (const prov of CONFIG.PROVINCES) {
    const progress = getProvinceProgress(prov);
    if (progress.status === 'DONE') {
      doneCount++;
      totalKelTerkumpul += progress.kelurahanCount;
    } else if (progress.status === 'IN_PROGRESS') {
      inProgressCount++;
      totalKelTerkumpul += progress.kelurahanCount;
    } else {
      notStartedCount++;
    }
    results.push({ prov, progress });
  }

  console.log('\n================== STATUS CRAWLING PROVINSI SE-INDONESIA ==================');
  console.log(`Total Provinsi        : ${CONFIG.PROVINCES.length}`);
  console.log(`  - Selesai Penuh (✅) : ${doneCount}`);
  console.log(`  - Berprogres    (🔄) : ${inProgressCount}`);
  console.log(`  - Belum Mulai   (⏳) : ${notStartedCount}`);
  console.log(`Total Data Terkumpul  : ${totalKelTerkumpul.toLocaleString('id-ID')} Kelurahan`);
  console.log('============================================================================\n');

  for (const { prov, progress } of results) {
    if (progress.status === 'DONE') {
      console.log(`[${prov.code}] ✅ SELESAI  - ${prov.name} (${progress.kabupatenCount} Kab | ${progress.kecamatanCount} Kec | ${progress.kelurahanCount.toLocaleString('id-ID')} Kel)`);
    } else if (progress.status === 'IN_PROGRESS') {
      console.log(`[${prov.code}] 🔄 PROGRES  - ${prov.name} (${progress.kabupatenCount} Kab | ${progress.kecamatanCount} Kec | ${progress.kelurahanCount.toLocaleString('id-ID')} Kel tercapture)`);
      if (progress.kabupatenList && progress.kabupatenList.length > 0) {
        progress.kabupatenList.forEach(kab => {
          console.log(`       └─ ✔ ${kab.nama}: ${kab.kecamatanCount} Kec, ${kab.kelurahanCount.toLocaleString('id-ID')} Kel/Gampong`);
        });
      }
    } else {
      console.log(`[${prov.code}] ⏳ BELUM    - ${prov.name}`);
    }
  }
  console.log('');
}

async function main() {
  const options = parseArgs();

  if (options.rate || options.interval) {
    defaultRateLimiter.updateConfig(options.rate, options.interval);
    console.log(`[Config] Rate limiter disetel ke: ${options.rate || CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE} req/min (jeda: ${options.interval || CONFIG.RATE_LIMIT.MIN_INTERVAL_MS} ms)`);
  }

  if (options.list) {
    printStatusList();
    return;
  }

  // Handle Command --heal (Periksa dan tambal otomatis data kosong)
  if (options.heal) {
    const healTarget = options.heal === 'ALL' && options.prov ? options.prov : options.heal;

    if (healTarget.toUpperCase() === 'ALL') {
      await healAllProvinces(options);
      return;
    }

    // Single atau comma-separated provinsi untuk di-heal
    const tokens = healTarget.split(',').map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
      const codeOrName = token.includes(' - ') ? token.split(' - ')[0].trim() : token;
      const province = CONFIG.PROVINCES.find(p =>
        p.code === codeOrName ||
        p.name.toLowerCase() === codeOrName.toLowerCase() ||
        p.slug === codeOrName.toLowerCase()
      );

      if (!province) {
        console.error(`❌ Provinsi "${token}" tidak ditemukan untuk di-heal.`);
        continue;
      }

      await healProvince(province, options);
    }
    return;
  }

  const targetProv = options.prov || 'NEXT';

  if (targetProv.toUpperCase() === 'NEXT') {
    const incomplete = getIncompleteProvinces();
    if (incomplete.length === 0) {
      console.log('🎉 Seluruh 38 provinsi di Indonesia sudah selesai di-crawl!');
      return;
    }

    const nextProv = incomplete[0];
    console.log(`[Mode NEXT] Menjalankan provinsi berikutnya yang belum selesai: ${nextProv.name} (${nextProv.code})`);
    await crawlProvince(nextProv, options);
    return;
  }

  if (targetProv.toUpperCase() === 'ALL') {
    const incomplete = getIncompleteProvinces();
    if (incomplete.length === 0) {
      console.log('🎉 Seluruh 38 provinsi di Indonesia sudah selesai di-crawl!');
      return;
    }

    console.log(`[Mode ALL] Memproses ${incomplete.length} provinsi yang belum selesai secara sekuensial...`);
    for (let i = 0; i < incomplete.length; i++) {
      const prov = incomplete[i];
      console.log(`\n>>> Progress: Provinsi ${i + 1}/${incomplete.length} (${prov.name}) <<<`);
      await crawlProvince(prov, options);
    }
    console.log('🎉 Selesai memproses semua target!');
    return;
  }

  // Jika targetProv mengandung koma (misal: "11, 51, 33" atau "Aceh, Bali")
  if (targetProv.includes(',')) {
    const rawTokens = targetProv.split(',').map(t => t.trim()).filter(Boolean);
    const targetList = [];
    for (const token of rawTokens) {
      // Ekstrak kode angka di awal jika ada teks '11 - Aceh'
      const codeOrName = token.includes(' - ') ? token.split(' - ')[0].trim() : token;
      const p = CONFIG.PROVINCES.find(item =>
        item.code === codeOrName ||
        item.name.toLowerCase() === codeOrName.toLowerCase() ||
        item.slug === codeOrName.toLowerCase()
      );
      if (p) targetList.push(p);
      else console.warn(`⚠️ Provinsi "${token}" tidak ditemukan, dilewati.`);
    }

    if (targetList.length === 0) {
      console.error('❌ Tidak ada provinsi valid yang ditemukan dari daftar yang dimasukkan.');
      process.exit(1);
    }

    console.log(`[Batch Run] Memproses ${targetList.length} provinsi terpilih: ${targetList.map(p => p.name).join(', ')}`);
    for (let i = 0; i < targetList.length; i++) {
      const prov = targetList[i];
      console.log(`\n>>> Progress: Provinsi ${i + 1}/${targetList.length} (${prov.name}) <<<`);
      await crawlProvince(prov, options);
    }
    console.log('🎉 Selesai memproses seluruh daftar provinsi yang dipilih!');
    return;
  }

  // Cari provinsi berdasarkan kode atau nama
  const singleToken = targetProv.includes(' - ') ? targetProv.split(' - ')[0].trim() : targetProv;
  const province = CONFIG.PROVINCES.find(p => 
    p.code === singleToken || 
    p.name.toLowerCase() === singleToken.toLowerCase() ||
    p.slug === singleToken.toLowerCase()
  );

  if (!province) {
    console.error(`❌ Provinsi "${targetProv}" tidak ditemukan.`);
    console.log('Gunakan --list untuk melihat daftar provinsi dan kodenya.');
    process.exit(1);
  }

  await crawlProvince(province, options);
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
