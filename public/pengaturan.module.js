/**
 * pengaturan.module.js (FINALIZED - QR Code Fallback from API & RBAC)
 * Modul Pengaturan dengan QR Code Real-Time via Socket.IO, Fallback API, dan Kontrol Akses (RBAC)
 */

import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    query,
    orderBy,
    deleteDoc,
    onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 🚨 PERBAIKAN: Import fungsi Auth dari module yang benar
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


let qrcodeInstance = null;
const WA_GATEWAY_URL = 'http://localhost:3000';

export function initPengaturanModule(db, auth) {
    const $ = id => document.getElementById(id);

    let systemInfo = {};
    let users = [];
    let waStatusUnsubscribe = null;
    let isViewRendered = false;
    let currentUserRole = 'operator'; // 🚨 STATE BARU: Default ke operator
    
    const SYSTEM_INFO_PATH = 'settings/general';
    const WA_SESSION_PATH = 'gateway/wa_status';
    const USERS_COLLECTION_PATH = 'users';
    const GLOBAL_SECRET_KEY = "123456";

    const setStatus = (id, msg, isError = false) => {
        const el = $(id);
        if (!el) return;
        el.className = isError 
            ? 'text-sm text-red-600 font-medium mt-2' 
            : 'text-sm text-gray-600 mt-2';
        el.textContent = msg;
    };

    // --- RBAC CHECKER ---
    const checkUserRole = async () => {
        if (!auth.currentUser) return 'operator'; 

        try {
            const docRef = doc(db, USERS_COLLECTION_PATH, auth.currentUser.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return docSnap.data().role || 'operator';
            }
        } catch (e) {
            console.error("Gagal mendapatkan peran pengguna:", e);
        }
        return 'operator';
    };


    // =======================================================
    // I. LOGIKA PENGATURAN SISTEM
    // =======================================================
    const fetchSystemInfo = async () => {
        if (!isViewRendered || !$('sys-name')) {
            console.warn("fetchSystemInfo: Menunggu DOM dirender.");
            return;
        }
        
        try {
            setStatus('sys-status', 'Memuat info sistem...');
            const docRef = doc(db, SYSTEM_INFO_PATH);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                systemInfo = docSnap.data();
            } else {
                systemInfo = { name: '', address: '', phone: '', tagline: '' };
            }

            $('sys-name').value = systemInfo.name || '';
            $('sys-address').value = systemInfo.address || '';
            $('sys-phone').value = systemInfo.phone || '';
            $('sys-tagline').value = systemInfo.tagline || '';
            
            setStatus('sys-status', 'Info sistem siap diedit.');

        } catch (e) {
            console.error("Gagal memuat info sistem:", e);
            setStatus('sys-status', 'Gagal memuat info sistem. Cek konsol.', true);
        }
    };

    const saveSystemInfo = async () => {
        const name = $('sys-name').value.trim();
        const address = $('sys-address').value.trim();
        const phone = $('sys-phone').value.trim();
        const tagline = $('sys-tagline').value.trim();

        if (!name) return alert('Nama sistem tidak boleh kosong!');

        try {
            setStatus('sys-status', 'Menyimpan perubahan info sistem...');
            const docRef = doc(db, SYSTEM_INFO_PATH);
            
            await setDoc(docRef, { 
                name, 
                address, 
                phone, 
                tagline, 
                updatedAt: new Date() 
            }, { merge: true });

            systemInfo = { name, address, phone, tagline };
            setStatus('sys-status', 'Info sistem berhasil diperbarui! 🎉');
            
            if (window.fetchAndRenderSystemInfo) {
                window.fetchAndRenderSystemInfo();
            }

        } catch (e) {
            console.error("Gagal menyimpan info sistem:", e);
            setStatus('sys-status', 'Gagal menyimpan. Cek konsol.', true);
        }
    };

    // =======================================================
    // II. LOGIKA PENGATURAN PENGGUNA (RBAC & CRUD)
    // =======================================================
    const fetchUsers = async () => {
        try {
            setStatus('user-status', 'Memuat daftar pengguna...');
            const colRef = collection(db, USERS_COLLECTION_PATH);
            const q = query(colRef, orderBy('role', 'asc'), orderBy('name', 'asc'));
            const snap = await getDocs(q);
            
            users = [];
            snap.forEach(d => {
                users.push({ id: d.id, ...d.data() });
            });
            
            renderUserTable();
            setStatus('user-status', `Ditemukan ${users.length} pengguna.`);

        } catch (e) {
            console.error("Gagal memuat daftar pengguna:", e);
            setStatus('user-status', 'Gagal memuat pengguna. Cek konsol.', true);
        }
    };

    const renderUserTable = () => {
        const tbody = $('user-body');
        const addUserBtn = $('add-user-btn'); 
        const canManage = currentUserRole === 'admin';

        if (!tbody) return;

        // 🚨 KONTROL RBAC PADA TOMBOL TAMBAH PENGGUNA
        if (addUserBtn) {
            addUserBtn.style.display = canManage ? 'inline-block' : 'none';
        }

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-500">Tidak ada data pengguna.</td></tr>`;
            return;
        }

        let rows = '';
        users.forEach(u => {
            const roleText = u.role === 'admin' ? 'Admin (Penuh)' : 'Operator';
            
            let actionButtons = `
                <button data-id="${u.id}" class="btn-edit-user text-blue-600 hover:text-blue-800 text-xs mr-2" ${!canManage ? 'disabled style="opacity: 0.5;"' : ''}>Edit</button>
                <button data-id="${u.id}" class="btn-delete-user text-red-600 hover:text-red-800 text-xs" ${!canManage ? 'disabled style="opacity: 0.5;"' : ''}>Hapus</button>
            `;

            if (!canManage) actionButtons = 'Akses Dibatasi';


            rows += `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-2 text-sm text-gray-900 font-medium">${u.name || '-'}</td>
                    <td class="px-4 py-2 text-sm text-gray-700">${u.email || u.id}</td>
                    <td class="px-4 py-2 text-sm text-gray-700">${roleText}</td>
                    <td class="px-4 py-2 text-sm whitespace-nowrap">
                        ${actionButtons}
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = rows;

        // Hanya tambahkan listener jika tombol ada dan pengguna adalah Admin
        if (canManage) {
            document.querySelectorAll('.btn-edit-user').forEach(btn => 
                btn.addEventListener('click', (e) => handleEditUser(e.target.dataset.id)));
            document.querySelectorAll('.btn-delete-user').forEach(btn => 
                btn.addEventListener('click', (e) => handleDeleteUser(e.target.dataset.id)));
        }
    };
    
    // 🚨 FUNGSI BARU: Menampilkan modal tambah pengguna
    const handleAddUser = () => {
        if (currentUserRole !== 'admin') {
            return alert('Akses ditolak. Hanya Admin yang dapat menambah pengguna.');
        }
        // Memanggil helper modal yang ada di dashboard.html
        window.showAddUserModal(); 
    };
    
    // 🚨 FUNGSI DIPERBARUI: Mengaktifkan Modal Edit
    const handleEditUser = (id) => {
        if (currentUserRole !== 'admin') {
            return alert('Akses ditolak. Hanya Admin yang dapat mengedit pengguna.');
        }
        
        // Cari data pengguna yang akan diedit dari cache
        const userToEdit = users.find(u => u.id === id); 
        
        if (!userToEdit) {
            return alert('Data pengguna tidak ditemukan.');
        }
        
        // Memanggil helper modal yang ada di dashboard.html dengan data pengguna
        window.showAddUserModal(userToEdit); 
    };
    
    const handleDeleteUser = async (id) => {
        if (currentUserRole !== 'admin') {
            return alert('Akses ditolak. Hanya Admin yang dapat menghapus pengguna.');
        }
        if (!confirm('Apakah Anda yakin ingin menghapus pengguna ini? Tindakan ini tidak dapat dibatalkan.')) return;

        try {
            setStatus('user-status', 'Menghapus pengguna...');
            
            const docRef = doc(db, USERS_COLLECTION_PATH, id);
            await deleteDoc(docRef);
            
            users = users.filter(u => u.id !== id);
            renderUserTable();
            setStatus('user-status', 'Pengguna berhasil dihapus dari daftar (Akun Auth mungkin masih aktif).');

        } catch (e) {
            console.error("Gagal menghapus pengguna:", e);
            setStatus('user-status', 'Gagal menghapus. Cek konsol.', true);
        }
    };
    
    // 🚨 FUNGSI UNTUK MENDAFTARKAN PENGGUNA BARU
    window.submitNewUser = async (name, email, password, role) => {
        // Fungsi ini dipanggil dari form di dashboard.html
        if (currentUserRole !== 'admin') {
            alert('Akses Ditolak.');
            return false;
        }

        try {
            // 1. Buat Pengguna di Firebase Authentication
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;
            
            // 2. Simpan Data Profil (Nama & Peran) ke Firestore
            const docRef = doc(db, USERS_COLLECTION_PATH, uid);
            await setDoc(docRef, {
                name: name,
                email: email,
                role: role,
                createdAt: new Date()
            });

            // 3. Sukses
            fetchUsers(); // Muat ulang daftar
            return true;

        } catch (error) {
            console.error("Error creating user:", error);
            alert(`Gagal mendaftar: ${error.message}`);
            return false;
        }
    };
    
    // 🚨 FUNGSI BARU: FUNGSI UNTUK MENGEDIT DATA PENGGUNA YANG ADA
    window.submitEditUser = async (uid, name, password, role) => {
        if (currentUserRole !== 'admin') {
            return false;
        }
        
        try {
            // 1. Update Profile (Nama dan Role) di Firestore
            const docRef = doc(db, USERS_COLLECTION_PATH, uid);
            await setDoc(docRef, {
                name: name,
                role: role,
            }, { merge: true });
            
            // 2. Update Password (Opsional)
            if (password && password.length >= 6) {
                // NOTE: Melewatkan update password Auth karena memerlukan fitur re-auth
                console.warn("Update password dilewati. Ganti password dari profil pengguna ybs.");
            }

            fetchUsers(); // Muat ulang daftar
            return true;

        } catch (error) {
            console.error("Error editing user:", error);
            alert(`Gagal mengedit: ${error.message}`);
            return false;
        }
    };
    
    // --- Logika WA Gateway (Full Code) ---
    
    const createSecretCodeModal = () => {
        return `
            <div id="secret-code-modal" class="fixed inset-0 bg-gray-900 bg-opacity-80 hidden items-center justify-center z-[100] p-4">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
                    <div class="p-6 border-b">
                        <h3 class="text-xl font-bold text-gray-800">🔒 Masukkan Kunci Akses WA</h3>
                    </div>
                    <div class="p-6">
                        <p class="text-gray-700 mb-4">Kunci ini diperlukan untuk menautkan akun WhatsApp Puskesmas.</p>
                        <input type="password" id="wa-secret-input" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-2xl tracking-widest text-center" maxlength="6" />
                        <div id="wa-lock-message" class="mt-3 text-sm text-red-600 hidden"></div>
                    </div>
                    <div class="p-4 border-t text-right space-x-2">
                        <button type="button" onclick="closeWaLockModal()" class="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg">Batal</button>
                        <button type="button" id="submit-wa-secret" class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Buka Akses</button>
                    </div>
                </div>
            </div>
        `;
    };

    const fetchQrCodeAndRender = async () => {
        const qrContainer = $('qrcode-container');
        const waQrStatus = $('wa-qr-status');
        
        qrContainer.innerHTML = '';
        qrcodeInstance = null;

        try {
            const response = await fetch(`${WA_GATEWAY_URL}/qr`);
            const data = await response.json();
            const qrBase64 = data.qrCode || data.qr;
            
            if (qrBase64 && qrBase64.startsWith('data:image/png;base64,')) {
                
                const qrImage = document.createElement('img');
                qrImage.src = qrBase64;
                
                qrImage.style.width = '280px'; 
                qrImage.style.height = '280px';
                
                qrContainer.appendChild(qrImage);
                waQrStatus.textContent = 'Status: ⏳ Menunggu Scan QR...';
                $('wa-qr-display').classList.remove('hidden');

            } else {
                qrContainer.innerHTML = '<p class="text-sm text-gray-500">QR Code belum siap/kosong.</p>';
            }
            
        } catch (e) {
            console.error("Gagal mengambil QR Code dari API:", e);
            waQrStatus.textContent = 'Status: ERROR koneksi API QR.';
        }
    };
    
    const startWaSocketListener = () => {
        if (typeof io === 'undefined' || typeof window.QRCode === 'undefined') {
             console.error("Socket.IO atau QRCode.js belum dimuat.");
             $('wa-qr-status').textContent = 'Status: ERROR - Dependensi tidak ditemukan.';
             return;
        }

        const socket = io(WA_GATEWAY_URL);
        const qrDisplay = $('wa-qr-display');
        const waQrStatus = $('wa-qr-status');
        const qrContainer = $('qrcode-container');

        console.log('✅ Socket.IO listener dimulai untuk QR Code real-time.');

        // --- 1. LISTENER UNTUK QR CODE MENTAH (Real-Time) ---
        socket.on('qr_update', (data) => {
            const qrString = data.qr_data;
            
            console.log('📱 QR Code diterima via Socket.IO');
            
            waQrStatus.textContent = 'Status: ⏳ Menunggu Scan QR...';
            waQrStatus.className = 'mt-3 text-base text-orange-600 font-semibold';
            
            if (qrcodeInstance) {
                 qrContainer.innerHTML = '';
                 qrcodeInstance = null;
            }

            const renderTarget = document.createElement('div');
            qrContainer.innerHTML = '';
            qrContainer.appendChild(renderTarget);
            
            qrcodeInstance = new window.QRCode(renderTarget, {
                text: qrString,
                width: 280, 
                height: 280, 
                colorDark: "#1a73e8",
                colorLight: "#ffffff",
                correctLevel: window.QRCode.CorrectLevel.H
            });
            
            qrDisplay.classList.remove('hidden');
            $('open-wa-lock-btn')?.classList.add('hidden');
        });
        
        // --- 2. LISTENER UNTUK STATUS KONEKSI (Real-Time) ---
        socket.on('status_update', (data) => {
            const status = data.status;
            
            console.log('📡 Status update via Socket.IO:', status);
            
            if (status === 'CONNECTED' || status === 'READY') {
                waQrStatus.textContent = 'Status: ✅ TERHUBUNG';
                waQrStatus.className = 'mt-3 text-base text-green-600 font-semibold';
                
                qrContainer.innerHTML = '<p class="text-xl font-bold text-green-600 py-20">✅ Bot WhatsApp Terhubung!</p>';
                qrcodeInstance = null;
                
                $('open-wa-lock-btn')?.classList.add('hidden');
                qrDisplay.classList.remove('hidden');
                
            } else if (status === 'DISCONNECTED' || status === 'AUTH_FAILURE' || status === 'ERROR') {
                waQrStatus.textContent = `Status: ❌ ${status}. Muat ulang untuk mencoba lagi.`;
                waQrStatus.className = 'mt-3 text-base text-red-600 font-semibold';
                
                qrContainer.innerHTML = '';
                qrcodeInstance = null;
                
                $('open-wa-lock-btn')?.classList.remove('hidden');
                qrDisplay.classList.add('hidden');
            }
        });

        socket.on('connect', () => {
            console.log('✅ Socket.IO connected to server');
        });

        socket.on('disconnect', () => {
            console.log('⚠️ Socket.IO disconnected');
        });
    };

    /**
     * Firestore Listener (Monitor status, panggil fallback QR jika SCANNING)
     */
    const startWaStatusListener = () => {
        if (waStatusUnsubscribe) waStatusUnsubscribe();
        
        const docRef = doc(db, WA_SESSION_PATH);
        
        waStatusUnsubscribe = onSnapshot(docRef, (docSnap) => {
            const data = docSnap.data();
            renderWaStatus(data);
        }, (error) => {
            console.error("Error listening to WA status:", error);
            renderWaStatus(null, true);
        });
    };
    
    const renderWaStatus = (data, isError = false) => {
        const statusEl = $('wa-qr-status');
        const qrDisplay = $('wa-qr-display');
        const lockBtn = $('open-wa-lock-btn');
        const qrContainer = $('qrcode-container');

        if (!isViewRendered || !statusEl || !qrDisplay || !lockBtn) {
            console.warn("renderWaStatus: Menunggu DOM dirender.");
            return;
        }

        if (isError) {
            statusEl.textContent = 'Status: ❌ Gagal terhubung ke Firestore.';
            lockBtn?.classList.remove('hidden');
            qrDisplay?.classList.add('hidden');
            return;
        }

        const status = data?.status || 'DISCONNECTED';
        
        // Bersihkan QR Canvas/Instance jika status berubah dari SCANNING ke non-SCANNING
        if (status !== 'SCANNING' && qrContainer?.querySelector('canvas, img')) {
             qrContainer.innerHTML = '';
             qrcodeInstance = null;
        }


        switch (status) {
            case 'CONNECTED':
            case 'READY':
                statusEl.textContent = 'Status: ✅ TERHUBUNG';
                lockBtn?.classList.add('hidden');
                qrDisplay?.classList.remove('hidden');
                qrContainer.innerHTML = '<p class="text-xl font-bold text-green-600 py-20">✅ Bot WhatsApp Terhubung!</p>';
                break;
            
            case 'SCANNING':
                statusEl.textContent = `Status: ⏳ Menunggu Scan QR...`;
                lockBtn?.classList.add('hidden'); 
                qrDisplay?.classList.remove('hidden');
                
                // ✅ LOGIKA FALLBACK QR: Ambil dari API jika QR container masih kosong
                if (!qrContainer.querySelector('canvas, img')) {
                    console.log("[WA Status] Triggering API fallback for QR code...");
                    fetchQrCodeAndRender();
                }
                break;
            
            case 'DISCONNECTED':
            case 'ERROR':
            default:
                statusEl.textContent = 'Status: Terkunci / Tidak Terhubung';
                lockBtn?.classList.remove('hidden');
                qrDisplay?.classList.add('hidden');
                qrContainer.innerHTML = '';
                break;
        }
    };

    const openWaLockModal = () => {
        const modal = $('secret-code-modal');
        const input = $('wa-secret-input');
        const submitBtn = $('submit-wa-secret');
        const message = $('wa-lock-message');

        input.value = '';
        message.classList.add('hidden');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        
        window.closeWaLockModal = closeWaLockModal;
        window.validateWaSecret = validateWaSecret;
        
        submitBtn.onclick = validateWaSecret;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                validateWaSecret();
            }
        };
    };

    const closeWaLockModal = () => {
        const modal = $('secret-code-modal');
        modal.classList.add('hidden');
        modal.style.display = 'none';
    };

    const validateWaSecret = () => {
        const input = $('wa-secret-input');
        const message = $('wa-lock-message');
        const userCode = input.value.trim();

        if (userCode === GLOBAL_SECRET_KEY) {
            closeWaLockModal();
            $('wa-qr-status').textContent = 'Akses Dibuka. Memulai sesi WA...';
            
            fetch(`${WA_GATEWAY_URL}/start`, { method: 'POST' })
                .then(() => {
                    $('wa-qr-status').textContent = 'Sesi dimulai! Tunggu QR Code muncul...';
                    
                    setTimeout(() => {
                        startWaSocketListener();
                        setTimeout(fetchQrCodeAndRender, 3000); 
                    }, 2000);
                })
                .catch(err => {
                    $('wa-qr-status').textContent = `ERROR: Gagal memanggil start API.`;
                    console.error('Start API Error:', err);
                });

        } else {
            message.textContent = 'Kode salah. Akses ditolak.';
            message.classList.remove('hidden');
            input.value = '';
        }
    };


    // =======================================================
    // IV. RENDER VIEW
    // =======================================================

    const renderPengaturanView = async () => {
        const container = $('content-container');
        if (!container) return;
        
        // 🚨 FASE 1: Dapatkan Peran Pengguna saat ini sebelum me-render
        currentUserRole = await checkUserRole(); 

        if (waStatusUnsubscribe) waStatusUnsubscribe();

        container.innerHTML = `
            <div class="bg-white p-6 rounded-xl shadow-xl">
                <h2 class="text-2xl font-bold text-gray-800 mb-6">⚙️ Pengaturan Aplikasi</h2>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
                
                    <div class="border p-4 rounded-lg">
                        <h3 class="text-xl font-semibold mb-3 text-gray-700">1. Informasi Sistem</h3>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="col-span-full">
                                <label class="block text-xs font-medium text-gray-700">Nama Lengkap</label>
                                <input id="sys-name" type="text" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                            
                            <div class="col-span-full">
                                <label class="block text-xs font-medium text-gray-700">Telepon/Kontak</label>
                                <input id="sys-phone" type="text" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                            </div>
                        </div>

                        <div class="mt-3">
                            <label class="block text-xs font-medium text-gray-700">Alamat Lengkap</label>
                            <textarea id="sys-address" rows="2" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"></textarea>
                        </div>
                        
                        <div class="mt-3 border-t pt-3">
                            <label class="block text-xs font-medium text-gray-700">Tagline Header</label>
                            <input id="sys-tagline" type="text" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                        </div>

                        <div class="mt-4 flex justify-between items-center">
                            <button id="save-sys-info" class="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">Simpan Perubahan</button>
                            <div id="sys-status">Memuat...</div>
                        </div>
                    </div>

                    <div class="border p-4 rounded-lg">
                        <h3 class="text-xl font-semibold mb-3 text-gray-700">3. WhatsApp Gateway</h3>
                        
                        <div id="wa-connection-area" class="text-center p-8 border border-dashed rounded-lg bg-gray-50 flex flex-col items-center min-h-[450px]">
                            
                            <button id="open-wa-lock-btn" class="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-lg transition">
                                🔐 Masukkan Kunci Rahasia WA
                            </button>
                            
                            <div id="wa-qr-status" class="mt-3 text-base text-gray-700 font-medium">Status: Memuat status WA...</div>
                            
                            <div id="wa-qr-display" class="mt-6 hidden flex flex-col items-center w-full">
                                <div id="qrcode-container" class="mx-auto border-4 border-blue-500 p-4 rounded-lg bg-white shadow-2xl flex items-center justify-center" style="width: 320px; height: 320px; min-width: 320px; min-height: 320px;"></div>
                                <p class="mt-4 text-red-600 text-sm font-semibold">📱 Scan dengan WhatsApp di HP Anda</p>
                                <p class="mt-1 text-gray-500 text-xs">Buka WhatsApp → Menu (⋮) → Perangkat Tertaut → Tautkan Perangkat</p>
                            </div>
                        </div>
                    </div>

                </div>

                <div class="border p-4 rounded-lg">
                    <h3 class="text-xl font-semibold mb-4 text-gray-700">2. Manajemen Pengguna</h3>
                    
                    <div class="flex justify-end mb-4">
                        <button id="add-user-btn" class="px-4 py-2 bg-green-600 text-white rounded-md text-sm" onclick="showAddUserModal()">
                            + Tambah Pengguna Baru
                        </button>
                    </div>

                    <div class="overflow-x-auto border rounded-lg">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nama</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email/ID</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody id="user-body" class="bg-white divide-y divide-gray-200">
                                <tr><td colspan="4" class="p-4 text-center text-gray-500">Memuat data pengguna...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="user-status" class="mt-2"></div>
                </div>
            </div>
            
            ${createSecretCodeModal()}
        `;
        
        // FASE 2: Lampirkan Event Listeners setelah DOM dimuat
        $('save-sys-info').addEventListener('click', saveSystemInfo);
        $('add-user-btn').addEventListener('click', handleAddUser);
        $('open-wa-lock-btn').addEventListener('click', openWaLockModal);
        
        isViewRendered = true;
        
        await fetchSystemInfo();
        await fetchUsers();
        startWaStatusListener();
        startWaSocketListener(); // Mulai Socket.IO listener segera
    };


    return {
        renderPengaturanView,
        fetchSystemInfo,
        fetchUsers,
        closeWaLockModal,
        validateWaSecret
    };
}