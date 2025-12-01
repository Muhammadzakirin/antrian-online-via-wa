/**
 * Logika Sisi Klien untuk Dashboard Petugas Puskesmas (FINALIZED FOR AUTH)
 * Mengintegrasikan Firebase Auth, Firestore, dan kini ditambahkan Modul Profile & Edit.
 * * CATATAN PENTING: Fungsi window.toggleSidebar() telah dihapus dari sini 
 * karena sudah dipindahkan ke tag <script> di dashboard.html 
 * untuk memastikan kontrol layout Grid/Sidebar berjalan lancar.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"; // Import updatePassword
import { getFirestore, doc, onSnapshot, collection, query, where, Timestamp, addDoc, updateDoc, getDocs, orderBy, limit, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
// import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js"; // <<< DIHAPUS: FIREBASE STORAGE TIDAK DIGUNAKAN >>>
import { initPasienModule } from "./pasien.module.js";
import { initLaporanModule } from "./laporan.module.js";
import { initPengaturanModule } from "./pengaturan.module.js";

const SYSTEM_INFO_PATH = 'settings/general'; 
const WA_API_BASE_URL = 'http://localhost:3000'; 
const USER_STORAGE_KEY = 'puskesmas_user'; // Kunci Local Storage dari dashboard.html

// --- KONFIGURASI FIREBASE & AUTH (DATA ASLI ANDA) ---
const FIREBASE_CONFIG = {
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
let app, db, auth, userId = null; // db, auth, dan app diakses oleh modul profile
let isAuthReady = false;
let currentAntrianData = []; 

// <<< Global Storage untuk Instance Module >>>
window.pengaturanModule = null;


// 🚨 FUNGSI BARU: Mengambil data pengguna dari Local Storage
const getLocalStorageUser = () => {
    const userString = localStorage.getItem(USER_STORAGE_KEY);
    if (userString) {
        try {
            return JSON.parse(userString);
        } catch (e) {
            console.error("Local Storage User data corrupt.", e);
            return null;
        }
    }
    return null;
};


// Inisialisasi Firebase dan Auth
const initFirebase = async () => {
    if (!firebaseConfig.apiKey) {
        document.getElementById('content-container').innerHTML = '<p class="text-center text-red-500 font-bold">ERROR: Konfigurasi Firebase belum diisi dengan benar.</p>';
        return;
    }
    
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    // Gunakan Local Storage User untuk menentukan status UI awal
    const localUser = getLocalStorageUser();
    if (localUser) {
        userId = localUser.uid; 
        document.getElementById('user-display-name').textContent = localUser.nama || localUser.email.split('@')[0];
    } else {
        document.getElementById('user-display-name').textContent = 'Anonim/Error';
        return; 
    }


    onAuthStateChanged(auth, async (user) => {
    const userData = localStorage.getItem('puskesmas_user');
    
    if (userData) {
        const parsedUser = JSON.parse(userData);
        userId = parsedUser.uid;
        
        // FETCH NAMA LENGKAP DARI FIRESTORE (Diperlukan oleh modul profile baru)
        try {
            const userDocRef = doc(db, 'users', parsedUser.uid);
            const userDocSnap = await getDoc(userDocRef);
            
            if (userDocSnap.exists()) {
                const userDataFromDB = userDocSnap.data();
                const displayName = userDataFromDB.name || parsedUser.email.split('@')[0];
                
                // TAMPILKAN NAMA LENGKAP
                document.getElementById('user-display-name').textContent = displayName;
                
                // 🚨 PERBARUI LOCAL STORAGE DENGAN DATA TERBARU DARI DB (PENTING UNTUK MODUL PROFILE)
                const updatedUser = { ...parsedUser, ...userDataFromDB };
                localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedUser));

                // <<< KODE BARU: UPDATE FOTO DI HEADER >>>
                const headerPhoto = document.getElementById('header-profile-photo');
                if (headerPhoto) {
                    // Gunakan data dari DB (atau fallback ke default karakter)
                    headerPhoto.src = userDataFromDB.photoURL || './assets/karakter/karakter_1.jpg';
                }
                // <<< AKHIR KODE BARU >>>


            } else {
                // Jika tidak ada di Firestore, gunakan email
                document.getElementById('user-display-name').textContent = parsedUser.email.split('@')[0];
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            document.getElementById('user-display-name').textContent = parsedUser.email.split('@')[0];
        }
        
    } else {
        window.location.href = 'login.html';
        return;
    }
    
    isAuthReady = true;
    window.pengaturanModule = initPengaturanModule(db, auth);
    
    renderView('Dashboard');
    startAntrianListener();
    fetchAndRenderSystemInfo();
    
    checkWaStatus();
    setInterval(checkWaStatus, 5000);
});
};

// --- FUNGSI UTILITY ---

const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleDateString('id-ID', { month: 'long' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
};

const getAntrianCollectionPath = () => {
    return `artifacts/${appId}/public/data/antrian`;
};

// 🚨 FUNGSI UTILITY BARU: Menghitung Umur
const calculateAgeInYears = (dateString) => {
    if (!dateString) return 999; 
    
    // Asumsi format DD-MM-YYYY (dari bot) atau YYYY-MM-DD (dari input date)
    const parts = dateString.includes('-') ? dateString.split('-') : null; 
    let birthDate;

    if (parts && parts[0].length === 4) { // Format YYYY-MM-DD (Input HTML Date)
        birthDate = new Date(dateString);
    } else if (parts && parts.length === 3 && parts[2].length === 4) { // Format DD-MM-YYYY (dari Bot, atau custom)
        birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`); 
    } else {
        return 999; 
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}


// 🚨 FUNGSI UTILITY BARU: Penentu Poli Cerdas
const determinePoli = (patientData) => {
    const keluhan = (patientData.keluhan || patientData.keluhan_pasien || '').toLowerCase();
    const jk = (patientData.jenis_kelamin || '').toLowerCase();
    const tglLahir = patientData.tanggal_lahir;
    const umur = calculateAgeInYears(tglLahir);
    
    // 1. UGD (Gawat Darurat / Kecelakaan)
    if (keluhan.includes('kecelakaan') || keluhan.includes('tabrakan') || keluhan.includes('luka') || keluhan.includes('ugd') || keluhan.includes('gawat darurat')) {
        return 'UGD (Gawat Darurat)';
    }
    
    // 2. Gigi
    if (keluhan.includes('gigi') || keluhan.includes('gusi') || keluhan.includes('cabut')) {
        return 'Gigi';
    }
    
    // 3. KIA/Bidan (Ibu Hamil & Anak-Anak < 17 tahun)
    if (jk === 'perempuan' && (keluhan.includes('hamil') || keluhan.includes('bidan') || keluhan.includes('kandungan'))) {
        return 'KIA/Bidan (Hamil)';
    }
    // Anak-anak (Umur <= 17 tahun)
    if (umur <= 17) {
        return 'KIA/Bidan (Anak)';
    }
    
    // 4. Konseling (Jika mengarah ke mental/psikis)
    if (keluhan.includes('stress') || keluhan.includes('cemas') || keluhan.includes('konsultasi') || keluhan.includes('psikis')) {
        return 'Konseling';
    }
    
    // 5. Rawat Inap (Jika keluhan mengarah ke kondisi parah/memerlukan observasi)
    if (keluhan.includes('rawat inap') || keluhan.includes('inap') || keluhan.includes('dirawat')) {
        return 'Rawat Inap'; 
    }
    
    // 6. Default ke Rawat Jalan Umum
    return 'Umum (Rawat Jalan)'; 
};
window.determinePoli = determinePoli; 


const fetchAndRenderSystemInfo = async () => { 
    if (!db) return;
    const taglineElement = document.getElementById('system-tagline-display');
    if (!taglineElement) return;

    try {
        const docRef = doc(db, SYSTEM_INFO_PATH);
        const docSnap = await getDoc(docRef);

        let tagline = "Selamat datang di sistem antrian Puskesmas"; 

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.tagline) {
                tagline = data.tagline;
            }
        }
        
        taglineElement.textContent = tagline;
    } catch (e) {
        console.warn("Gagal mengambil info sistem untuk header:", e);
        taglineElement.textContent = "Sistem gagal load info.";
    }
}


// ===============================================
// LOGIKA WA GATEWAY (POLLING & START API)
// ===============================================

const WA_API_STATUS_URL = `${WA_API_BASE_URL}/status`;
const WA_API_START_URL = `${WA_API_BASE_URL}/start`;

async function checkWaStatus() {
    if (window.pengaturanModule) {
        return; 
    }
}

async function startWaClient() {
    // Fungsi ditangani di pengaturan.module.js
}
window.startWaClient = startWaClient; 


// --- FIREBASE LISTENERS (REAL-TIME DATA) ---

const getTodayStartTimestamp = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); 
    return Timestamp.fromDate(today); 
};

const startAntrianListener = () => {
    if (!db) return;

    // 🚨 PERBAIKAN: Gunakan WHERE untuk filter hanya antrian Hari Ini
    const q = query(
        collection(db, getAntrianCollectionPath()),
        where('timestamp', '>=', getTodayStartTimestamp()), 
        orderBy('timestamp', 'asc') // Urutkan berdasarkan waktu masuk
    );

    onSnapshot(q, (snapshot) => {
        currentAntrianData = [];
        snapshot.forEach(doc => {
            currentAntrianData.push({ id: doc.id, ...doc.data() });
        });
        
        currentAntrianData.sort((a, b) => (a.no_antrian || 0) - (b.no_antrian || 0));

        updateDashboardUI();
        
        if (document.getElementById('antrian-menunggu-list')) {
            renderAntrianList('antrian-menunggu-list', [0]); 
            renderAntrianList('antrian-diproses-list', [1]); 
        }
    }, (error) => {
        console.error("Error fetching antrian data: ", error);
        const tableBody = document.getElementById('antrian-table-body');
        if(tableBody) {
             tableBody.innerHTML = 
            '<tr><td colspan="6" class="p-4 text-center text-red-500">Gagal memuat data antrian. Cek konsol.</td></tr>';
        }
    });
};

// --- UPDATE UI BERDASARKAN DATA TERBARU ---

const updateDashboardUI = () => {
    if (!isAuthReady) return;

    const totalBaru = currentAntrianData.length;
    const totalDiproses = currentAntrianData.filter(a => a.status === 1 || a.status === 2).length;
    const totalTersisa = currentAntrianData.filter(a => a.status === 0).length;

    if (document.getElementById('stat-baru')) {
        document.getElementById('stat-baru').textContent = totalBaru;
        document.getElementById('stat-diproses').textContent = totalDiproses;
        document.getElementById('stat-tersisa').textContent = totalTersisa;
    }

    const tableBody = document.getElementById('antrian-table-body');
    if (!tableBody) return; 

    if (currentAntrianData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">Tidak ada antrian hari ini.</td></tr>'; 
        return;
    }

    let rowsHtml = '';
    currentAntrianData.forEach(antrian => {
        const statusText = antrian.status === 0 ? 'Menunggu' : (antrian.status === 1 ? 'Diproses' : 'Selesai');
        const statusClass = antrian.status === 0 ? 'bg-yellow-100 text-yellow-800' : (antrian.status === 1 ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800');
        
        // 🚨 MENENTUKAN POLI MENGGUNAKAN LOGIKA CERDAS
        const poliTujuan = antrian.poli_tujuan || determinePoli(antrian); 
        
        let actionButton;
        if (antrian.status === 0) {
            actionButton = `<button onclick="prosesAntrian('${antrian.id}')" class="bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1 rounded text-xs transition">Proses</button>`;
        } else if (antrian.status === 1) {
            actionButton = `<button onclick="selesaiAntrian('${antrian.id}')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-xs transition">Selesaikan</button>`;
        } else {
             actionButton = `<span class="text-gray-400 text-xs">Selesai</span>`;
        }


        rowsHtml += `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${antrian.no_antrian || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${antrian.nama_pasien || '-'}</td>
                <td class="px-6 py-4 text-sm text-red-700 font-medium whitespace-normal max-w-xs">${antrian.keluhan || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-bold">${poliTujuan}</td> 
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                        ${statusText}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    ${actionButton}
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rowsHtml;
};

// --- FUNGSI PEMANGGIL ANTRIAN BARU (CALL NEXT) ---

window.callNextAntrian = async () => {
    if (!db) return alert("Koneksi database belum siap.");

    const antrianRef = collection(db, getAntrianCollectionPath());
    const todayDate = new Date().toDateString();

    try {
        const callingQuery = query(
            antrianRef,
            where('status', '==', 1) 
        );
        const callingSnapshot = await getDocs(callingQuery);
        
        const batch = writeBatch(db);

        callingSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const docDate = data.timestamp ? data.timestamp.toDate().toDateString() : '';
            if (docDate === todayDate) {
                batch.update(doc(db, getAntrianCollectionPath(), docSnap.id), {
                    status: 2
                });
            }
        });

        const waitingQuery = query(
            antrianRef,
            where('status', '==', 0), 
            where('timestamp', '>=', getTodayStartTimestamp()), // Filter Hari Ini
            orderBy('no_antrian', 'asc'), 
            limit(1)
        );

        const waitingSnapshot = await getDocs(waitingQuery);

        const nextAntrianDoc = waitingSnapshot.docs[0];
        
        if (!nextAntrianDoc) {
            alert("Tidak ada antrian yang menunggu hari ini.");
            await batch.commit(); 
            return;
        }

        const nextAntrianData = nextAntrianDoc.data();
        const suggestedPoli = nextAntrianData.poli_tujuan || determinePoli(nextAntrianData);
        
        batch.update(doc(db, getAntrianCollectionPath(), nextAntrianDoc.id), {
            status: 1,
            poli_tujuan: suggestedPoli, 
        });

        await batch.commit();
        alert(`Berhasil memanggil antrian: A${nextAntrianData.no_antrian} ke ${suggestedPoli}`);

    } catch (error) {
        console.error("Error saat memanggil antrian: ", error);
        alert("Gagal memanggil antrian. Cek konsol.");
    }
};

// --- LOGIKA AKSI ANTRIAN (FIREBASE UPDATE) ---

const updateAntrianStatus = async (antrianId, newStatus, actionName) => {
    if (!db) {
        showSimpleModal('Error', 'Sistem belum siap. Coba refresh.');
        return;
    }

    try {
        const antrianDocRef = doc(db, getAntrianCollectionPath(), antrianId);
        await updateDoc(antrianDocRef, {
            status: newStatus,
        });
    } catch (error) {
        console.error(`Error updating status to ${actionName}: `, error);
        showSimpleModal('Error', `Gagal memperbarui status: ${error.message}`);
    }
};

window.prosesAntrian = (antrianId) => {
    updateAntrianStatus(antrianId, 1, 'DIPROSES');
};

window.selesaiAntrian = (antrianId) => {
    updateAntrianStatus(antrianId, 2, 'SELESAI');
};


// --- FUNGSI SUBMIT FORM MANUAL REGISTRATION ---

const saveManualRegistration = async (formData) => {
    if (!db || !userId) {
        showSimpleModal('Error', 'Sistem belum siap. Coba refresh.');
        return false;
    }
    
    try {
        const latestAntrian = currentAntrianData.slice().sort((a, b) => (b.no_antrian || 0) - (a.no_antrian || 0))[0];
        const nextAntrianNumber = (latestAntrian ? latestAntrian.no_antrian : 0) + 1;
        
        // 🚨 TENTUKAN POLI CERDAS SAAT REGISTRASI MANUAL
        const suggestedPoli = determinePoli(formData);

        const dataToSave = {
            ...formData,
            no_antrian: nextAntrianNumber,
            timestamp: Timestamp.now(),
            status: 0, // 0 = Menunggu
            source: 'Manual Dashboard',
            petugas_id: userId,
            poli_tujuan: suggestedPoli // SIMPAN SARAN POLI
        };
        Object.keys(dataToSave).forEach(key => dataToSave[key] === null && delete dataToSave[key]);

        await addDoc(collection(db, getAntrianCollectionPath()), dataToSave);

        showSimpleModal('Sukses!', `Pasien ${formData.nama_pasien} berhasil didaftarkan. No. Antrian: ${nextAntrianNumber}. Poli disarankan: ${suggestedPoli}`);
        return true;
    } catch (error) {
        console.error("Error during manual registration:", error);
        showSimpleModal('Error', `Gagal menyimpan data: ${error.message}`);
        return false;
    }
};

// ... [Kode renderAntrianList, renderView, createAntrianView, Modal Utilities, Logout Handlers] ... 
const renderAntrianList = (containerId, allowedStatuses) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filteredList = currentAntrianData.filter(antrian => 
        allowedStatuses.includes(antrian.status || 0)
    );
    
    if (filteredList.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-4">Tidak ada antrian di kategori ini.</p>';
        return;
    }

    let listHtml = '';
    filteredList.forEach(antrian => {
        const statusText = antrian.status === 0 ? 'Menunggu' : 'Diproses';
        const statusClass = antrian.status === 0 ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800';
        const actionText = antrian.status === 0 ? 'Proses' : 'Selesai';
        const actionFunction = antrian.status === 0 ? `prosesAntrian('${antrian.id}')` : `selesaiAntrian('${antrian.id}')`;
        const actionBg = antrian.status === 0 ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-green-500 hover:bg-green-600';
        const poliTujuan = antrian.poli_tujuan || determinePoli(antrian); // Tentukan Poli di sini

        listHtml += `
            <div class="p-4 border rounded-lg shadow-sm flex justify-between items-center bg-white hover:bg-gray-50 transition">
                <div>
                    <span class="text-2xl font-extrabold text-red-600 block">${antrian.no_antrian || '-'}</span>
                    <span class="text-base font-semibold text-gray-800">${antrian.nama_pasien || 'Pasien Baru'}</span>
                    <p class="text-xs text-gray-500 mt-1">Poli: ${poliTujuan}</p>
                    <p class="text-xs text-gray-500 mt-1">Keluhan: ${antrian.keluhan ? antrian.keluhan.substring(0, 30) + (antrian.keluhan.length > 30 ? '...' : '') : 'Tidak ada'}</p>
                </div>
                <div class="text-right space-y-2">
                    <span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span>
                    <button onclick="${actionFunction}" class="w-full ${actionBg} text-white px-3 py-1 rounded text-sm transition">
                        ${actionText}
                    </button>
                </div>
            </div>
        `;
    });
    container.innerHTML = listHtml;
};

// <<< MODIFIKASI FUNGSI renderView >>>
const renderView = (viewName) => {
    const container = document.getElementById('content-container');
    const titleElement = document.getElementById('main-title');

    titleElement.textContent = viewName.replace(/([A-Z])/g, ' $1').trim();
    
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.getElementById(viewName);
    if (activeItem) activeItem.classList.add('active');
    
    // 🚨 HAPUS PANGGILAN window.toggleSidebar() di sini untuk menghindari bug
    // const sidebar = document.getElementById('sidebar');
    // if (sidebar.classList.contains('sidebar-visible')) window.toggleSidebar(); 
    
    switch (viewName) {
        case 'Dashboard':
            container.innerHTML = createDashboardContent();
            updateDashboardUI();
            break;

        case 'Antrian':
            container.innerHTML = createAntrianView();
            renderAntrianList('antrian-menunggu-list', [0]);
            renderAntrianList('antrian-diproses-list', [1]);
            break;

        case 'DataPasien':
            const { renderPasienView } = initPasienModule(db, getAntrianCollectionPath);
            renderPasienView();
            break;

        case 'DisplayAntrian':
            const displayUrl = 'display.html'; 
            window.open(displayUrl, '_blank'); 
            container.innerHTML = `
                <div class="p-6 bg-blue-100 border-l-4 border-blue-500 rounded-lg">
                    <p class="font-bold text-blue-800">Display Antrian telah dibuka!</p>
                    <p class="text-blue-700">Silakan lihat di tab browser yang baru terbuka.</p>
                </div>`;
            break;

        case 'Laporan':
            const { renderLaporanView } = initLaporanModule(db, getAntrianCollectionPath);
            renderLaporanView();
            break;

        case 'Pengaturan':
            if (window.pengaturanModule) { 
                window.pengaturanModule.renderPengaturanView();
                checkWaStatus(); 
            } else {
                 container.innerHTML = `
                    <div class="p-6 bg-yellow-100 border-l-4 border-yellow-500 rounded-lg">
                        <p class="font-bold text-yellow-800">Sistem Belum Siap</p>
                        <p class="text-yellow-700">Database atau Autentikasi belum terinisialisasi. Coba sebentar lagi.</p>
                    </div>`;
            }
            break;

        default:
            container.innerHTML = '<div class="p-6 bg-gray-100 rounded-lg">Halaman tidak ditemukan.</div>';
            break;
    }
};


window.switchView = renderView; 

const createDashboardContent = () => {
    return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow-lg border-l-4 border-green-500 transition duration-300 hover:shadow-xl">
                <p class="text-sm font-medium text-gray-500">Pasien Baru Hari Ini (Dari WA)</p>
                <p id="stat-baru" class="text-4xl font-extrabold text-green-600 mt-1">0</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-lg border-l-4 border-blue-500 transition duration-300 hover:shadow-xl">
                <p class="text-sm font-medium text-gray-500">Pasien Sudah Diproses (Ke Web Resmi)</p>
                <p id="stat-diproses" class="text-4xl font-extrabold text-blue-600 mt-1">0</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-lg border-l-4 border-red-500 transition duration-300 hover:shadow-xl">
                <p id="stat-tersisa" class="text-4xl font-extrabold text-red-600 mt-1">0</p>
            </div>
        </div>
        
        <div class="bg-white p-6 rounded-xl shadow-xl mb-8 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0 md:space-x-4">
             <h2 class="text-xl font-semibold text-gray-800 mb-0">Manajemen Antrian Cepat</h2>
             
             <button id="btn-call-next" onclick="callNextAntrian()" class="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-150">
                 Panggil Antrian Berikutnya
             </button>
             
             <button onclick="showManualRegistrationModal()" class="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-150">
                 + Daftar Pasien Manual
             </button>
        </div>

        <div class="bg-white p-6 rounded-xl shadow-xl overflow-x-auto">
            <h2 class="text-2xl font-semibold text-gray-800 mb-4">Tabel Antrian Pasien Hari Ini</h2>
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">No</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nama Pasien</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Keluhan</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Saran Poli</th> <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
                    </tr>
                </thead>
                <tbody id="antrian-table-body" class="bg-white divide-y divide-gray-200">
                    <tr><td colspan="6" class="p-4 text-center text-gray-500">Memuat data...</td></tr>
                </tbody>
            </table>
        </div>
    `;
};

const createAntrianView = () => {
    return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-xl shadow-xl border-t-4 border-yellow-500">
                <h2 class="text-2xl font-bold text-yellow-700 mb-4">Antrian Menunggu Panggilan</h2>
                <p class="text-gray-600 mb-4">Antrian yang statusnya masih menunggu verifikasi pendaftaran.</p>
                <div id="antrian-menunggu-list" class="space-y-3 max-h-[60vh] overflow-y-auto">
                    <div class="p-4 text-center text-gray-500">Memuat daftar antrian...</div>
                </div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-xl border-t-4 border-blue-500">
                <h2 class="text-2xl font-bold text-blue-700 mb-4">Antrian Sedang Diproses</h2>
                <p class="text-gray-600 mb-4">Antrian yang sudah dipanggil dan sedang mendapatkan layanan.</p>
                <div id="antrian-diproses-list" class="space-y-3 max-h-[60vh] overflow-y-auto">
                    <div class="p-4 text-center text-gray-500">Memuat daftar antrian...</div>
                </div>
            </div>
        </div>
    `;
}

// 🛑 HAPUS FUNGSI toggleSidebar LAMA DARI SINI
// window.toggleSidebar = ...

// 🛑 HAPUS FUNGSI toggleProfileMenu LAMA DARI SINI
// window.toggleProfileMenu = ...


window.showSimpleModal = (title, message) => {
    const existingModal = document.getElementById('simple-modal');
    if (existingModal) existingModal.remove();
    
    const modalHtml = `
        <div id="simple-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100] p-4">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
                <div class="p-6 border-b">
                    <h3 class="text-xl font-bold text-gray-800">${title}</h3>
                </div>
                <div class="p-6">
                    <p class="text-gray-700">${message}</p>
                </div>
                <div class="p-4 border-t text-right">
                    <button onclick="document.getElementById('simple-modal').remove()" class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Tutup</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.showManualRegistrationModal = () => {
    document.getElementById('manual-reg-modal').classList.remove('hidden');
    document.getElementById('manual-reg-form').reset();
    document.getElementById('manual-reg-modal').onclick = (e) => {
        if (e.target.id === 'manual-reg-modal') {
            window.hideManualRegistrationModal();
        }
    };
};

window.hideManualRegistrationModal = () => {
    document.getElementById('manual-reg-modal').classList.add('hidden');
    document.getElementById('manual-reg-modal').onclick = null;
};

window.handleLogout = async () => {
    if (!auth) return;
    
    if (!confirm("Apakah Anda yakin ingin keluar dari sesi ini?")) return;

    try {
        await signOut(auth);
        
        // 🚨 HAPUS LOCAL STORAGE UNTUK MEMASTIKAN CLEAN LOGOUT
        localStorage.removeItem(USER_STORAGE_KEY); 
        window.location.href = 'login.html'; // Redirect ke halaman login
        
    } catch (error) {
        console.error("Logout Error:", error);
        showSimpleModal('Error Logout', `Gagal keluar: ${error.message}`);
    }
};

// --- SETUP AWAL ---

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-date-header').textContent = formatDate(new Date());
    document.getElementById('current-date-header').classList.remove('hidden');

    const logoutButtons = [
        document.getElementById('logout-button-sidebar-mobile'), 
    ];
    logoutButtons.forEach(btn => {
        if (btn) btn.addEventListener('click', window.handleLogout);
    });
    
    // Logika penutupan menu profile diubah karena menggunakan modal
    document.addEventListener('click', (event) => {
        const menu = document.getElementById('profile-menu');
        const profileModal = document.getElementById('profile-detail-modal');
        const editModal = document.getElementById('edit-profile-modal');

        if (menu) menu.classList.add('hidden');
    });

    const form = document.getElementById('manual-reg-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {};
            const elements = form.elements;

            for (let i = 0; i < elements.length; i++) {
                const element = elements[i];
                if (element.name && element.type !== 'submit' && element.type !== 'button') {
                    formData[element.name] = element.value.trim() === '' ? null : element.value;
                }
            }

            document.getElementById('submit-text').classList.add('hidden');
            document.getElementById('loading-spinner').classList.remove('hidden');

            const success = await saveManualRegistration(formData);

            document.getElementById('submit-text').classList.remove('hidden');
            document.getElementById('loading-spinner').classList.add('hidden');

            if (success) {
                 window.hideManualRegistrationModal(); 
            }
        });
    }
});

// PANGGIL INIFIREBASE DI LUAR DOMContentLoaded UNTUK MEMASTIKAN INITIALISASI INSTAN
initFirebase();

// ========================================================
// START: PROFILE MODULE - Lengkap dengan Karakter Lokal
// ========================================================

// ===== FUNGSI SHOW PROFILE DETAIL =====
window.showProfileDetail = async (e) => {
    e.preventDefault();
    
    // Pastikan modal edit profile tertutup jika terbuka
    const editModal = document.getElementById('edit-profile-modal');
    if (editModal) editModal.remove();

    const userDataString = localStorage.getItem(USER_STORAGE_KEY);
    if (!userDataString) {
        showSimpleModal('Error', 'Data sesi tidak ditemukan. Silakan login ulang.');
        return;
    }

    try {
        const userData = JSON.parse(userDataString);
        
        // Ambil data terbaru dari Firestore
        const userDocRef = doc(db, 'users', userData.uid); 
        const userDocSnap = await getDoc(userDocRef);
        
        let profileData = userData;
        if (userDocSnap.exists()) {
            profileData = { ...userData, ...userDocSnap.data() };
            
            // Perbarui Local Storage dengan data terbaru
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profileData));
        }

        // Update tampilan modal
        const nameElement = document.getElementById('profile-detail-name');
        const emailElement = document.getElementById('profile-detail-email');
        const photoElement = document.getElementById('profile-photo');
        
        nameElement.textContent = profileData.name || profileData.email.split('@')[0];
        emailElement.textContent = profileData.email || 'Email tidak tersedia';
        
        // Tampilkan foto profile (menggunakan photoURL yang kini menyimpan path lokal)
        if (profileData.photoURL) {
            photoElement.src = profileData.photoURL;
        } else {
            // 🚨 FALLBACK PATH KE KARAKTER LOKAL YANG SUDAH TERSEDIA
            photoElement.src = './assets/karakter/karakter_1.jpg'; 
        }

        // Tampilkan modal
        const modal = document.getElementById('profile-detail-modal');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

    } catch (error) {
        console.error('Error showing profile:', error);
        showSimpleModal('Error', 'Gagal memuat data profile.');
    }
};

// ===== FUNGSI SHOW EDIT PROFILE MODAL (VERSI BARU DENGAN KARAKTER) =====
window.showEditProfileModal = (e) => {
    e.preventDefault();
    
    const userDataString = localStorage.getItem(USER_STORAGE_KEY);
    if (!userDataString) return;
    
    const userData = JSON.parse(userDataString);
    
    // Tutup modal profile detail
    window.closeProfileDetailModal();
    
    // Buat modal edit profile
    const existingModal = document.getElementById('edit-profile-modal');
    if (existingModal) existingModal.remove();
    
    // 🚨 DAFTAR KARAKTER LOKAL (SESUAIKAN DENGAN NAMA FILE ANDA - EKSTENSI .jpg)
    const CHARACTERS = [
        'karakter_1.jpg', 
        'karakter_2.jpg', 
        'karakter_3.jpg',
        'karakter_4.jpg',
        'karakter_5.jpg',
        'karakter_6.jpg',
        // Pastikan Anda hanya mencantumkan file yang ada di folder
    ];
    window.CHARACTERS = CHARACTERS; // Daftarkan global agar bisa diakses di fungsi lain
    
    const modalHtml = `
        <div id="edit-profile-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100] p-4">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div class="p-6 border-b" style="background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);">
                    <div class="flex justify-between items-center">
                        <h3 class="text-xl font-bold text-white">Edit Profile</h3>
                        <button onclick="closeEditProfileModal()" class="text-white hover:text-gray-200">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                
                <form id="edit-profile-form" class="p-6 space-y-4">
                    <input type="hidden" id="selected-character-input" value=""> 
                    <div class="flex flex-col items-center mb-4">
                        <div class="relative">
                            <img id="preview-photo" src="${userData.photoURL || './assets/karakter/karakter_1.jpg'}" 
                                alt="Preview" 
                                class="w-32 h-32 rounded-full object-cover border-4 border-green-500 shadow-lg cursor-pointer"
                                onclick="showCharacterSelectorModal()">
                            <button type="button" onclick="showCharacterSelectorModal()" class="absolute bottom-0 right-0 bg-green-500 hover:bg-green-600 text-white rounded-full p-2 cursor-pointer shadow-lg transition">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>
                        <p class="text-xs text-gray-500 mt-2">Klik foto atau ikon kamera untuk memilih karakter</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
                        <input type="text" id="edit-name" value="${userData.name || ''}" 
                               class="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-green-500 focus:border-transparent">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input type="email" value="${userData.email}" disabled
                               class="w-full border border-gray-300 rounded-lg p-2 bg-gray-100 text-gray-500">
                        <p class="text-xs text-gray-500 mt-1">Email tidak dapat diubah</p>
                    </div>
                    
                    <div id="edit-error" class="hidden bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm"></div>
                    
                    <div class="flex space-x-3 pt-4">
                        <button type="button" onclick="closeEditProfileModal()" 
                                class="flex-1 px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition">
                            Batal
                        </button>
                        <button type="submit" id="submit-edit-profile"
                                class="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition">
                            <span id="submit-edit-text">Simpan</span>
                            <span id="submit-edit-spinner" class="hidden animate-spin h-5 w-5 border-4 border-white border-t-transparent rounded-full mx-auto"></span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Event listener untuk form submit
    document.getElementById('edit-profile-form').addEventListener('submit', handleEditProfileSubmit);
};

// ===== FUNGSI CLOSE EDIT PROFILE MODAL =====
window.closeEditProfileModal = () => {
    // Pastikan modal pemilih karakter tertutup juga
    const selectorModal = document.getElementById('character-selector-modal');
    if (selectorModal) selectorModal.remove();

    const modal = document.getElementById('edit-profile-modal');
    if (modal) modal.remove();
};

// ===== FUNGSI HANDLE EDIT PROFILE SUBMIT (VERSI BARU TANPA UPLOAD FOTO) =====
const handleEditProfileSubmit = async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submit-edit-profile');
    const submitText = document.getElementById('submit-edit-text');
    const submitSpinner = document.getElementById('submit-edit-spinner');
    const errorDiv = document.getElementById('edit-error');
    
    submitText.classList.add('hidden');
    submitSpinner.classList.remove('hidden');
    submitBtn.disabled = true;

    errorDiv.classList.add('hidden');
    
    try {
        const userDataString = localStorage.getItem(USER_STORAGE_KEY);
        const userData = JSON.parse(userDataString);
        
        const newName = document.getElementById('edit-name').value.trim();
        // 🚨 AMBIL NAMA FILE KARAKTER YANG SUDAH DIPILIH DARI HIDDEN INPUT BARU
        const selectedCharacter = document.getElementById('selected-character-input').value; 
        
        // 🚨 TENTUKAN photoURL BARU (menggunakan aset lokal atau default)
        // Jika ada karakter baru yang dipilih, gunakan itu. Jika tidak, pertahankan photoURL lama.
        let photoURL; 
        if (selectedCharacter) {
            // Gunakan path lokal ke folder aset yang telah Anda buat
            photoURL = `./assets/karakter/${selectedCharacter}`; 
        } else {
            // 🚨 FALLBACK PATH KE KARAKTER LOKAL YANG SUDAH TERSEDIA
            photoURL = userData.photoURL || './assets/karakter/karakter_1.jpg';
        }
        
        // --- LOGIKA UPLOAD FOTO FIREBASE SUDAH DIHAPUS ---
        
        // Update Firestore
        const userDocRef = doc(db, 'users', userData.uid); 
        await updateDoc(userDocRef, {
            name: newName,
            photoURL: photoURL // Simpan path karakter lokal
        });
        
        // Update Local Storage
        const updatedUserData = {
            ...userData,
            name: newName,
            photoURL: photoURL
        };
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedUserData));
        
        // Update UI Header
        document.getElementById('user-display-name').textContent = newName;
        
        // <<< KODE BARU: UPDATE FOTO HEADER SETELAH DISIMPAN >>>
        const headerPhoto = document.getElementById('header-profile-photo');
        if (headerPhoto) {
             headerPhoto.src = photoURL;
        }
        // <<< AKHIR KODE BARU >>>

        showSimpleModal('Sukses!', 'Profile berhasil diperbarui.');
        closeEditProfileModal();
        
    } catch (error) {
        console.error('Error updating profile:', error);
        errorDiv.textContent = `Gagal memperbarui profile: ${error.message}`;
        errorDiv.classList.remove('hidden');
    } finally {
        submitText.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
        submitBtn.disabled = false;
    }
};

// ===== FUNGSI CLOSE PROFILE DETAIL MODAL (Diperlukan oleh dashboard.html) =====
window.closeProfileDetailModal = () => {
    const modal = document.getElementById('profile-detail-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

// ===== FUNGSI GANTI PASSWORD (Diperlukan oleh dashboard.html) =====
window.handleChangePassword = async (e) => {
    e.preventDefault();
    
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const errorDiv = document.getElementById('password-error');
    const submitBtn = document.getElementById('submit-password-change');
    
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
    
    // Validasi
    if (newPassword !== confirmPassword) {
        errorDiv.textContent = 'Password baru dan konfirmasi tidak cocok!';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    if (newPassword.length < 6) {
        errorDiv.textContent = 'Password minimal 6 karakter!';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
    
    try {
        // Menggunakan variabel 'auth' dari scope global
        const user = auth.currentUser;
        if (!user) {
            throw new Error('Sesi berakhir. Silakan login ulang.');
        }
        
        await updatePassword(user, newPassword);
        
        showSimpleModal('Sukses!', 'Password berhasil diubah.');
        window.closeChangePasswordModal(); // Fungsi ini ada di dashboard.html
        
    } catch (error) {
        console.error('Error changing password:', error);
        // Firebase Auth error handling: Misalnya, jika harus login ulang (recent-login)
        let errorMessage = error.message;
        if (error.code === 'auth/requires-recent-login') {
             errorMessage = 'Operasi ini memerlukan autentikasi ulang. Silakan logout dan login kembali untuk mengubah password.';
        }
        errorDiv.textContent = `Gagal mengubah password: ${errorMessage}`;
        errorDiv.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Password Baru';
    }
};


// ===== FUNGSI BARU: SHOW CHARACTER SELECTOR MODAL =====
window.showCharacterSelectorModal = () => {
    const CHARACTERS = window.CHARACTERS || []; // Gunakan daftar karakter dari showEditProfileModal
    
    const characterListHtml = CHARACTERS.map(fileName => `
        <div class="cursor-pointer p-2 border-2 border-transparent hover:border-green-500 rounded-lg transition" 
             onclick="selectCharacter('${fileName}')">
            <img src="./assets/karakter/${fileName}" alt="${fileName}" 
                 class="w-20 h-20 rounded-full object-cover">
        </div>
    `).join('');
    
    const selectorModalHtml = `
        <div id="character-selector-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[110] p-4">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
                <div class="p-4 border-b">
                    <h3 class="text-xl font-bold text-gray-800">Pilih Karakter</h3>
                </div>
                <div class="p-6">
                    <div class="grid grid-cols-3 gap-4 justify-items-center">
                        ${characterListHtml}
                    </div>
                </div>
                <div class="p-4 border-t text-right">
                    <button onclick="document.getElementById('character-selector-modal').remove()" 
                            class="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition">Tutup</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', selectorModalHtml);
};

// ===== FUNGSI BARU: SELECT CHARACTER =====
window.selectCharacter = (fileName) => {
    // 1. Simpan nama file ke hidden input di modal edit
    document.getElementById('selected-character-input').value = fileName;
    
    // 2. Tampilkan preview-nya
    document.getElementById('preview-photo').src = `./assets/karakter/${fileName}`;
    
    // 3. Tutup modal pemilih karakter
    document.getElementById('character-selector-modal').remove();
};