# RoboGo Electron Desktop Application

Desktop application untuk mengontrol robot RoboGo menggunakan komunikasi serial. Aplikasi ini akan otomatis menjalankan client (Next.js) ketika dimulai, tanpa membutuhkan server Node.js terpisah.

## Fitur

- Kontrol robot melalui komunikasi serial
- Deteksi otomatis port serial ESP32/Arduino
- Interface desktop yang mudah digunakan
- **Auto-start client (Next.js)** - Tidak perlu menjalankan secara manual
- Fallback ke website online jika local client tidak tersedia

## Instalasi Dependencies

### Cara Mudah (Otomatis)

Jalankan file batch yang sudah disediakan:

```bash
start-robogo.bat
```

File ini akan otomatis menginstall semua dependencies yang diperlukan.

### Cara Manual

```bash
# Install dependencies untuk Electron
npm install

# Install dependencies untuk client (Next.js)
cd ../client
npm install

# Kembali ke direktori electron
cd ../robogo-electron
```

## Menjalankan Aplikasi

### Cara Mudah (Rekomendasi)

Klik dua kali pada file `start-robogo.bat` atau jalankan di command prompt:

```bash
# Build lengkap (startup pertama atau setelah perubahan code)
start-robogo.bat

# Mode cepat (jika yakin build sudah ada dan valid)
start-robogo-fast.bat
```

### Cara Manual

```bash
# Development mode (dengan DevTools)
npm run dev

# Production mode
npm start
```

## Cara Kerja Auto-Start

Ketika aplikasi Electron dimulai:

1. **Client di-build ulang** untuk production dengan `npm run build` (1-2 menit)
2. **Client dimulai** dengan `npm start` di direktori `../client`
3. **Aplikasi menunggu** hingga service siap (sekitar 1-2 menit total)
4. **Window dibuka** dan mencoba load `http://localhost:3000`
5. **Jika gagal**, fallback ke `https://robogo.website`

⚠️ **Penting**: Startup pertama akan memakan waktu 1-2 menit karena proses build client.

## Status Service

Anda dapat melihat status client di console Electron:

- Buka DevTools dengan `Ctrl+Shift+I` (development mode)
- Lihat tab Console untuk log startup process

## Troubleshooting

### Jika aplikasi tidak bisa load localhost:3000

1. Pastikan semua dependencies terinstall: `npm run test-setup`
2. Coba restart services manual:
   - Tutup aplikasi Electron
   - Jalankan ulang `start-robogo.bat`

### Jika ada error "command not found"

Pastikan Node.js dan npm sudah terinstall:

```bash
node --version
npm --version
```

### Jika ada error port sudah digunakan

1. Tutup semua aplikasi yang menggunakan port 3000
2. Atau restart komputer untuk membersihkan port yang terpakai

### Check setup sebelum menjalankan

```bash
npm run test-setup
```

## Development

Untuk development mode dengan DevTools otomatis terbuka:

```bash
npm run dev
```

## Build ke Executable (.exe)

### Opsi 1: Menggunakan script batch (Windows)

```bash
build.bat
```

### Opsi 2: Manual

```bash
# Install dependencies
npm install

# Build aplikasi untuk Windows
npm run build:win

# Atau build untuk semua platform
npm run build
```

### Opsi 3: Build tanpa installer (folder saja)

```bash
npm run build:dir
```

## Output Build

- File executable akan tersimpan di folder `dist/`
- Installer: `dist/RoboGo Setup [version].exe`
- Portable: `dist/win-unpacked/RoboGo.exe`

## Struktur File

- `index.js` - Main process Electron
- `preload.js` - Preload script untuk security
- `package.json` - Konfigurasi npm dan electron-builder
- `build.bat` - Script batch untuk build otomatis

## Troubleshooting

### Error saat build

1. Pastikan Node.js dan npm sudah terinstall
2. Jalankan `npm install` terlebih dahulu
3. Pastikan tidak ada antivirus yang memblokir proses build

### Icon tidak muncul

- Tambahkan file `icon.ico` ke root folder proyek
- Atau hapus baris `"icon": "icon.ico"` dari package.json

### Aplikasi tidak bisa koneksi ke Next.js

- Pastikan client Next.js berjalan di `http://localhost:3000`
- Atau ubah URL di `index.js` sesuai dengan port yang digunakan
