# Auto Clock-in & Clock-out Talenta 🕐

Sistem otomasi clock-in dan clock-out ke **Talenta by Mekari** menggunakan Playwright headless browser + GitHub Actions cron job.

**Jadwal Otomatis (Senin – Jumat)**:
- 🟢 **Clock In**: Jam **08:40 WITA** (00:40 UTC)
- 🔴 **Clock Out**: Jam **18:10 WITA / 6:10 PM** (10:10 UTC)

---

## 🚀 Setup (Wajib Dilakukan Sekali)

### 1. Fork / Clone repo ini ke GitHub

Pastikan repo ini sudah ada di akun GitHub kamu.

### 2. Cari koordinat rumah

1. Buka [Google Maps](https://maps.google.com)
2. Klik kanan tepat di titik rumah kamu
3. Klik angka koordinat yang muncul paling atas (otomatis tersalin)
4. Contoh hasil: `-5.123456, 119.456789`
   - Angka pertama = **Latitude**
   - Angka kedua = **Longitude**

### 3. Tambahkan GitHub Secrets

Buka repo di GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Tambahkan **4 secrets** berikut:

| Secret Name | Isi | Contoh |
|---|---|---|
| `TALENTA_EMAIL` | Email login Talenta | `kamu@perusahaan.com` |
| `TALENTA_PASSWORD` | Password Talenta | `passwordmu` |
| `TALENTA_LATITUDE` | Latitude rumah | `-5.123456` |
| `TALENTA_LONGITUDE` | Longitude rumah | `119.456789` |

> ⚠️ **Jangan pernah tulis credential langsung di kode.** Selalu pakai Secrets.

---

## 🧪 Test Manual (Sebelum Jadwal Otomatis)

1. Buka tab **Actions** di GitHub repo kamu
2. Pilih workflow **"Auto Clock-in Talenta"**
3. Klik **"Run workflow"** → pilih **dry_run: true** untuk test login saja
4. Tunggu workflow selesai (~2–3 menit)
5. Klik workflow run → **Artifacts** → download **clockin-screenshots**
6. Cek screenshot — pastikan login berhasil

Jika login oke, jalankan lagi dengan **dry_run: false** untuk test clock-in penuh.

---

## 📸 Screenshot Artifacts

Setiap run menyimpan screenshot di setiap langkah:

| File | Keterangan |
|---|---|
| `01-login-page` | Halaman login sebelum isi credential |
| `02-credentials-filled` | Setelah isi email & password |
| `03-after-login` | Setelah berhasil login |
| `04-attendance-page` | Halaman absensi |
| `05-after-clockin` | Setelah klik Clock In |
| `06-after-confirm` | Setelah konfirmasi dialog (jika ada) |
| `ERROR` | Jika terjadi error (untuk debug) |

Screenshot tersimpan **7 hari** di GitHub Actions Artifacts.

---

## 🔧 Troubleshooting

**Tombol Clock In tidak ditemukan?**
- Cek screenshot `04-attendance-page` — mungkin URL halaman attendance berbeda
- Mungkin sudah clock-in hari itu (tombol berubah jadi Clock Out)
- Edit selector di `clockin.js` sesuai elemen yang ada

**Login gagal?**
- Cek screenshot `02-credentials-filled` — pastikan form terisi
- Verifikasi secrets sudah benar di GitHub Settings
- Mungkin ada captcha — coba login manual dulu di browser

**Workflow tidak jalan otomatis?**
- GitHub Actions cron bisa delay 5–15 menit
- Pastikan ada commit terbaru di repo (GitHub kadang pause cron untuk repo inactive)

---

## ⚙️ Konfigurasi Jadwal

Edit file `.github/workflows/clockin.yml` jika ingin ubah jadwal:

```yaml
# Format: menit jam hari-bulan bulan hari-minggu (UTC)
# 1-5 = Senin sampai Jumat
cron: '40 0 * * 1-5'   # 00:40 UTC = 08:40 WITA
```

Konversi timezone:
- WITA (UTC+8): kurangi 8 jam → `08:40 - 8:00 = 00:40 UTC`

---

## 📁 Struktur Project

```
schedule-talenta/
├── clockin.js              # Script utama Playwright
├── package.json            # Dependencies
├── README.md               # Dokumentasi ini
└── .github/
    └── workflows/
        └── clockin.yml     # GitHub Actions workflow
```
