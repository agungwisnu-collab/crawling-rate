# Crawler Shipping Rates Indonesia (Ethos Ratecard)

Sistem crawler otomatis berbasis Node.js yang mengumpulkan data tarif pengiriman (*shipping rates*) seluruh Indonesia dari API Ethos Ratecard. Dirancang tangguh dengan sistem *checkpoint per kecamatan*, *auto-heal* data kosong, pembatas kecepatan (*rate limiter*), dan dapat berjalan di **GitHub Actions** (cloud background) tanpa laptop menyala 24 jam nonstop.

---

## 🌟 Fitur Utama

1. **Rate Limiter & Anti-Burst**:
   - Menerapkan mekanisme *token bucket sliding-window* (default 120 req/menit, jeda minimum 500 ms) untuk mematuhi rate limit API tanpa lonjakan.
2. **Resilience & Checkpoint per Kecamatan**:
   - Setiap kecamatan yang selesai di-crawl langsung disimpan ke file checkpoint `data/checkpoints/checkpoint-{kode_provinsi}.json`.
   - Jika proses terputus (karena batas waktu runner, cancel, atau koneksi), proses berikutnya akan **otomatis melanjutkan dari kecamatan terakhir** tanpa mengulang dari awal.
3. **Auto-Heal (Penambalan Data Mandiri)**:
   - Menyisir dan menambal hanya kelurahan yang memiliki data rates kosong (`rates: []`) akibat gangguan server API sesaat, tanpa perlu mengulang crawling ribuan kelurahan lainnya.
4. **Penyimpanan Lokal Non-Database (Hierarchical JSON)**:
   - File hasil disimpan per provinsi di `data/rates/{kode}-{slug}.json`.
   - Struktur data: `Provinsi > Kabupaten > Kecamatan > Kelurahan > Rates`.
5. **Eksekusi di Background via GitHub Actions**:
   - Dijalankan via menu **Run workflow** di GitHub (tersedia menu Single Province, Multiple, Auto-Heal, Status List, dll.).
   - Hasil crawl otomatis di-commit & di-push kembali ke branch repository (`data/rates/`).

---

## 📖 Daftar Lengkap Command CLI (`node index.js`)

Semua perintah dijalankan melalui file [index.js](file:///d:/Project/crawling-rate/index.js) di terminal lokal Anda:

### 1. Status & Monitoring Progres
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --list` | Menampilkan tabel status 38 provinsi se-Indonesia, total data kelurahan terkumpul, status checkpoint aktif, dan rincian kabupaten yang sudah selesai tercapture. |

### 2. Crawling Berdasarkan Provinsi
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --prov=51` | Menjalankan crawl untuk 1 provinsi berdasarkan **kode** (contoh: `51` = Bali). |
| `node index.js --prov="Bali"` | Menjalankan crawl untuk 1 provinsi berdasarkan **nama** (contoh: `"Bali"` atau `"Jawa Tengah"`). |
| `node index.js --prov="11, 51, 34"` | Menjalankan **beberapa provinsi sekaligus** secara sekuensial (dipisah koma). |
| `node index.js --prov="Aceh, Bali, Banten"` | Menjalankan beberapa provinsi sekaligus menggunakan nama provinsi. |

### 3. Mode Otomatis (Next & All)
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --next` *(atau `--prov=NEXT`)* | Otomatis mendeteksi dan menjalankan **1 provinsi berikutnya yang belum selesai** (sangat cocok untuk cicil bertahap). |
| `node index.js --all` *(atau `--prov=ALL`)* | Otomatis menjalankan **seluruh provinsi yang belum selesai** satu per satu sampai tuntas se-Indonesia. |

### 4. Auto-Heal (Pemeriksaan & Penambalan Data Kosong)
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --heal` *(atau `--heal=all`)* | Menyisir seluruh file provinsi di `data/rates/` dan `data/checkpoints/`. Jika ada kelurahan yang datanya kosong (`rates: []`), sistem akan **menambal data kelurahan tersebut saja** ke API tanpa mengulang data yang sudah ada. |
| `node index.js --heal=51` | Menjalankan auto-heal khusus untuk 1 provinsi tertentu (contoh: Bali). |
| `node index.js --prov=51 --heal` | Perintah alternatif untuk auto-heal 1 provinsi tertentu. |

### 5. Pengaturan Kecepatan & Jeda (Rate Limit Override)
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --prov=36 --interval=200` | Mengatur jeda minimum antar-request menjadi `200 ms` (default BebasKirim: `220 ms`). |
| `node index.js --prov=36 --rate=300` | Mengatur kuota request maksimal per menit menjadi `300 req/menit` (default: `280 req/menit`). |
| `node index.js --prov=36 --rate=1000 --interval=60` | Meng-override kecepatan maksimal hingga `1000 req/menit` (jeda `60 ms`). Jika gateway server mengembalikan `HTTP 429`, crawler otomatis melakukan jeda pintar (*adaptive backoff*). |


### 6. Filter Pengujian & Penimpaan (Testing Flags)
| Command | Deskripsi |
| :--- | :--- |
| `node index.js --prov=36 --max-kab=1` | Membatasi proses crawling hanya sampai **1 kabupaten** saja (berguna untuk pengujian cepat). Checkpoint tetap aman disimpan. |
| `node index.js --prov=36 --max-kab=1 --max-kec=1` | Membatasi proses hanya sampai **1 kabupaten dan 1 kecamatan**. |
| `node index.js --prov=51 --force` | Memaksa crawling ulang dari awal meskipun file provinsi sudah berstatus selesai (`already completed`). |

---

## ☁️ Cara Menjalankan di GitHub Actions (Tanpa Laptop Nyala)

### 1. Setup Awal Repository
1. Push proyek ke GitHub:
   ```bash
   git remote add origin https://github.com/<username>/<repo-name>.git
   git push -u origin main
   ```
2. **Aktifkan Izin Tulis (PENTING)**:
   - Buka **Settings** > **Actions** > **General**.
   - Pada bagian **Workflow permissions**, pilih: **Read and write permissions**.
   - Klik **Save**.

### 2. Memilih Opsi di Menu `Run workflow`
Buka tab **Actions** > pilih **Crawl Shipping Rates Indonesia** > klik tombol **Run workflow**:

* **Opsi Preset Dropdown**:
  * `NEXT`: Otomatis melanjutkan 1 provinsi berikutnya yang belum selesai.
  * `ALL`: Menjalankan seluruh provinsi se-Indonesia secara berurutan.
  * `AUTO_HEAL`: Menyisir seluruh data dan menambal otomatis data rates yang kosong.
  * `STATUS_LIST`: Hanya mencetak tabel status & progres se-Indonesia di log runner tanpa melakukan crawl.
  * `CUSTOM`: Mengizinkan input manual beberapa provinsi di kolom bawahnya.
  * `Daftar Provinsi (11 s.d. 12)`: Memilih langsung 1 provinsi spesifik dari daftar 38 provinsi.
* **Kolom `custom_provinces`**: Isi dengan kode/nama provinsi dipisah koma (contoh: `11, 51, 34`) jika memilih preset `CUSTOM`.
* **Kolom `rate`**: Isi kecepatan per menit yang diinginkan (default: `280`, bisa diisi `300` s.d. `1000`).
* **Kolom `interval`**: Isi jeda minimum antar-request dalam milidetik (default: `220`, misal: `200` atau `60`).
* **Checkbox `force`**: Centang jika ingin memaksa crawl ulang provinsi yang sudah selesai.

### 3. Mengambil Hasil Crawl ke Laptop
Setelah GitHub Actions selesai, Anda cukup menjalankan perintah berikut di terminal laptop:
```bash
git pull origin main
```
Seluruh file JSON terbaru di folder `data/rates/` akan langsung tersinkronisasi ke laptop Anda.

---

## 📂 Struktur Output JSON

File hasil akhir disimpan per provinsi di `data/rates/{kode}-{slug}.json` dengan format:
```json
{
  "provinsi_kode": "51",
  "provinsi_nama": "Bali",
  "warehouse_id": 2,
  "last_updated": "2026-09-22T09:15:55.123Z",
  "total_kabupaten": 9,
  "total_kecamatan": 57,
  "total_kelurahan": 716,
  "kabupaten": [
    {
      "id": "51.03",
      "nama": "Kabupaten Badung",
      "kecamatan": [
        {
          "id": "51.03.03",
          "nama": "Abiansemal",
          "kelurahan": [
            {
              "id": "51.03.03.2008",
              "nama": "Abiansemal [80352]",
              "rates": [
                {
                  "pattern": "JNT - Reguler",
                  "provider_code": "CR_JNT",
                  "provider_name": "JNT",
                  "service_type": "Reguler",
                  "price": 27000,
                  "is_cod": true,
                  "etd_min": null,
                  "etd_max": null
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
