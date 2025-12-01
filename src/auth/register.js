/**
 * src/auth/register.js - Firebase Auth Version (Final)
 * Menangani proses pendaftaran akun baru, mendaftarkan ke Firebase Auth dan menyimpan data ke Firestore.
 */

import { auth, db } from "./firebase-init.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const name = document.getElementById("name");
const email = document.getElementById("email");
const password = document.getElementById("password");
const registerBtn = document.getElementById("registerBtn");
const errorBox = document.getElementById("errorBox");

registerBtn.addEventListener("click", async (e) => { // Tambahkan (e) untuk preventDefault jika ada form
    e.preventDefault();
    registerBtn.disabled = true;
    registerBtn.textContent = 'Mendaftar...';
    errorBox.classList.add("hidden");

    try {
        // 1. DAFTAR DI FIREBASE AUTH
        const userCredential = await createUserWithEmailAndPassword(auth, email.value, password.value);
        const user = userCredential.user;

        // 2. SIMPAN DATA TAMBAHAN KE FIRESTORE (Koleksi 'users')
        await setDoc(doc(db, "users", userCredential.user.uid), {
            name: name.value,  // ← INI FIELD NAMA LENGKAP
            email: email.value,
            role: "petugas",
            createdAt: new Date()
        });

        alert("Pendaftaran berhasil! Silakan login.");
        window.location.href = "login.html";

    } catch (error) {
        let errorMessage = 'Pendaftaran gagal. ';
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage += 'Email sudah terdaftar. Coba Login.';
                break;
            case 'auth/weak-password':
                errorMessage += 'Password terlalu lemah (minimal 6 karakter).';
                break;
            default:
                errorMessage += error.message;
        }
        
        errorBox.textContent = errorMessage;
        errorBox.classList.remove("hidden");
        console.error("Register Error:", error);

    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Daftar';
    }
});