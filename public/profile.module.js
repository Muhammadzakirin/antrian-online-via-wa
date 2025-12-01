/**
 * profile.module.js
 * Modul untuk View & Edit Profile dengan Upload Foto
 */

import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { updatePassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

export function initProfileModule(db, auth) {
    const $ = id => document.getElementById(id);

    let currentUserData = null;

    // ==========================================
    // SHOW DETAIL PROFILE MODAL (VIEW ONLY)
    // ==========================================
    window.showDetailProfile = async () => {
        const userData = localStorage.getItem('puskesmas_user');
        
        if (!userData) {
            alert('Session expired. Please login again.');
            window.location.href = 'login.html';
            return;
        }

        const parsedUser = JSON.parse(userData);
        
        try {
            // Fetch data terbaru dari Firestore
            const userDocRef = doc(db, 'users', parsedUser.uid);
            const userDocSnap = await getDoc(userDocRef);
            
            if (!userDocSnap.exists()) {
                alert('User data not found in database.');
                return;
            }
            
            currentUserData = { id: parsedUser.uid, ...userDocSnap.data() };
            
            const photoURL = currentUserData.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUserData.name || 'User') + '&size=200&background=2ecc71&color=fff&bold=true';
            
            const modalHTML = `
                <div id="detail-profile-modal" class="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-[100] p-4">
                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <!-- Header -->
                        <div class="bg-gradient-to-r from-green-500 to-green-600 p-6 text-white relative">
                            <button onclick="closeDetailProfile()" class="absolute top-4 right-4 text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                            <h2 class="text-2xl font-bold">Detail Akun Petugas</h2>
                        </div>
                        
                        <!-- Body -->
                        <div class="p-6 text-center">
                            <!-- Photo Profile -->
                            <div class="mb-6">
                                <img src="${photoURL}" alt="Profile Photo" class="w-32 h-32 rounded-full mx-auto border-4 border-green-500 shadow-lg object-cover">
                            </div>
                            
                            <!-- User Info -->
                            <div class="space-y-3 text-left bg-gray-50 p-4 rounded-lg">
                                <div>
                                    <p class="text-xs font-semibold text-gray-500 uppercase">Nama Lengkap</p>
                                    <p class="text-lg font-bold text-gray-800">${currentUserData.name || '-'}</p>
                                </div>
                                
                                <div>
                                    <p class="text-xs font-semibold text-gray-500 uppercase">Email</p>
                                    <p class="text-base text-gray-700">${currentUserData.email || '-'}</p>
                                </div>
                                
                                <div>
                                    <p class="text-xs font-semibold text-gray-500 uppercase">Role</p>
                                    <p class="text-base text-gray-700 capitalize">${currentUserData.role || 'petugas'}</p>
                                </div>
                                
                                <div>
                                    <p class="text-xs font-semibold text-gray-500 uppercase">User ID</p>
                                    <p class="text-xs text-gray-500 font-mono break-all">${currentUserData.id}</p>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Footer Actions -->
                        <div class="p-4 bg-gray-100 flex gap-3">
                            <button onclick="showEditProfile()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition shadow-md">
                                ✏️ Edit Profile
                            </button>
                            <button onclick="showChangePassword()" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition shadow-md">
                                🔒 Ganti Password
                            </button>
                        </div>
                        
                        <div class="p-4 border-t">
                            <button onclick="closeDetailProfile()" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 rounded-lg transition">
                                Tutup
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
        } catch (error) {
            console.error('Error loading profile:', error);
            alert('Failed to load profile data.');
        }
    };

    window.closeDetailProfile = () => {
        const modal = $('detail-profile-modal');
        if (modal) modal.remove();
    };

    // ==========================================
    // SHOW EDIT PROFILE MODAL
    // ==========================================
    window.showEditProfile = () => {
        closeDetailProfile();
        
        const photoURL = currentUserData.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(currentUserData.name || 'User') + '&size=200&background=2ecc71&color=fff&bold=true';
        
        const modalHTML = `
            <div id="edit-profile-modal" class="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-[100] p-4 overflow-y-auto">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md my-8">
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-green-500 to-green-600 p-6 text-white relative rounded-t-2xl">
                        <button onclick="closeEditProfile()" class="absolute top-4 right-4 text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <h2 class="text-2xl font-bold">Edit Profile</h2>
                    </div>
                    
                    <!-- Body -->
                    <form id="edit-profile-form" class="p-6">
                        <!-- Photo Upload -->
                        <div class="mb-6 text-center">
                            <div class="relative inline-block">
                                <img id="preview-photo" src="${photoURL}" alt="Profile" class="w-32 h-32 rounded-full border-4 border-green-500 shadow-lg object-cover mx-auto">
                                <label for="photo-input" class="absolute bottom-0 right-0 bg-green-600 hover:bg-green-700 text-white rounded-full p-3 cursor-pointer shadow-lg transition">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </label>
                                <input type="file" id="photo-input" accept="image/*" class="hidden" onchange="handlePhotoSelect(event)">
                            </div>
                            <p class="text-xs text-gray-500 mt-2">Klik ikon kamera untuk upload foto</p>
                        </div>
                        
                        <!-- Nama Lengkap -->
                        <div class="mb-4">
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Nama Lengkap</label>
                            <input type="text" id="edit-name" value="${currentUserData.name || ''}" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                        </div>
                        
                        <!-- Email (Read Only) -->
                        <div class="mb-4">
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                            <input type="email" value="${currentUserData.email || ''}" disabled class="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed">
                            <p class="text-xs text-gray-500 mt-1">Email tidak dapat diubah</p>
                        </div>
                        
                        <!-- Status Message -->
                        <div id="edit-status" class="mb-4 hidden">
                            <p class="text-sm"></p>
                        </div>
                        
                        <!-- Buttons -->
                        <div class="flex gap-3">
                            <button type="button" onclick="closeEditProfile()" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition">
                                Batal
                            </button>
                            <button type="submit" class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition shadow-md">
                                💾 Simpan
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Attach form submit handler
        $('edit-profile-form').addEventListener('submit', handleEditProfileSubmit);
    };

    window.closeEditProfile = () => {
        const modal = $('edit-profile-modal');
        if (modal) modal.remove();
    };

    // Handle photo selection
    window.handlePhotoSelect = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            alert('Ukuran file terlalu besar! Maksimal 2MB.');
            return;
        }
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('File harus berupa gambar!');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = $('preview-photo');
            if (preview) {
                preview.src = e.target.result;
                preview.dataset.newPhoto = e.target.result; // Store base64 temporarily
            }
        };
        reader.readAsDataURL(file);
    };

    // Handle form submit
    const handleEditProfileSubmit = async (e) => {
        e.preventDefault();
        
        const statusEl = $('edit-status');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        // Show loading
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Menyimpan...';
        statusEl.classList.remove('hidden');
        statusEl.querySelector('p').textContent = 'Menyimpan perubahan...';
        statusEl.querySelector('p').className = 'text-sm text-blue-600';
        
        try {
            const newName = $('edit-name').value.trim();
            const preview = $('preview-photo');
            const newPhotoBase64 = preview.dataset.newPhoto;
            
            const updateData = {
                name: newName,
            };
            
            // Add photo if changed
            if (newPhotoBase64) {
                updateData.photoURL = newPhotoBase64;
            }
            
            // Update Firestore
            const userDocRef = doc(db, 'users', currentUserData.id);
            await updateDoc(userDocRef, updateData);
            
            // Update localStorage
            const userData = JSON.parse(localStorage.getItem('puskesmas_user'));
            userData.displayName = newName;
            localStorage.setItem('puskesmas_user', JSON.stringify(userData));
            
            // Update current data
            currentUserData.name = newName;
            if (newPhotoBase64) {
                currentUserData.photoURL = newPhotoBase64;
            }
            
            // Update header display name
            document.getElementById('user-display-name').textContent = newName;
            
            // Show success
            statusEl.querySelector('p').textContent = '✅ Profile berhasil diperbarui!';
            statusEl.querySelector('p').className = 'text-sm text-green-600 font-semibold';
            
            setTimeout(() => {
                closeEditProfile();
                showDetailProfile(); // Reopen detail modal with updated data
            }, 1500);
            
        } catch (error) {
            console.error('Error updating profile:', error);
            statusEl.querySelector('p').textContent = '❌ Gagal menyimpan: ' + error.message;
            statusEl.querySelector('p').className = 'text-sm text-red-600';
            
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Simpan';
        }
    };

    // ==========================================
    // CHANGE PASSWORD MODAL
    // ==========================================
    window.showChangePassword = () => {
        closeDetailProfile();
        
        const modalHTML = `
            <div id="change-password-modal" class="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center z-[100] p-4">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-orange-500 to-orange-600 p-6 text-white relative rounded-t-2xl">
                        <button onclick="closeChangePassword()" class="absolute top-4 right-4 text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <h2 class="text-2xl font-bold">🔒 Ganti Password</h2>
                    </div>
                    
                    <!-- Body -->
                    <form id="change-password-form" class="p-6">
                        <p class="text-sm text-gray-600 mb-4">Masukkan password baru Anda. Password harus minimal 6 karakter.</p>
                        
                        <!-- New Password -->
                        <div class="mb-4">
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Password Baru</label>
                            <input type="password" id="new-password" required minlength="6" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                        </div>
                        
                        <!-- Confirm Password -->
                        <div class="mb-4">
                            <label class="block text-sm font-semibold text-gray-700 mb-2">Konfirmasi Password</label>
                            <input type="password" id="confirm-password" required minlength="6" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                        </div>
                        
                        <!-- Status Message -->
                        <div id="password-status" class="mb-4 hidden">
                            <p class="text-sm"></p>
                        </div>
                        
                        <!-- Buttons -->
                        <div class="flex gap-3">
                            <button type="button" onclick="closeChangePassword()" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition">
                                Batal
                            </button>
                            <button type="submit" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition shadow-md">
                                🔒 Ganti Password
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        $('change-password-form').addEventListener('submit', handleChangePasswordSubmit);
    };

    window.closeChangePassword = () => {
        const modal = $('change-password-modal');
        if (modal) modal.remove();
    };

    const handleChangePasswordSubmit = async (e) => {
        e.preventDefault();
        
        const statusEl = $('password-status');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const newPassword = $('new-password').value;
        const confirmPassword = $('confirm-password').value;
        
        // Validate
        if (newPassword !== confirmPassword) {
            statusEl.classList.remove('hidden');
            statusEl.querySelector('p').textContent = '❌ Password tidak cocok!';
            statusEl.querySelector('p').className = 'text-sm text-red-600';
            return;
        }
        
        if (newPassword.length < 6) {
            statusEl.classList.remove('hidden');
            statusEl.querySelector('p').textContent = '❌ Password minimal 6 karakter!';
            statusEl.querySelector('p').className = 'text-sm text-red-600';
            return;
        }
        
        // Show loading
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Mengubah...';
        statusEl.classList.remove('hidden');
        statusEl.querySelector('p').textContent = 'Mengubah password...';
        statusEl.querySelector('p').className = 'text-sm text-blue-600';
        
        try {
            const user = auth.currentUser;
            await updatePassword(user, newPassword);
            
            statusEl.querySelector('p').textContent = '✅ Password berhasil diubah!';
            statusEl.querySelector('p').className = 'text-sm text-green-600 font-semibold';
            
            setTimeout(() => {
                closeChangePassword();
            }, 1500);
            
        } catch (error) {
            console.error('Error changing password:', error);
            
            let errorMsg = 'Gagal mengubah password: ';
            if (error.code === 'auth/requires-recent-login') {
                errorMsg += 'Silakan logout dan login kembali sebelum mengubah password.';
            } else {
                errorMsg += error.message;
            }
            
            statusEl.querySelector('p').textContent = '❌ ' + errorMsg;
            statusEl.querySelector('p').className = 'text-sm text-red-600';
            
            submitBtn.disabled = false;
            submitBtn.textContent = '🔒 Ganti Password';
        }
    };
}