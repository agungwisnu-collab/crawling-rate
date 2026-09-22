/**
 * Script untuk mengambil shipping rate dari ratecard.ethos.co.id
 * Sesuai panduan di rules.md
 */

const API_BASE = 'https://ratecard.ethos.co.id/ratecardv2';
const API_KEY = 'c4f6971bdd907dbe11f4beb83754cd6ec0790f151418acaa0cdfae259db65c88';
const WAREHOUSE_ID = 2; // ID Warehouse selalu 2 (Jakarta)

// Mapping Provinsi dari select2-results di rules.md
const PROVINCES = {
  'aceh': '11',
  'bali': '51',
  'banten': '36',
  'bengkulu': '17',
  'daerah istimewa yogyakarta': '34',
  'dki jakarta': '31',
  'gorontalo': '75',
  'jambi': '15',
  'jawa barat': '32',
  'jawa tengah': '33',
  'jawa timur': '35',
  'kalimantan barat': '61',
  'kalimantan selatan': '63',
  'kalimantan tengah': '62',
  'kalimantan timur': '64',
  'kalimantan utara': '65',
  'kepulauan bangka belitung': '19',
  'kepulauan riau': '21',
  'lampung': '18',
  'maluku': '81',
  'maluku utara': '82',
  'nusa tenggara barat': '52',
  'nusa tenggara timur': '53',
  'papua': '91',
  'papua barat': '92',
  'papua barat daya': '96',
  'papua pegunungan': '95',
  'papua selatan': '93',
  'papua tengah': '94',
  'riau': '14',
  'sulawesi barat': '76',
  'sulawesi selatan': '73',
  'sulawesi tengah': '72',
  'sulawesi tenggara': '74',
  'sulawesi utara': '71',
  'sumatera barat': '13',
  'sumatera selatan': '16',
  'sumatera utara': '12'
};

async function postForm(endpoint, params) {
  const body = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status} saat memanggil ${endpoint}`);
  }

  return response.json();
}

async function getShippingRate({ provinceName, kabName, kecName, kelName }) {
  console.log('='.repeat(60));
  console.log(`Pencarian Tarif Pengiriman:`);
  console.log(`Lokasi: ${kelName || '-'}, Kec. ${kecName}, Kab. ${kabName}, Prov. ${provinceName}`);
  console.log('='.repeat(60));

  // 1. Dapatkan Kode Provinsi
  const provCode = PROVINCES[provinceName.toLowerCase().trim()];
  if (!provCode) {
    throw new Error(`Provinsi "${provinceName}" tidak ditemukan di daftar.`);
  }
  console.log(`[1] Provinsi: ${provinceName} (Kode: ${provCode})`);

  // 2. Dapatkan Kabupaten
  const kabList = await postForm('getKab', { src: provCode, term: kabName });
  const matchedKab = kabList.find(k => k.text.toLowerCase().includes(kabName.toLowerCase())) || kabList[0];
  if (!matchedKab) {
    throw new Error(`Kabupaten "${kabName}" tidak ditemukan di provinsi ${provinceName}.`);
  }
  console.log(`[2] Kabupaten: ${matchedKab.text} (ID: ${matchedKab.id})`);

  // 3. Dapatkan Kecamatan
  const kecList = await postForm('getKec', { src: matchedKab.id, term: kecName });
  const matchedKec = kecList.find(k => k.text.toLowerCase().includes(kecName.toLowerCase())) || kecList[0];
  if (!matchedKec) {
    throw new Error(`Kecamatan "${kecName}" tidak ditemukan di kabupaten ${matchedKab.text}.`);
  }
  console.log(`[3] Kecamatan: ${matchedKec.text} (ID: ${matchedKec.id})`);

  // 4. Dapatkan Kelurahan
  const kelList = await postForm('getKel', { src: matchedKec.id, term: kelName || '' });
  if (!kelList || kelList.length === 0) {
    throw new Error(`Tidak ada kelurahan ditemukan untuk kecamatan ${matchedKec.text}.`);
  }

  let matchedKel = kelList[0];
  if (kelName) {
    const found = kelList.find(k => k.text.toLowerCase().includes(kelName.toLowerCase()));
    if (found) matchedKel = found;
  }
  console.log(`[4] Kelurahan: ${matchedKel.text} (ID: ${matchedKel.id})`);

  // 5. Dapatkan Rate Card
  const rateResponse = await postForm('list', {
    key: API_KEY,
    id: matchedKel.id,
    wh: WAREHOUSE_ID
  });

  if (rateResponse.code !== 200 || !Array.isArray(rateResponse.data)) {
    throw new Error(`Gagal mengambil rate: ${rateResponse.message || JSON.stringify(rateResponse)}`);
  }

  console.log(`\n[5] Hasil Shipping Rate (${rateResponse.data.length} opsi pengiriman):`);
  console.table(
    rateResponse.data.map(item => ({
      'Ekspedisi': item.pattern,
      'Layanan': item.service_type,
      'Harga (Rp)': item.price.toLocaleString('id-ID'),
      'Diskon': `${item.discount_percentage}%`,
      'COD': item.is_cod ? 'Ya' : 'Tidak',
      'Estimasi (Hari)': item.etd_min && item.etd_max ? `${item.etd_min}-${item.etd_max}` : '-'
    }))
  );

  return rateResponse.data;
}

// Eksekusi uji coba
(async () => {
  try {
    await getShippingRate({
      provinceName: 'Jawa Tengah',
      kabName: 'Wonosobo',
      kecName: 'Sapuran',
      kelName: 'Sapuran'
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
