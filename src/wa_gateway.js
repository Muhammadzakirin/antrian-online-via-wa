/**
 * wa-gateway.js (FINALIZED: No Terminal Auth, Headless WA Client)
 * WhatsApp Gateway Server dengan Generate Tiket Antrian & Manajemen Pengguna
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const http = require('http'); 
const socketIo = require('socket.io'); 
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createCanvas } = require('canvas');
const bcrypt = require('bcrypt'); 

// --- KONSTANTA & KONFIGURASI ---
const USERS_COLLECTION_PATH = 'settings/users'; 
const WA_SESSION_DOC = 'gateway/wa_status';
const PORT = 3000;
const DUMMY_APP_ID = "1:1072172499150:web:1dd83762ae07ba61a3d09f";
const SECRET_CODE = '123456'; 

// Heartbeat
const HEARTBEAT_INTERVAL = 30000; // Cek setiap 30 detik
let heartbeatTimer; 
// ------------------------------------

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app); 
const io = socketIo(server, { 
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
}); 

let db;
const appId = DUMMY_APP_ID;

// ===================================
// FIREBASE ADMIN
// ===================================
try {
    const SERVICE_ACCOUNT = require('./serviceAccountKey.json');

    admin.initializeApp({
        credential: admin.credential.cert(SERVICE_ACCOUNT),
    });

    db = admin.firestore();
    console.log('✅ Firebase Admin SDK terinisialisasi.');
} catch (error) {
    console.error('❌ ERROR serviceAccountKey.json:', error.message);
    process.exit(1);
}

// ===================================
// WHATSAPP CLIENT & EVENT LISTENERS
// ===================================

let client = null; // Klien dideklarasikan di luar, tetapi diinisialisasi di startClient

// FUNGSI BARU: Memutuskan semua listeners dari klien lama
function unhookListeners() {
    if (client) {
        client.removeAllListeners('qr');
        client.removeAllListeners('ready');
        client.removeAllListeners('auth_failure');
        client.removeAllListeners('disconnected');
        client.removeAllListeners('message_create');
        console.log("Hooks klien lama dilepaskan.");
    }
}

/**
 * FUNGSI INTI UNTUK MEMULAI KLIEN WA (MODIFIKASI BESAR)
 */
async function startClient() {
    // MODIFIKASI: Hancurkan klien lama jika masih ada (pembersihan sumber daya)
    if (client) {
        unhookListeners(); // Lepas listeners dari klien lama
        try {
            await client.destroy(); 
            console.log("♻️ Klien WA lama berhasil dihancurkan.");
        } catch (e) {
            console.warn("⚠️ Gagal menghancurkan klien lama (diharapkan karena error protokol). Lanjut membuat klien baru.");
        }
    }
    
    // Inisialisasi Klien WA baru yang bersih
    client = new Client({
        puppeteer: {
            headless: true, 
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-gpu",
                "--disable-features=site-per-process"
            ]
        },
        authStrategy: new LocalAuth()
    });
    
    // Lampirkan kembali semua event listener ke klien baru
    client.on('qr', onWaQr);
    client.on('ready', onWaReady);
    client.on('auth_failure', onWaAuthFailure);
    client.on('disconnected', onWaDisconnected);
    client.on("message_create", onWaMessageCreate);
    
    await updateWaStatusInFirestore("INITIALIZING", null, "Memulai koneksi...");
    client.initialize();
}


// ===================================
// UPDATE STATUS FIRESTORE
// ===================================
async function updateWaStatusInFirestore(status, qrCodeData = null, detail = null) {
    try {
        const ref = db.doc(WA_SESSION_DOC);

        const data = {
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        data.qrCode = qrCodeData ? qrCodeData : admin.firestore.FieldValue.delete();
        data.detail = detail ? detail : admin.firestore.FieldValue.delete();

        await ref.set(data, { merge: true });
        console.log(`[FS] Status Updated: ${status}`);
        
        io.emit('status_update', { status: status, detail: detail });
        
    } catch (err) {
        console.error('[FIRESTORE ERROR]', err);
    }
}


// ===================================
// MEKANISME HEARTBEAT & PENCEGAHAN STATUS PALSU
// ===================================

/**
 * 💡 FUNGSI: Mengecek status WA secara berkala.
 */
function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(async () => {
        try {
            // client.info akan ada jika klien terhubung
            if (client && client.info && client.info.wid) {
                console.log("[HEARTBEAT] Client is alive.");
            } else {
                // Klien tidak responsif atau disconnected tanpa memicu event.
                console.warn("[HEARTBEAT] Client is internally unresponsive. Forcing DISCONNECTED status.");
                
                await updateWaStatusInFirestore(
                    "DISCONNECTED",
                    null,
                    "Koneksi terputus (Dideteksi oleh Heartbeat)."
                );
                // Matikan timer Heartbeat 
                clearInterval(heartbeatTimer);
            }
        } catch (error) {
            console.error("[HEARTBEAT ERROR]", error.message);
            // Hentikan timer jika ada error tak terduga
            clearInterval(heartbeatTimer);
        }
    }, HEARTBEAT_INTERVAL);

    console.log(`[HEARTBEAT] Timer started (${HEARTBEAT_INTERVAL / 1000}s interval).`);
}


// ===================================
// EVENT LISTENERS BERGUNA (DEFINISI TUNGGAL)
// ===================================
const onWaQr = async (qr) => {
    console.log('\n=== QR BARU DITERIMA (Scan di Terminal atau Dashboard) ===');
    qrcodeTerminal.generate(qr, { small: true }); 
    
    io.emit('qr_update', { qr_data: qr }); 

    try {
        const base64 = await qrcode.toDataURL(qr); 

        await updateWaStatusInFirestore(
            "SCANNING",
            base64,
            "Silakan scan QR Code untuk login WhatsApp."
        );

    } catch (err) {
        console.error("❌ Gagal generate QR:", err);
    }
};

const onWaReady = async () => {
    console.log("🎉 WA Client Ready!");
    await updateWaStatusInFirestore(
        "CONNECTED", 
        null,
        "WA Gateway terhubung."
    );
    // Mulai Heartbeat saat ready
    startHeartbeat(); 
};

const onWaAuthFailure = async (msg) => {
    console.log("❌ AUTH FAIL:", msg);
    await updateWaStatusInFirestore("ERROR", null, msg);
    if (heartbeatTimer) clearInterval(heartbeatTimer); 
};

const onWaDisconnected = async (reason) => {
    console.log("⚠️ DISCONNECTED:", reason);
    // Hentikan Heartbeat saat disconnected
    if (heartbeatTimer) clearInterval(heartbeatTimer); 
    
    await updateWaStatusInFirestore(
        "DISCONNECTED",
        null,
        reason
    );
};

const onWaMessageCreate = async (msg) => {
    if (msg.fromMe) return;
    handleIncomingMessage(msg);
};


// ===================================
// HELPER: GENERATE NOMOR ANTRIAN BARU
// ===================================
async function getNextAntrianNumber() {
    try {
        const collectionPath = `artifacts/${appId}/public/data/antrian`;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

        const snapshot = await db.collection(collectionPath)
            .where('timestamp', '>=', todayTimestamp)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            return 1;
        }

        const latestDoc = snapshot.docs[0].data();
        return (latestDoc.no_antrian || 0) + 1;

    } catch (error) {
        console.error('Error getting next antrian number:', error);
        return 1;
    }
}

// ===================================
// HELPER: GENERATE GAMBAR TIKET ANTRIAN
// ===================================
function generateTicketImage(nomorAntrian, namaPasien, keluhan) {
    const canvas = createCanvas(600, 800);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 800);

    // Header (Hijau)
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(0, 0, 600, 150);

    // Judul
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PUSKESMAS', 300, 60);
    ctx.font = '20px Arial';
    ctx.fillText('Tiket Antrian', 300, 100);

    // Nomor Antrian (Besar)
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`A${nomorAntrian}`, 300, 300);

    // Garis pemisah
    ctx.strokeStyle = '#bdc3c7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 350);
    ctx.lineTo(550, 350);
    ctx.stroke();

    // Informasi Pasien
    ctx.fillStyle = '#34495e';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Nama Pasien:', 50, 410);
    
    ctx.font = '22px Arial';
    ctx.fillStyle = '#2c3e50';
    ctx.fillText(namaPasien.substring(0, 30), 50, 450);

    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = '#34495e';
    ctx.fillText('Keluhan:', 50, 510);
    
    ctx.font = '20px Arial';
    ctx.fillStyle = '#7f8c8d';
    
    // Word wrap untuk keluhan
    const maxWidth = 500;
    const lineHeight = 30;
    const words = keluhan.split(' ');
    let line = '';
    let y = 550;

    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && i > 0) {
            ctx.fillText(line, 50, y);
            line = words[i] + ' ';
            y += lineHeight;
            if (y > 680) break; 
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, 50, y);

    // Footer
    ctx.fillStyle = '#95a5a6';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Silakan menunggu panggilan dari petugas', 300, 750);
    ctx.fillText(`Waktu: ${new Date().toLocaleString('id-ID')}`, 300, 780);

    return canvas.toBuffer('image/png');
}

// ===================================
// LOGIKA BOT (REVISI LENGKAP UNTUK 13 FIELD)
// ===================================

const USER_STATE = {};

const WA_QUESTIONS = [
    { key: 'nama_pasien', question: "🏥 *Selamat datang di Sistem Antrian Puskesmas!*\n\nSilakan masukkan *Nama Lengkap* Anda:", validation: (text) => text.length >= 3, error: "❌ Nama terlalu pendek. Mohon masukkan nama lengkap Anda:" },
    { key: 'nik', question: "📝 Masukkan *NIK (Nomor Induk Kependudukan)* 16 digit:", validation: (text) => /^\d{16}$/.test(text), error: "❌ NIK harus 16 digit angka. Silakan coba lagi:" },
    { key: 'tanggal_lahir', question: "📅 Masukkan *Tanggal Lahir* Anda (format: DD-MM-YYYY)\nContoh: 15-08-1990", validation: (text) => /^\d{2}-\d{2}-\d{4}$/.test(text), error: "❌ Format tanggal salah. Gunakan format DD-MM-YYYY\nContoh: 15-08-1990" },
    { key: 'jenis_kelamin', question: "👤 Pilih *Jenis Kelamin*:\nBalas dengan:\n*L* untuk Laki-laki\n*P* untuk Perempuan", validation: (text) => ["L", "P"].includes(text.toUpperCase()), error: "❌ Pilihan tidak valid. Balas *L* atau *P*:" },
    { key: 'pekerjaan', question: "💼 Apa *Pekerjaan* Anda? (Contoh: Pelajar, Swasta, PNS)", validation: (text) => text.length > 0, error: "❌ Pekerjaan tidak boleh kosong." },
    { key: 'agama', question: "🙏 Apa *Agama* Anda? (Contoh: Islam, Kristen)", validation: (text) => text.length > 0, error: "❌ Agama tidak boleh kosong." },
    { key: 'alamat_desa', question: "🏠 Masukkan *Nama Desa/Kelurahan* Anda:", validation: (text) => text.length > 0, error: "❌ Desa/Kelurahan tidak boleh kosong." },
    { key: 'alamat_dusun', question: "🏘️ Masukkan *Nama Dusun/Jalan* Anda:", validation: (text) => text.length > 0, error: "❌ Dusun/Jalan tidak boleh kosong." },
    { key: 'alamat_rtrw', question: "📍 Masukkan *RT/RW* Anda (Contoh: 001/002):", validation: (text) => /^\d{3}\/\d{3}$/.test(text), error: "❌ Format RT/RW salah. Gunakan format XXX/YYY\nContoh: 001/002" },
    { key: 'kepesertaan', question: "💳 Pilih *Kepesertaan* Anda:\n1. BPJS PBI\n2. BPJS Non PBI\n3. Umum\n4. Lainnya\n\nBalas dengan nomor (1/2/3/4):", validation: (text) => ["1", "2", "3", "4"].includes(text), error: "❌ Pilihan kepesertaan tidak valid. Balas dengan angka 1-4." },
    { key: 'nomor_asuransi', question: "Masukkan *Nomor Asuransi/BPJS* Anda (Ketik *TIDAK* jika tidak ada):", validation: (text) => text.length >= 0, optional: true }, // Perbaikan validasi optional
    { key: 'nama_keluarga', question: "Masukkan *Nama Kontak Keluarga* (Ketik *TIDAK* jika tidak ada):", validation: (text) => text.length >= 0, optional: true }, // Perbaikan validasi optional
    { key: 'keluhan', question: "🩺 Ceritakan *Keluhan atau Gejala* yang Anda alami:\n(Jelaskan dengan detail, minimal 5 karakter)", validation: (text) => text.length >= 5, error: "❌ Keluhan terlalu singkat. Mohon jelaskan lebih detail:" },
];

function getNextQuestion(currentStepKey) {
    const currentIndex = WA_QUESTIONS.findIndex(q => q.key === currentStepKey);
    return WA_QUESTIONS[currentIndex + 1];
}

/**
 * FUNGSI UTAMA BOT - TELAH DI-REFACTOR UNTUK MENGATASI ISU STATE
 */
async function handleIncomingMessage(message) {
    const senderId = message.from.replace("@c.us", "");
    const text = message.body.trim();
    const input = text.toUpperCase();

    // Abaikan pesan dari grup
    try {
        const chatObj = await message.getChat();
        if (chatObj.isGroup) return;
    } catch (err) {
        // Biarkan pesan masuk jika gagal mendapatkan info chat (asumsi chat pribadi)
    }

    // 1. PERINTAH AWAL / RESET
    if (input === "MULAI" || input === "DAFTAR" || !USER_STATE[senderId] || USER_STATE[senderId].step === "DONE") {
        USER_STATE[senderId] = { 
            step: WA_QUESTIONS[0].key, 
            data: { nomor_hp: senderId } 
        };
        console.log(`[BOT] START for ${senderId}`);
        return await message.reply(WA_QUESTIONS[0].question);
    }

    let state = USER_STATE[senderId];
    
    try {
        // Cek jika sedang dalam proses pendaftaran
        if (state.step === "PROCESSING") {
            return await message.reply("⏳ Pendaftaran Anda sedang diproses. Mohon tunggu sebentar atau ketik *MULAI* untuk mengulang.");
        }

        // Tentukan pertanyaan yang sedang DITUNGGU JAWABANNYA
        const currentIndex = WA_QUESTIONS.findIndex(q => q.key === state.step);
        
        // Pertanyaan yang baru saja dijawab oleh user adalah pertanyaan yang index-nya (currentIndex - 1)
        // Karena `state.step` selalu menunjuk ke pertanyaan berikutnya yang harus diajukan.
        const questionToValidateIndex = currentIndex - 1; 

        // Untuk pesan pertama setelah START, currentIndex adalah 0 (nama_pasien).
        // Jawaban yang masuk adalah jawaban untuk WA_QUESTIONS[0].
        // Kita gunakan logika ini: jika data untuk step saat ini belum ada, berarti jawaban ini adalah untuk step saat ini.
        let questionToValidate = WA_QUESTIONS[questionToValidateIndex];
        
        // Pengecualian: Saat user pertama kali menjawab 'nama_pasien', currentIndex = 0, questionToValidateIndex = -1.
        // Maka kita gunakan WA_QUESTIONS[0]
        if (questionToValidateIndex < 0) {
             questionToValidate = WA_QUESTIONS[0];
        }

        if (!questionToValidate) {
             return await message.reply("❌ Sistem mengalami kesalahan langkah. Ketik *MULAI* untuk mengulang.");
        }

        let isAnswerValid = true;
        let answerText = text;

        // 2. VALIDASI JAWABAN (terhadap questionToValidate)
        if (questionToValidate.optional && input === "TIDAK") {
            answerText = ""; // Set ke string kosong jika optional dan user ketik TIDAK
            isAnswerValid = true;
        } else if (!questionToValidate.validation(text)) {
            isAnswerValid = false;
        }

        if (!isAnswerValid) {
            // Gagal validasi, ulangi pertanyaan yang baru saja dijawab
            return await message.reply(questionToValidate.error || `❌ Input tidak valid. Mohon jawab kembali pertanyaan untuk ${questionToValidate.key}.`);
        }

        // 3. SIMPAN JAWABAN YANG VALID
        // Simpan jawaban ke data state
        if (questionToValidate.key === 'jenis_kelamin') {
            state.data[questionToValidate.key] = input === "L" ? "Laki-laki" : "Perempuan";
        } else if (questionToValidate.key === 'kepesertaan') {
            const kepesertaanMap = { "1": "BPJS PBI", "2": "BPJS Non PBI", "3": "Umum", "4": "Lainnya" };
            state.data[questionToValidate.key] = kepesertaanMap[input];
        } else {
            state.data[questionToValidate.key] = answerText;
        }
        
        console.log(`[BOT] Jawaban valid untuk ${questionToValidate.key}: ${state.data[questionToValidate.key].substring(0, 15)}...`);


        // 4. TENTUKAN PERTANYAAN BERIKUTNYA
        const nextQuestion = getNextQuestion(questionToValidate.key);

        if (nextQuestion) {
            // Lanjut ke pertanyaan berikutnya
            state.step = nextQuestion.key;
            return await message.reply(nextQuestion.question);
        } else {
            // Semua pertanyaan selesai, Lanjut ke PROSES PENDAFTARAN
            state.step = "PROCESSING";
            
            // Lanjutkan ke PROSES PENDAFTARAN di langkah 5
        }
        
        // 5. PROSES PENDAFTARAN (Hanya dipanggil setelah semua langkah selesai)
        if (state.step === "PROCESSING") {
             await message.reply("⏳ Sedang memproses pendaftaran Anda...");

            try {
                // 1. Generate nomor antrian
                const nomorAntrian = await getNextAntrianNumber();
                const today = new Date().toLocaleDateString('id-ID', {day: '2-digit', month: 'long', year: 'numeric'});

                // 2. Simpan ke Firestore
                const collectionPath = `artifacts/${appId}/public/data/antrian`;
                const dataToSave = {
                    ...state.data,
                    no_antrian: nomorAntrian,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    status: 0, // 0 = Menunggu
                    source: 'WhatsApp Bot',
                    // Pastikan field optional terisi jika kosong
                    nama_keluarga: state.data.nama_keluarga || "",
                    nomor_asuransi: state.data.nomor_asuransi || "", 
                };

                await db.collection(collectionPath).add(dataToSave);

                // 3. Generate gambar tiket
                const ticketBuffer = generateTicketImage(
                    nomorAntrian,
                    state.data.nama_pasien,
                    state.data.keluhan
                );

                // 4. Kirim gambar tiket ke WhatsApp
                const media = new MessageMedia('image/png', ticketBuffer.toString('base64'), `tiket_antrian_${nomorAntrian}.png`);
                
                await client.sendMessage(message.from, media, {
                    caption: `✅ *PENDAFTARAN BERHASIL!*\n\n` +
                            `Tanggal: ${today}\n` +
                            `📋 *Nomor Antrian Anda: A${nomorAntrian}*\n` +
                            `👤 Nama: ${state.data.nama_pasien}\n` +
                            `💳 Kepesertaan: ${state.data.kepesertaan}\n` +
                            `🩺 Keluhan: ${state.data.keluhan.substring(0, 50)}...\n\n` +
                            `*Penting:* Silakan datang ke Puskesmas dan menunjukkan NIK/tiket ini kepada petugas. Terima kasih.\n\n` +
                            `Ketik *MULAI* jika ingin mendaftar lagi.`
                });

                console.log(`✅ Pendaftaran berhasil: A${nomorAntrian} - ${state.data.nama_pasien}`);

                // Reset state
                state.step = "DONE";
                delete USER_STATE[senderId]; 

            } catch (error) {
                console.error("Error saat proses pendaftaran:", error);
                await message.reply("❌ Terjadi kesalahan sistem saat menyimpan antrian. Silakan coba lagi dengan ketik *MULAI*");
                delete USER_STATE[senderId];
            }
        } // End PROSES PENDAFTARAN

    } catch (err) {
        console.error("Error handle WA:", err);
        try {
            await message.reply("❌ Terjadi error tak terduga. Ketik *MULAI* untuk mengulang pendaftaran.");
        } catch (e) {
            console.warn("Gagal mengirim pesan error ke user:", e.message);
        }
        delete USER_STATE[senderId];
    }
}


// ===================================
// EXPRESS API (STATUS & SEND)
// ===================================

app.get('/status', async (req, res) => {
    try {
        const doc = await db.doc(WA_SESSION_DOC).get();
        res.json(doc.exists ? doc.data() : { status: "UNKNOWN" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/qr', async (req, res) => {
    try {
        const doc = await db.doc(WA_SESSION_DOC).get();
        res.json({ qr: doc.data()?.qrCode || null }); 
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/start', async (req, res) => {
    // Panggil startClient() yang sekarang menangani pembersihan
    startClient();
    res.json({ success: true, message: "WA Client starting..." });
});

app.post('/send', async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message)
        return res.status(400).json({ error: "Parameter kurang." });

    try {
        const r = await client.sendMessage(`${to}@c.us`, message);
        res.json({ success: true, id: r.id._serialized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint untuk memverifikasi kunci rahasia (CLIENT-SIDE SECURITY)
app.post('/check-secret', (req, res) => {
    const { secret } = req.body;
    
    // Bandingkan dengan SECRET_CODE yang didefinisikan di wa-gateway.js
    if (secret === SECRET_CODE) {
        res.json({ isValid: true });
    } else {
        res.json({ isValid: false });
    }
});


// ===================================
// EXPRESS API: USER MANAGEMENT (CRUD & LOGIN)
// ===================================
// Helper untuk mendapatkan referensi koleksi users
function getUsersCollectionRef() {
    // Jalur koleksi: settings (Collection) -> system_config (Document) -> users (Collection)
    return db.collection('settings').doc('system_config').collection('users');
}

// LOGIN: Otentikasi pengguna
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email dan password wajib diisi." });
    }

    try {
        const usersRef = getUsersCollectionRef();
        
        // 1. Cari pengguna berdasarkan email
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();
        if (snapshot.empty) {
            console.log(`[LOGIN] Email tidak ditemukan: ${email}`);
            return res.status(401).json({ error: "Email atau password salah." });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        // 2. Bandingkan password dengan hash yang tersimpan
        const passwordMatch = await bcrypt.compare(password, userData.password);

        if (!passwordMatch) {
            console.log(`[LOGIN] GAGAL: Password tidak cocok untuk email: ${email}`);
            return res.status(401).json({ error: "Email atau password salah." });
        }

        // 3. Login Sukses (Kirim data sesi ke frontend)
        delete userData.password;
        console.log(`[LOGIN] SUKSES: Login berhasil untuk email: ${email}`);
        res.json({ 
            success: true, 
            message: "Login berhasil.", 
            user: { id: userDoc.id, ...userData } 
        });

    } catch (err) {
        console.error("[LOGIN ERROR] Terjadi kesalahan:", err);
        res.status(500).json({ error: "Terjadi kesalahan server saat login. Cek log Node.js." }); 
    }
});

// READ: Ambil semua pengguna
app.get('/users', async (req, res) => {
    try {
        const usersRef = getUsersCollectionRef();
        const snapshot = await usersRef.get();
        
        const users = [];
        snapshot.forEach(doc => {
            const userData = doc.data();
            delete userData.password; // JANGAN KIRIM PASSWORD!
            
            users.push({
                id: doc.id,
                ...userData
            });
        });

        res.json(users);
    } catch (err) {
        console.error("Error getting users:", err);
        res.status(500).json({ error: "Gagal mengambil data pengguna." });
    }
});


// CREATE: Tambah pengguna baru
app.post('/users', async (req, res) => {
    const { email, password, nama, role } = req.body;

    if (!email || !password || !nama || !role) {
        return res.status(400).json({ error: "Data pengguna (email, password, nama, role) tidak lengkap." });
    }

    try {
        const usersRef = getUsersCollectionRef();

        // 1. Cek apakah email sudah terdaftar
        const existingUser = await usersRef.where('email', '==', email).limit(1).get();
        if (!existingUser.empty) {
            return res.status(409).json({ error: "Email sudah terdaftar." });
        }

        // 2. Hash Password (enkripsi)
        const hashedPassword = await bcrypt.hash(password, 10); 

        // 3. Simpan ke Firestore
        const newUser = {
            email: email,
            password: hashedPassword,
            nama: nama,
            role: role,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const result = await usersRef.add(newUser);
        
        // Kirim respons tanpa password
        delete newUser.password; 
        res.json({ 
            success: true, 
            message: "Pengguna berhasil ditambahkan.",
            user: { id: result.id, ...newUser }
        });

    } catch (err) {
        console.error("Error creating user:", err);
        res.status(500).json({ error: "Gagal menambahkan pengguna." });
    }
});

// UPDATE: Edit data pengguna
app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { nama, role, newPassword } = req.body;
    
    if (!nama || !role) {
        return res.status(400).json({ error: "Nama atau Role tidak boleh kosong." });
    }

    try {
        const usersRef = getUsersCollectionRef();
        const updateData = {
            nama: nama,
            role: role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Jika ada password baru, hash dan update
        if (newPassword && newPassword.length > 5) {
            updateData.password = await bcrypt.hash(newPassword, 10);
        }

        await usersRef.doc(id).update(updateData);
        
        res.json({ success: true, message: "Data pengguna berhasil diperbarui." });

    } catch (err) {
        console.error(`Error updating user ${id}:`, err);
        res.status(500).json({ error: "Gagal memperbarui data pengguna." });
    }
});

// DELETE: Hapus pengguna
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const usersRef = getUsersCollectionRef();
        await usersRef.doc(id).delete();
        
        res.json({ success: true, message: "Pengguna berhasil dihapus." });
    } catch (err) {
        console.error(`Error deleting user ${id}:`, err);
        res.status(500).json({ error: "Gagal menghapus pengguna." });
    }
});


// ===================================
// RESET STATUS PADA SAAT STARTUP (KODE BARU)
// ===================================

async function resetStatusOnStartup() {
    try {
        const doc = await db.doc(WA_SESSION_DOC).get();
        // Cek status lama sebelum memulai klien WA
        if (doc.exists && doc.data().status === 'CONNECTED') {
            console.log("[STARTUP] Status lama terdeteksi (CONNECTED). Mereset ke DISCONNECTED.");
            await updateWaStatusInFirestore(
                "DISCONNECTED", 
                null, 
                "Status direset karena server baru saja dimulai ulang."
            );
        }
    } catch (error) {
        console.error("[STARTUP ERROR] Gagal reset status:", error);
    }
}


// ===================================
// JALANKAN SERVER & START WA CLIENT OTOMATIS (MODIFIKASI)
// ===================================
server.listen(PORT, async () => {
    console.log(`🚀 Server Express/Socket.IO berjalan di http://localhost:${PORT}`);
    // Panggil resetStatusOnStartup sebelum startClient()
    await resetStatusOnStartup(); 
    startClient(); 
});