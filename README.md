# 🏥 Antrian Online via WhatsApp Gateway

Proyek ini adalah sistem gateway WhatsApp untuk pendaftaran antrian di Puskesmas, menggunakan `whatsapp-web.js`, Express.js, dan Firebase/Firestore untuk manajemen data dan status WA.

## Fitur Utama

* **Pendaftaran Otomatis:** Pasien dapat mendaftar antrian hanya dengan mengirim pesan WhatsApp.
* **Generate Tiket:** Sistem menghasilkan gambar tiket antrian dengan nomor urut.
* **Manajemen Status WA:** Menyimpan status koneksi WA (QR/CONNECTED/DISCONNECTED) ke Firestore.
* **Manajemen Pengguna (CRUD):** API untuk mengelola pengguna admin.

## ⚙️ Persyaratan (Prasyarat)

Untuk menjalankan proyek ini secara lokal, Anda perlu:

1.  Node.js dan npm
2.  Akun Firebase Project
3.  File kredensial **serviceAccountKey.json** (harus Anda tambahkan secara manual ke root folder).

## 🚀 Cara Instalasi

1.  **Clone Repositori:**
    ```bash
    git clone [https://github.com/Muhammadzakirin/antrian-online-via-wa.git](https://github.com/Muhammadzakirin/antrian-online-via-wa.git)
    cd antrian-online-via-wa
    ```
2.  **Instal Dependencies:**
    ```bash
    npm install
    ```
3.  **Kunci Layanan:** Tempatkan file `serviceAccountKey.json` dari Firebase Anda di folder root.
4.  **Jalankan Server:**
    ```bash
    node wa-gateway.js
    ```
    *Akses status WA di `http://localhost:3000/status`*
