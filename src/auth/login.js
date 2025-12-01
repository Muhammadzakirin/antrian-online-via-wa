/**
 * src/auth/login.js - Firebase Auth Version (Final)
 * Menangani proses login menggunakan Firebase Authentication dan mengambil data nama dari Firestore.
 */

import { auth } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// ✅ PERBAIKAN: Import Firestore modules yang diperlukan
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"; 
import { db } from "./firebase-init.js"; // Pastikan db diekspor dari firebase-init.js

const USER_STORAGE_KEY = 'puskesmas_user';

const loginBtn = document.getElementById('loginBtn');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorBox = document.getElementById('errorBox');

function displayError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
}

function hideError() {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
}

async function handleLogin(e) {
    e.preventDefault();
    hideError();
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Memproses...';

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        displayError('Email dan Password harus diisi.');
        return;
    }

    try {
        // 1. LOGIN KE FIREBASE AUTH
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        let fullName = user.email.split('@')[0]; // Fallback A
        let role = 'Petugas'; // Default Role

        // 2. ✅ PERBAIKAN UTAMA: Ambil data NAMA LENGKAP dari Firestore
        // Menggunakan koleksi "users" dan UID pengguna sebagai Document ID
        const userDocRef = doc(db, "users", user.uid); 
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const firestoreData = userDocSnap.data();
            
            // Mengambil field yang benar: 'name' (yang ada di DB Anda)
            if (firestoreData.name) { 
                fullName = firestoreData.name; // <-- Mengambil "zizan" atau nama lengkap
            }
            if (firestoreData.role) {
                role = firestoreData.role;
            }
        }
        
        // 3. SIMPAN DATA SESI KE LOCAL STORAGE
        const userData = {
            uid: user.uid,
            email: user.email,
            // Menyimpan di field 'nama' (Bahasa Indonesia) untuk dibaca dashboard.html
            nama: fullName, 
            role: role 
        };

        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
        
        console.log('Login berhasil, data sesi:', userData);
        
        // Redirect ke dashboard
        window.location.href = 'dashboard.html';
        
    } catch (error) {
        console.error('Error login:', error);
        
        // Handle Firebase Auth errors
        let errorMessage = 'Login gagal. ';
        
        switch (error.code) {
            case 'auth/invalid-email':
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-credential':
                errorMessage += 'Email atau password salah.';
                break;
            case 'auth/user-disabled':
                errorMessage += 'Akun ini telah dinonaktifkan.';
                break;
            default:
                errorMessage += error.message;
        }
        
        displayError(errorMessage);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

loginBtn.addEventListener('click', handleLogin);