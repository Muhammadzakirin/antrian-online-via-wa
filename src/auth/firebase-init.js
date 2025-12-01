/**
 * firebase-init.js
 * Konfigurasi Dasar dan Ekspor Instance Firebase/Auth/Firestore
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// WAJIB: ubah sesuai konfigurasi dari Firebase Console
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCrfnerj9mYsivfDhGP65vEMRovyfsON_E",
    authDomain: "antrian-online-355c7.firebaseapp.com",
    projectId: "antrian-online-355c7",
    storageBucket: "antrian-online-355c7.firebasestorage.app",
    messagingSenderId: "1072172499150",
    appId: "1:1072172499150:web:1dd83762ae07ba61a3d09f",
    measurementId: "G-BMDTP9ES65"
};

// INISIALISASI

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);


// ✅ TAMBAHAN: Ekspor Konstanta Umum dari sini
export const SYSTEM_INFO_PATH = 'settings/general';
export const WA_API_BASE_URL = 'http://localhost:3000';
export const USER_STORAGE_KEY = 'puskesmas_user';