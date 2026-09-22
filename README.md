# Crawler Shipping Rates Indonesia (Ethos Ratecard)

Sistem crawler otomatis berbasis Node.js yang mengumpulkan data tarif pengiriman (*shipping rates*) seluruh Indonesia dari API Ethos Ratecard. Dirancang khusus untuk berjalan di **GitHub Actions** (cloud background) sehingga laptop Anda tidak perlu menyala 24 jam nonstop.

---

## 🌟 Fitur Utama

1. **Rate Limiter Ketat 70 Req/Menit**:
   - Menerapkan mekanisme *token bucket sliding-window* dan jeda interval minimal `880 ms` antar request untuk mematuhi rate limit API tanpa lonjakan (*anti-burst*).
2. **Resilience & Checkpoint per Kecamatan**:
   - Setiap kecamatan yang selesai di-crawl langsung disimpan ke file checkpoint `data/checkpoints/checkpoint-{kode_provinsi}.json`.
   - Jika proses terputus (karena batas waktu runner, cancel, atau koneksi), proses berikutnya akan **otomatis melanjutkan dari kecamatan terakhir** tanpa mengulang dari awal.
3. **Penyimpanan Lokal Non-Database (Hierarchical JSON)**:
   - File hasil disimpan per provinsi di `data/rates/{kode}-{nama_provinsi}.json`.
   - Struktur terstruktur hierarkis: `Kabupaten > Kecamatan > Kelurahan > Rates`.
4. **Eksekusi di Background via GitHub Actions**:
   - Dijalankan via menu **Run workflow** di GitHub.
   - Pilihan target: bisa memilih 1 provinsi tertentu, mode `NEXT` (memproses 1 provinsi berikutnya yang belum selesai), atau mode `ALL`.
   - Hasil crawl otomatis di-commit & di-push kembali ke branch repository (`data/rates/`).
   - Anda cukup menjalankan `git pull` di laptop kapan saja untuk mendapatkan file hasil crawl terbaru.

---

## 🚀 Cara Menjalankan di GitHub Actions

1. **Push Proyek ke Repository GitHub**:
   ```bash
   git init
   git add .
   git commit -m "feat: setup shipping rate crawler with github actions"
   git remote add origin https://github.com/<username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```

2. **Pastikan Izin Write Workflow Aktif**:
   - Di halaman repository GitHub: Masuk ke **Settings** > **Actions** > **General**.
   - Pada bagian **Workflow permissions**, pilih: **Read and write permissions**.
   - Klik **Save**.

3. **Jalankan Crawler**:
   - Masuk ke tab **Actions** di repository GitHub Anda.
   - Pilih workflow **Crawl Shipping Rates Indonesia**.
   - Klik tombol **Run workflow**:
     - Pilih target provinsi dari dropdown (misal: `33 - Jawa Tengah`), atau biarkan `NEXT` untuk memproses otomatis provinsi yang belum selesai.
     - Klik **Run workflow**.
   - Anda bisa langsung mematikan laptop! Runner GitHub akan mengeksekusi proses di server cloud, melakukan commit hasil ke branch `main`, dan menyimpannya di folder `data/rates/`.

4. **Ambil Data ke Laptop**:
   - Kapan saja Anda menyalakan laptop:
   ```bash
   git pull origin main
   ```
   File hasil crawl sudah tersedia di folder `data/rates/`.

---

## 💻 Cara Menjalankan Manual di Komputer Lokal

Jika sewaktu-waktu ingin menjalankan atau menguji di laptop:

- **Melihat Status 38 Provinsi**:
  ```bash
  node index.js --list
  ```

- **Menjalankan 1 Provinsi Tertentu**:
  ```bash
  node index.js --prov=33
  # atau
  node index.js --prov="Bali"
  ```

- **Menjalankan 1 Provinsi Berikutnya yang Belum Selesai (Mode NEXT)**:
  ```bash
  node index.js --next
  ```

- **Uji Coba Cepat (Single Sub-district)**:
  ```bash
  node index.js --prov=33 --max-kab=1 --max-kec=1
  ```

---

## 📂 Struktur Output JSON

File disimpan di `data/rates/{kode}-{slug}.json`:
```json
{
  "provinsi_kode": "33",
  "provinsi_nama": "Jawa Tengah",
  "warehouse_id": 2,
  "last_updated": "2026-09-22T04:09:57.342Z",
  "total_kabupaten": 35,
  "total_kecamatan": 576,
  "total_kelurahan": 8562,
  "kabupaten": [
    {
      "id": "33.07",
      "nama": "Kabupaten Wonosobo",
      "kecamatan": [
        {
          "id": "33.07.03",
          "nama": "Sapuran",
          "kelurahan": [
            {
              "id": "33.07.03.1008",
              "nama": "Sapuran [56375]",
              "rates": [
                {
                  "pattern": "JNT - Reguler",
                  "provider_code": "CR_JNT",
                  "provider_name": "JNT",
                  "service_type": "Reguler",
                  "price": 21000,
                  "is_cod": true
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
