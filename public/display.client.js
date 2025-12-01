/**
 * Logika Sisi Klien untuk Display Antrian Publik (FIXED: Tanpa Auth)
 * Menggunakan koneksi Firebase Firestore real-time.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// 🛑 Hapus import Auth yang tidak digunakan
// import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, onSnapshot, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 

// --- KONFIGURASI FIREBASE (Wajib Diisi Lagi!) ---
const FIREBASE_CONFIG = {
    // DATA DARI FIREBASE CONSOLE ANDA
    apiKey: "AIzaSyCrfnerj9mYsivfDhGP65vEMRovyfsON_E", 
    authDomain: "antrian-online-355c7.firebaseapp.com",
    projectId: "antrian-online-355c7",
    storageBucket: "antrian-online-355c7.firebasestorage.app",
    messagingSenderId: "1072172499150",
    appId: "1:1072172499150:web:1dd83762ae07ba61a3d09f",
    measurementId: "G-BMDTP9ES65"
};

const appId = FIREBASE_CONFIG.appId;
const firebaseConfig = FIREBASE_CONFIG;

// 🛑 Hapus let auth;
let db;

// --- FUNGSI UTILITY & INIT ---

const getAntrianCollectionPath = () => {
    return `artifacts/${appId}/public/data/antrian`;
};

const getTodayStartTimestamp = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

// Fungsi untuk inisialisasi Firebase
const initFirebase = async () => {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        // 🛑 Hapus inisialisasi Auth: auth = getAuth(app);
        
        // 🛑 Hapus kode signInAnonymously:
        /*
        await signInAnonymously(auth);
        */
        
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        // Mengubah pesan error jika inisialisasi gagal
        document.getElementById('queue-list-display').innerHTML = '<p class="text-center text-red-500 p-4">Error koneksi Firebase. Cek konsol.</p>';
        return;
    }

    // 🛑 Hapus onAuthStateChanged: Langsung mulai listener
    startDisplayListener();
};

/**
 * Fungsi untuk memperbarui jam dan tanggal di header Display.
 */
const updateTime = () => {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleTimeString('id-ID');
    document.getElementById('current-date').textContent = now.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    
    // --- PERBAIKAN TANGGAL DI HEADER ANTRIAN MENUNGGU (Mengisi Span) ---
    const antrianDateEl = document.getElementById('antrian-date'); // ID ini harus ada di display.html
    if (antrianDateEl) {
        // Mengisi dengan format tanggal yang lebih standar (04/11/2025)
        antrianDateEl.textContent = now.toLocaleDateString('id-ID'); 
    }
    // --- AKHIR PERBAIKAN TANGGAL ---
};

// --- REAL-TIME DISPLAY LOGIC ---

const startDisplayListener = () => {
    if (!db) return;
    
    // Panggil updateTime sekali untuk mengisi tanggal di header antrian
    updateTime(); 

    const todayStart = getTodayStartTimestamp();
    const q = query(
        collection(db, getAntrianCollectionPath()),
        where('timestamp', '>=', todayStart)
    );

    onSnapshot(q, (snapshot) => {
        const allAntrian = [];
        snapshot.forEach(doc => {
            allAntrian.push({ id: doc.id, ...doc.data() });
        });
        
        allAntrian.sort((a, b) => (a.no_antrian || 0) - (b.no_antrian || 0));

        updateDisplayUI(allAntrian);
    }, (error) => {
        console.error("Error fetching antrian data for display: ", error);
        // Tampilkan pesan error spesifik jika listener gagal
        document.getElementById('queue-list-display').innerHTML = '<p class="text-center text-red-500 p-4">Gagal memuat data. Periksa Rules Firestore.</p>';
    });
};

/**
 * Memperbarui tampilan Display Antrian berdasarkan data real-time
 */
const updateDisplayUI = (antrianData) => {
    const callingNumberEl = document.getElementById('current-calling-number');
    const callingLoketEl = document.getElementById('current-calling-loket');
    const callingPoliEl = document.getElementById('current-calling-poli');
    const queueListEl = document.getElementById('queue-list-display');

    // 1. Cari antrian yang sedang dipanggil (Status 1)
    const currentlyCalling = antrianData.find(a => a.status === 1);
    
    // 2. Cari 5 antrian yang masih menunggu (Status 0)
    const waitingQueue = antrianData.filter(a => a.status === 0).slice(0, 5); 

    // --- UPDATE NOMOR YANG DIPANGGIL ---
    if (currentlyCalling) {
        callingNumberEl.textContent = `A${currentlyCalling.no_antrian}` || '---';
        callingPoliEl.textContent = `Tujuan: ${currentlyCalling.poli_tujuan || 'Poli Umum'}`;
        callingLoketEl.textContent = `LOKET 1`; 
        
        // Efek visual berkedip
        document.querySelector('.bg-red-600').classList.add('animate-pulse');
    } else {
        // Jika tidak ada yang dipanggil
        callingNumberEl.textContent = 'A00';
        callingLoketEl.textContent = 'LOKET PENDAFTARAN';
        callingPoliEl.textContent = 'SILAKAN AMBIL NOMOR ANTRIAN';
        document.querySelector('.bg-red-600').classList.remove('animate-pulse');
    }
    
    // --- UPDATE DAFTAR TUNGGU ---
    if (waitingQueue.length > 0) {
        queueListEl.innerHTML = waitingQueue.map((item, index) => {
            const priorityClass = index === 0 ? 'bg-yellow-200 font-bold' : 'bg-gray-100';
            return `
                <div class="flex justify-between items-center p-3 rounded-lg ${priorityClass} shadow-sm border-l-4 border-yellow-500">
                    <span class="text-xl font-semibold text-gray-800">A${item.no_antrian || '---'}</span>
                    <span class="text-sm text-gray-600">${item.poli_tujuan || 'Umum'}</span>
                </div>
            `;
        }).join('');
    } else {
        queueListEl.innerHTML = '<p class="text-center text-green-600 font-bold p-8">Tidak ada antrian dalam daftar tunggu.</p>';
    }
};

// --- FUNGSI FULLSCREEN ---

const toggleFullScreen = () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) { 
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { 
            elem.msRequestFullscreen();
        }
        document.getElementById('fullscreen-btn').textContent = 'Keluar Layar Penuh';
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { 
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { 
            document.msExitFullscreen();
        }
        document.getElementById('fullscreen-btn').textContent = 'Layar Penuh';
    }
};


// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // Inisialisasi Jam (untuk header)
    updateTime();
    setInterval(updateTime, 1000); // Perbarui setiap detik

    // Atur tombol Fullscreen
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullScreen);

    // Mulai koneksi Firebase
    initFirebase();
});