/**
 * Logika Khusus untuk Modul Data Pasien (Riwayat & Detail)
 * File: pasien.module.js
 */

import {
  collection,
  getDocs,
  query,
  orderBy,
  Timestamp,
  doc,
  updateDoc,
  where,
  writeBatch // Wajib diimport untuk penghapusan massal
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function initPasienModule(db, getAntrianCollectionPath) {
  const safeGet = id => document.getElementById(id);

  // --- UTILITY FUNCTIONS ---
  
  // UTILITY: Format Date ke YYYY-MM-DD
  const formatYMD = (date) => {
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  };

  // UTILITY: Mendapatkan Awal Hari Ini (untuk default filter)
  const getTodayDateString = () => {
      return formatYMD(new Date());
  }

  // FUNGSI UMUR: DIPERBAIKI UNTUK MENGATASI FORMAT DD-MM-YYYY
  const calculateAge = (dateString) => {
    if (!dateString) return '-';
    
    let birthDate;
    const parts = dateString.split('-');
    
    if (parts.length === 3) {
        birthDate = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
    } else {
        birthDate = new Date(dateString);
    }

    if (isNaN(birthDate.getTime())) {
        return 'Data Tanggal Invalid'; 
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
  };

  const formatDate = (ts) => {
    if (!ts) return '-';
    try {
      if (ts.toDate) ts = ts.toDate();
      const d = new Date(ts);
      // Mengubah format ke DD-MM-YYYY untuk tampilan yang lebih ramah pengguna
      return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    } catch (e) {
      return String(ts);
    }
  };

  // --- DATA & STATE ---
  let currentPatientsCache = []; 
  let filteredPatients = []; 
  let pasienDataById = {}; 
  let sortState = { column: null, dir: 'asc' }; 
  let pagination = { page: 1, perPage: 10 };
  
  // Kolom definisi - URUTAN BARU: [No., Tgl Kunjungan, Nama Pasien, ...]
  const COLUMNS = [
    { key: 'no', label: 'No.' },
    { key: 'tgl_kunjungan', label: 'Tgl Kunjungan' }, 
    { key: 'nama', label: 'Nama Pasien' },
    { key: 'nama_keluarga', label: 'Nama Keluarga' },
    { key: 'ttl_umur', label: 'TTL / Umur' },
    { key: 'jk', label: 'JK' },
    { key: 'alamat_full', label: 'Alamat' },
    { key: 'nik', label: 'NIK' },
    { key: 'kepesertaan', label: 'Kepesertaan' },
    { key: 'no_asuransi', label: 'No. Asuransi' },
    { key: 'pekerjaan', label: 'Pekerjaan' },
    { key: 'agama', label: 'Agama' },
    { key: 'nohp', label: 'No. HP' },
    { key: 'keluhan_preview', label: 'Keluhan' },
    { key: 'aksi', label: 'Aksi' }, 
  ];

  // --- FIRESTORE: fetch and dedupe by NIK (latest) ---
  const fetchAllPatients = async (startDate = null, endDate = null) => {
    const path = getAntrianCollectionPath();
    const colRef = collection(db, path);
    
    let queryConstraints = [];
    
    if (startDate) {
        // Filter: timestamp >= start date (awal hari)
        const startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0); 
        queryConstraints.push(where('timestamp', '>=', Timestamp.fromDate(startDay)));
    }
    
    if (endDate) {
        // Filter: timestamp <= end date (akhir hari)
        const endDay = new Date(endDate);
        endDay.setHours(23, 59, 59, 999); // Akhir hari yang dipilih
        queryConstraints.push(where('timestamp', '<=', Timestamp.fromDate(endDay)));
    }

    // Gabungkan query constraints dan order by timestamp descending
    const q = query(colRef, ...queryConstraints, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);

    const unique = new Map();
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const nik = data.nik || null;
      const key = nik ? nik : `__id__${docSnap.id}`; 
      
      // Jika NIK belum pernah dimasukkan, masukkan (karena data sudah di-order DESC, ini pasti data terbaru)
      if (!unique.has(key)) unique.set(key, { id: docSnap.id, ...data });
    });

    return Array.from(unique.values());
  };

  // 🚨 FUNGSI BARU: Mengambil semua data tanpa filter tanggal (untuk Modal Hapus)
  const fetchAllRecordsForDeletion = async () => {
    const path = getAntrianCollectionPath();
    const colRef = collection(db, path);
    
    // Mengambil semua data antrian yang ada, diurutkan berdasarkan timestamp terbaru
    const q = query(colRef, orderBy('timestamp', 'desc')); 
    const snapshot = await getDocs(q);
    
    const unique = new Map();
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const nik = data.nik || null;
      const key = nik ? nik : `__id__${docSnap.id}`; 
      
      // Menggunakan NIK sebagai kunci deduplikasi (untuk menampilkan list unik)
      if (!unique.has(key)) unique.set(key, { id: docSnap.id, ...data });
    });

    return Array.from(unique.values());
  };

  // --- RENDER UI (container + controls) ---
  const renderPasienView = async () => {
    const container = safeGet('content-container');
    if (!container) return;
    
    // SET TANGGAL DEFAULT KE HARI INI
    const today = getTodayDateString(); 

    container.innerHTML = `
    <div class="bg-white p-6 rounded-xl shadow-xl">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-3">
        <div>
            <h2 class="text-2xl font-bold text-gray-800">Data Pasien</h2>
            <p class="text-sm text-gray-500">Menampilkan seluruh riwayat pasien unik berdasarkan NIK (Filter berdasarkan riwayat antrian)</p>
        </div>

        <div class="flex flex-wrap gap-2 items-center w-full md:w-auto">
            <input id="filter-start-date" type="date" title="Mulai Tanggal" value="${today}" class="px-3 py-2 border rounded w-full md:w-40 text-sm" />
            <input id="filter-end-date" type="date" title="Sampai Tanggal" value="${today}" class="px-3 py-2 border rounded w-full md:w-40 text-sm" />
            <input id="pasien-search" type="text" placeholder="Cari nama, NIK, nomor HP, keluarga..." 
            class="px-3 py-2 border rounded w-full md:w-80" />
            <select id="pasien-perpage" class="px-3 py-2 border rounded">
            <option value="10">10 / halaman</option>
            <option value="25">25 / halaman</option>
            <option value="50">50 / halaman</option>
            <option value="0">Semua</option>
            </select>
            <button id="btn-refresh-pasien" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition whitespace-nowrap">Refresh</button>
            
            <button id="btn-export-csv" 
            class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition whitespace-nowrap">
            Export CSV
            </button>
            
            <button id="btn-delete-all" 
            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition whitespace-nowrap" 
            onclick="showSelectiveDeleteModal()">
            Hapus Data
            </button>
        </div>
        </div>

        <div class="overflow-x-auto border rounded-lg">
        <table id="pasien-table" class="min-w-[1500px] divide-y divide-gray-200">
        <thead class="bg-gray-50">
               <tr id="pasien-table-headers"></tr>
               </thead>
               <tbody id="data-pasien-table-body" class="bg-white divide-y divide-gray-200">
               <tr>
                   <td colspan="${COLUMNS.length}" class="p-4 text-center text-gray-500">
                   Memuat seluruh riwayat pasien...
                   </td>
               </tr>
               </tbody>
            </table>
        </div>

        <div id="pasien-pagination" class="mt-4 flex items-center justify-between"></div>
    </div>
    `;


    // build headers (clickable for sort)
    const headerRow = safeGet('pasien-table-headers');
    headerRow.innerHTML = COLUMNS.map((col, index) => {
        const borderClass = (index < COLUMNS.length - 1) ? 'border-r border-gray-200' : ''; 
        
        return `<th data-key="${col.key}" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${borderClass}">
                     ${col.label} <span class="ml-1 text-xs text-gray-400"></span>
                 </th>`;
    }).join('');

    // --- EVENT LISTENERS ---
    safeGet('btn-refresh-pasien').addEventListener('click', () => loadDataPasienAndRender());
    safeGet('btn-export-csv').addEventListener('click', () => exportVisibleToCSV());
    
    // LISTENER UNTUK FILTER TANGGAL (akan memicu loadDataPasienAndRender)
    if (safeGet('filter-start-date')) {
        safeGet('filter-start-date').addEventListener('change', () => loadDataPasienAndRender());
    }
    if (safeGet('filter-end-date')) {
        safeGet('filter-end-date').addEventListener('change', () => loadDataPasienAndRender());
    }
    // END LISTENER FILTER TANGGAL

    safeGet('pasien-perpage').addEventListener('change', (e) => {
      pagination.perPage = Number(e.target.value);
      pagination.page = 1;
      renderCurrentPage();
    });
    safeGet('pasien-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      applyFilter(q);
    });

    // header sort clicks
    headerRow.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        toggleSort(key);
      });
    });

    // initial load
    await loadDataPasienAndRender();
  };

  // --- LOADING & FILTERING LOGIC ---
  const loadDataPasienAndRender = async () => {
    const tbody = safeGet('data-pasien-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="p-4 text-center text-gray-500">Memuat seluruh riwayat pasien...</td></tr>`;
    
    const startDate = safeGet('filter-start-date') ? safeGet('filter-start-date').value : null;
    const endDate = safeGet('filter-end-date') ? safeGet('filter-end-date').value : null;

    // VALIDASI: Jika hanya satu tanggal yang diisi, samakan kedua tanggal tersebut
    let finalStartDate = startDate;
    let finalEndDate = endDate;

    if (finalStartDate && !finalEndDate) {
        finalEndDate = finalStartDate;
    } else if (finalEndDate && !finalStartDate) {
        finalStartDate = finalEndDate;
    }


    try {
      // Menggunakan finalStartDate dan finalEndDate untuk fetching data
      const patients = await fetchAllPatients(finalStartDate, finalEndDate); 
      currentPatientsCache = patients;
      // default filter = empty
      applyFilter(safeGet('pasien-search') ? safeGet('pasien-search').value.trim().toLowerCase() : '');
    } catch (err) {
      console.error("Error loading patients:", err);
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="p-4 text-center text-red-500">Gagal memuat data pasien. Cek konsol.</td></tr>`;
    }
  };

  const applyFilter = (q) => {
    if (!q) {
      filteredPatients = currentPatientsCache.slice();
    } else {
      filteredPatients = currentPatientsCache.filter(p => {
        const name = (p.nama_pasien || p.nama || '').toString().toLowerCase();
        const nik = (p.nik || '').toString().toLowerCase();
        const hp = (p.nomor_hp || p.no_hp || p.nomor_telepon || '').toString().toLowerCase();
        const keluarga = (p.nama_keluarga || '').toString().toLowerCase();
        return name.includes(q) || nik.includes(q) || hp.includes(q) || keluarga.includes(q);
      });
    }
    // reset pagination to first page after filter
    pagination.page = 1;
    // apply sort if any
    if (sortState.column) sortArray(filteredPatients, sortState.column, sortState.dir);
    renderCurrentPage();
  };

  // --- SORTING ---
  const toggleSort = (columnKey) => {
    if (sortState.column === columnKey) {
      sortState.dir = (sortState.dir === 'asc') ? 'desc' : 'asc';
    } else {
      sortState.column = columnKey;
      sortState.dir = 'asc';
    }
    updateHeaderSortIndicators();
    sortArray(filteredPatients, sortState.column, sortState.dir);
    renderCurrentPage();
  };

  const updateHeaderSortIndicators = () => {
    const headerRow = safeGet('pasien-table-headers');
    if (!headerRow) return;
    headerRow.querySelectorAll('th').forEach(th => {
      const key = th.getAttribute('data-key');
      const span = th.querySelector('span');
      if (!span) return;
      if (sortState.column === key) {
        span.textContent = sortState.dir === 'asc' ? '▲' : '▼';
      } else {
        span.textContent = '';
      }
    });
  };

  const sortArray = (arr, key, dir) => {
    if (!key) return;
    arr.sort((a, b) => {
      const A = getSortValue(a, key);
      const B = getSortValue(b, key);
      if (A == null && B == null) return 0;
      if (A == null) return dir === 'asc' ? 1 : -1;
      if (B == null) return dir === 'asc' ? -1 : 1;
      if (typeof A === 'number' && typeof B === 'number') return dir === 'asc' ? A - B : B - A;
      return dir === 'asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
  };

  const getSortValue = (p, key) => {
    switch (key) {
      case 'no': return 0; 
      case 'nama': return p.nama_pasien || p.nama || '';
      case 'nama_keluarga': return p.nama_keluarga || p.nama_kk || '';
      case 'ttl_umur': return p.tanggal_lahir ? new Date(p.tanggal_lahir).getTime() : 0;
      case 'jk': return p.jenis_kelamin || p.jk || '';
      case 'alamat_full': return (p.alamat_desa||'') + (p.alamat_dusun||'') + (p.alamat_rtrw||'');
      case 'nik': return p.nik || '';
      case 'tgl_kunjungan': return p.timestamp ? p.timestamp.toDate().getTime() : 0;
      case 'kepesertaan': return p.kepesertaan || '';
      case 'no_asuransi': return p.nomor_asuransi || p.no_asuransi || p.no_bpjs || '';
      case 'pekerjaan': return p.pekerjaan || '';
      case 'agama': return p.agama || '';
      case 'nohp': return p.nomor_hp || p.no_hp || p.hp || '';
      case 'keluhan_preview': return (p.keluhan || p.keluhan_pasien || p.komplain || '').slice(0,80);
      default: return '';
    }
  };

  // --- PAGINATION & RENDER PAGE ---
  const renderCurrentPage = () => {
    const tbody = safeGet('data-pasien-table-body');
    if (!tbody) return;

    const perPage = Number(pagination.perPage);
    const totalItems = filteredPatients.length;
    const totalPages = (perPage === 0) ? 1 : Math.max(1, Math.ceil(totalItems / perPage));
    if (pagination.page > totalPages) pagination.page = totalPages;

    let pageItems = [];
    if (perPage === 0) {
      pageItems = filteredPatients.slice();
    } else {
      const start = (pagination.page - 1) * perPage;
      pageItems = filteredPatients.slice(start, start + perPage);
    }

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="p-4 text-center text-gray-500">Belum ada riwayat pasien ditemukan.</td></tr>`;
      pasienDataById = {};
      return;
    }

    let rows = '';
    pageItems.forEach((pasien, idx) => {
      const globalIdx = ((pagination.perPage===0) ? idx : ( (pagination.page-1)*pagination.perPage + idx )) + 1;
      const no = globalIdx;
      const nama = pasien.nama_pasien || pasien.nama || '-';
      const nama_keluarga = pasien.nama_keluarga || pasien.nama_kk || '-';
      const tanggal_lahir = pasien.tanggal_lahir || pasien.ttl || pasien.tgl_lahir || '-';
      const umur = pasien.tanggal_lahir ? `${calculateAge(pasien.tanggal_lahir)} thn` : (pasien.umur ? `${pasien.umur} thn` : '-');
      const jk = pasien.jenis_kelamin || pasien.jk || '-';
      // EKSTRAKSI TGL KUNJUNGAN
      const tglKunjungan = pasien.timestamp ? formatDate(pasien.timestamp) : '-';
      const alamat_desa = pasien.alamat_desa || pasien.desa || '';
      const alamat_dusun = pasien.alamat_dusun || pasien.dusun || '';
      const alamat_rtrw = pasien.alamat_rtrw || pasien.rt_rw || '';
      const alamat_full = `${alamat_desa}${alamat_desa && alamat_dusun ? ' / ' : ''}${alamat_dusun}${alamat_rtrw ? ' / ' + alamat_rtrw : ''}` || '-';
      const nik = pasien.nik || '-';
      const kepesertaan = pasien.kepesertaan || pasien.kategori_asuransi || '-';
      const no_asuransi = pasien.nomor_asuransi || pasien.no_asuransi || pasien.no_bpjs || '-';
      const pekerjaan = pasien.pekerjaan || '-';
      const agama = pasien.agama || '-';
      const nohp = pasien.nomor_hp || pasien.no_hp || pasien.hp || '-';
      const keluhan = pasien.keluhan || pasien.keluhan_pasien || pasien.komplain || '-';
      const keluhanPreview = (keluhan && keluhan.length > 50) ? (keluhan.substring(0, 50) + '...') : keluhan; 
      
      const borderClass = 'border-r border-gray-200';
      const lastCellClass = 'text-center text-sm';

      rows += `
        <tr class="hover:bg-gray-50 align-top">
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${no}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${tglKunjungan}</td>
          <td class="px-4 py-3 text-sm text-gray-900 font-medium whitespace-nowrap ${borderClass}">${nama}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${nama_keluarga}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${tanggal_lahir} / ${umur}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${jk}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${alamat_full}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${nik}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${kepesertaan}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${no_asuransi}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${pekerjaan}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${agama}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">${nohp}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap ${borderClass}">
              <div class="flex items-start gap-2">
                 <div class="text-sm text-gray-700">${keluhanPreview === '-' ? '-' : keluhanPreview}</div>
                 ${keluhan && keluhan !== '-' ? `<button class="ml-2 text-xs text-indigo-600 underline" onclick="window.showPasienKeluhanDetail('${pasien.id}')">Lihat</button>` : ''}
              </div>
          </td>
          <td class="px-4 py-3 ${lastCellClass}">
              <button onclick="window.showPatientDetailModal('${pasien.id}')" class="text-xs text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded">Detail</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows;

    // map ID to data
    pasienDataById = {};
    pageItems.forEach(p => { pasienDataById[p.id] = p; });

    // render pagination controls
    renderPaginationControls(filteredPatients.length, pagination.page, perPage);
    updateHeaderSortIndicators();
  };

  const renderPaginationControls = (totalItems, currentPage, perPage) => {
    const container = safeGet('pasien-pagination');
    if (!container) return;

    const totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(totalItems / perPage));
    let pagesHtml = '';

    // previous
    pagesHtml += `<div class="flex items-center gap-2">
      <button id="page-prev" class="px-3 py-1 border rounded ${currentPage<=1 ? 'opacity-50 cursor-not-allowed' : ''}">Prev</button>
    </div>`;

    // page numbers (compact: show up to 7 numbers)
    const start = Math.max(1, currentPage - 3);
    const end = Math.min(totalPages, currentPage + 3);

    pagesHtml += `<div class="flex items-center gap-2">`;
    for (let p = start; p <= end; p++) {
      pagesHtml += `<button class="page-number px-3 py-1 border rounded ${p===currentPage ? 'bg-gray-200' : ''}" data-page="${p}">${p}</button>`;
    }
    pagesHtml += `</div>`;

    // next & info
    pagesHtml += `<div class="flex items-center gap-3">
      <button id="page-next" class="px-3 py-1 border rounded ${currentPage>=totalPages ? 'opacity-50 cursor-not-allowed' : ''}">Next</button>
      <span class="text-sm text-gray-600">Halaman ${currentPage} / ${totalPages} — Total ${totalItems} item</span>
    </div>`;

    container.innerHTML = pagesHtml;

    // listeners
    const prevBtn = safeGet('page-prev');
    const nextBtn = safeGet('page-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (pagination.page>1) { pagination.page--; renderCurrentPage(); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { const tp = perPage===0?1:Math.ceil(totalItems/perPage); if (pagination.page<tp) { pagination.page++; renderCurrentPage(); } });

    container.querySelectorAll('.page-number').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = Number(e.currentTarget.getAttribute('data-page'));
        pagination.page = p;
        renderCurrentPage();
      });
    });
  };

  // --- MODAL keluhan detail (Logika tidak diubah) ---
  window.showPasienKeluhanDetail = (id) => {
    const p = pasienDataById[id] || currentPatientsCache.find(x => x.id === id);
    if (!p) return alert('Data pasien tidak ditemukan.');
    const keluhan = p.keluhan || p.keluhan_pasien || p.komplain || '-';
    const nama = p.nama_pasien || p.nama || '-';
    const existing = document.getElementById('pasien-keluhan-modal');
    if (existing) existing.remove();
    const modal = `
      <div id="pasien-keluhan-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          <div class="p-4 border-b flex justify-between items-center">
            <h3 class="text-lg font-bold">Keluhan Pasien: ${nama}</h3>
            <button onclick="document.getElementById('pasien-keluhan-modal').remove()" class="text-gray-500">✕</button>
          </div>
          <div class="p-6">
            <pre class="whitespace-pre-wrap text-gray-800">${keluhan}</pre>
          </div>
          <div class="p-4 border-t text-right">
            <button onclick="document.getElementById('pasien-keluhan-modal').remove()" class="px-4 py-2 bg-gray-200 rounded">Tutup</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modal);
  };

  // --- LOGIKA PENGHAPUSAN SELEKTIF (MODAL) ---

  // 🚨 FUNGSI BARU: Menampilkan Modal Seleksi Penghapusan
  window.showSelectiveDeleteModal = async () => {
    // Ambil SEMUA data pasien yang sudah di deduplicate (All-Time)
    const patientsToSelect = await fetchAllRecordsForDeletion(); 
    
    if (patientsToSelect.length === 0) {
        return alert("Tidak ada data pasien (riwayat) yang tersedia untuk dihapus.");
    }

    const patientListHtml = patientsToSelect.map((p, index) => {
        const nama = p.nama_pasien || p.nama || 'Anonim';
        const nik = p.nik || 'ID: ' + p.id.substring(0, 5);
        const tglKunjungan = p.timestamp ? formatDate(p.timestamp) : '-';

        return `
            <div class="flex items-center justify-between p-3 border-b hover:bg-gray-50">
                <div class="flex items-center space-x-3">
                    <input type="checkbox" data-doc-id="${p.id}" class="patient-delete-checkbox h-4 w-4 text-red-600 border-gray-300 rounded">
                    <div>
                        <p class="font-semibold text-gray-900">${nama}</p>
                        <p class="text-xs text-gray-500">NIK: ${nik} | Kunjungan Terakhir: ${tglKunjungan}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const modalHtml = `
      <div id="selective-delete-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div class="p-4 border-b flex justify-between items-center bg-red-500 text-white">
            <h3 class="text-lg font-bold">Hapus Data Pasien Terpilih</h3>
            <button onclick="document.getElementById('selective-delete-modal').remove()" class="text-white">✕</button>
          </div>
          
          <div class="p-4 flex items-center border-b bg-gray-100">
            <input type="checkbox" id="select-all-patients" class="h-4 w-4 text-red-600 border-gray-300 rounded mr-3">
            <label for="select-all-patients" class="font-semibold text-sm text-gray-700">Pilih Semua (${patientsToSelect.length} Data)</label>
          </div>

          <div id="patient-list-for-delete" class="p-2 max-h-80 overflow-y-auto">
            ${patientListHtml}
          </div>

          <div class="p-4 border-t flex justify-end space-x-3">
            <button onclick="document.getElementById('selective-delete-modal').remove()" class="px-4 py-2 bg-gray-200 rounded text-gray-700">Batal</button>
            <button id="btn-delete-selected" class="px-4 py-2 bg-red-600 rounded text-white disabled:opacity-50" disabled>
                Hapus Terpilih (<span id="delete-count">0</span>)
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Setup Event Listeners dalam modal
    const selectAll = safeGet('select-all-patients');
    const deleteBtn = safeGet('btn-delete-selected');
    const checkboxes = document.querySelectorAll('.patient-delete-checkbox'); 
    const deleteCountSpan = safeGet('delete-count');
    
    // 🚨 DEFINISI FUNGSI DIPINDAH DI ATAS PANGGILANNYA (untuk mengatasi ReferenceError)
    const updateDeleteButtonState = () => {
        const checked = document.querySelectorAll('.patient-delete-checkbox:checked');
        deleteCountSpan.textContent = checked.length;
        deleteBtn.disabled = checked.length === 0;
    };
    
    // Logic Pilih Semua
    selectAll.addEventListener('change', (e) => {
        checkboxes.forEach(cb => {
            cb.checked = e.target.checked;
        });
        updateDeleteButtonState();
    });

    // Logic Update Tombol Hapus
    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateDeleteButtonState);
    });

    // Logic Hapus Terpilih
    deleteBtn.addEventListener('click', handleDeleteSelected);
  };

  // 🚨 FUNGSI BARU: Logika Penghapusan Item yang Dipilih
  const handleDeleteSelected = async () => {
    const checked = document.querySelectorAll('#patient-list-for-delete .patient-delete-checkbox:checked');
    const idsToDelete = Array.from(checked).map(cb => cb.getAttribute('data-doc-id'));

    if (idsToDelete.length === 0) return alert('Pilih minimal satu data untuk dihapus.');
    
    if (!confirm(`Anda yakin ingin menghapus ${idsToDelete.length} data pasien terpilih? Aksi ini permanen!`)) {
        return;
    }

    // Tampilkan loading di modal
    const modalContent = safeGet('selective-delete-modal').querySelector('.bg-white');
    modalContent.innerHTML = `<div class="p-10 text-center text-red-600 font-bold">SEDANG MENGHAPUS ${idsToDelete.length} DATA... MOHON TUNGGU.</div>`;

    try {
        const path = getAntrianCollectionPath();
        const batch = writeBatch(db);
        
        idsToDelete.forEach(id => {
            batch.delete(doc(db, path, id));
        });

        await batch.commit();

        document.getElementById('selective-delete-modal').remove();
        alert(`Sukses! ${idsToDelete.length} riwayat pasien berhasil dihapus.`);
        
        // Muat ulang data utama di belakang layar
        loadDataPasienAndRender(); 

    } catch (error) {
        console.error("Error deleting selected patients:", error);
        alert(`Gagal menghapus data: ${error.message}`);
        // Muat ulang data meskipun gagal
        loadDataPasienAndRender();
        document.getElementById('selective-delete-modal').remove();
    }
  }

  // Placeholder untuk Modal Detail Pasien (Harus dibuat di dashboard.html)
  window.showPatientDetailModal = (id) => {
      const p = pasienDataById[id] || currentPatientsCache.find(x => x.id === id);
      if (!p) return alert('Data pasien tidak ditemukan.');
      // Lakukan implementasi modal detail di sini atau panggil fungsi global dari dashboard.client.js
      alert(`Menampilkan detail lengkap pasien NIK: ${p.nik || p.id}`);
  }


  // --- EKSPOR FUNGSI ---
  return {
    renderPasienView,
    loadDataPasienAndRender,
    getPatientData: () => currentPatientsCache
  };
}