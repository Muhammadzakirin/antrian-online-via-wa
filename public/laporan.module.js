/**
 * laporan.module.js (Final Layout Stabilization - Perbaikan Chart Data)
 * Modul Laporan — ringkasan & daftar pasien dari koleksi antrian + grafik
 */

import {
  collection,
  getDocs,
  query,
  orderBy,
  Timestamp,
  where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function initLaporanModule(db, getAntrianCollectionPath) {
  const $ = id => document.getElementById(id);

  // --- UTILITY TANGGAL & HELPER ---
  
  // 🚨 UTILITY BARU: Parsing tanggal input HTML (YYYY-MM-DD) agar tidak kena offset zona waktu
  const parseDateInput = (dateString) => {
      if (!dateString) return null;
      // Membuat Date object tanpa offset zona waktu
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(year, month - 1, day); // month is 0-indexed
  };


  const getTodayStartTimestamp = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(today);
  };

  const fmtDate = (d) => {
    if (!d) return '-';
    try {
      const date = (d.toDate) ? d.toDate() : new Date(d);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (e) {
      return String(d);
    }
  };

  const fmtDateShort = (d) => { // Untuk label di chart
    if (!d) return '-';
    try {
      const date = (d.toDate) ? d.toDate() : new Date(d);
      const day = String(date.getDate()).padStart(2, '0');
      const m = String(date.getMonth() + 1).padStart(2, '0');
      return `${day}/${m}`;
    } catch (e) {
      return String(d);
    }
  };

  const calcAge = (dob) => {
    if (!dob) return '-';
    try {
      // Menggunakan logika yang aman dari module pasien
      let birthDate;
      const parts = dob.split('-');
      
      if (parts.length === 3 && parts[0].length !== 4) {
          birthDate = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
      } else {
          birthDate = new Date(dob);
      }
      
      if (isNaN(birthDate.getTime())) return '-';
      
      const t = new Date();
      let age = t.getFullYear() - birthDate.getFullYear();
      const m = t.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < birthDate.getDate())) age--;
      return age;
    } catch (e) {
      return '-';
    }
  };

  // STATE
  let allData = [];
  let filteredData = [];
  let sortState = {
    column: null,
    dir: 'asc'
  };
  let pagination = {
    page: 1,
    perPage: 10
  };

  // Chart instances
  let chartBar = null;
  let chartLine = null;
  let chartPie = null;
  let chartJsLoaded = false;
  let pendingChartRender = false;

  // --- Load Chart.js dynamically ---
  const loadChartJs = () => {
    return new Promise((resolve, reject) => {
      if (chartJsLoaded || window.Chart) {
        chartJsLoaded = true;
        return resolve();
      }
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
      script.onload = () => {
        chartJsLoaded = true;
        resolve();
      };
      script.onerror = (e) => reject(new Error('Gagal memuat Chart.js'));
      document.head.appendChild(script);
    });
  };

  // Helper untuk memastikan Chart.js dimuat, lalu panggil render
  const ensureCharts = () => {
    if (chartJsLoaded) {
      updateCharts(filteredData);
    } else if (!pendingChartRender) {
      pendingChartRender = true;
      loadChartJs()
        .then(() => {
          updateCharts(filteredData);
        })
        .catch(e => console.error(e))
        .finally(() => {
          pendingChartRender = false;
        });
    }
  };

  // --- RENDER VIEW ---
  const renderLaporanView = async () => {
    const container = $('content-container');
    if (!container) return;

    // Set tanggal hari ini untuk input filter secara default
    const todayFormatted = fmtDate(new Date());

    // Hancurkan instance lama
    if (chartBar) chartBar.destroy();
    chartBar = null;
    if (chartLine) chartLine.destroy();
    chartLine = null;
    if (chartPie) chartPie.destroy();
    chartPie = null;

    container.innerHTML = `
        <div class="bg-white p-6 rounded-xl shadow-xl">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h2 class="text-2xl font-bold text-gray-800">Laporan Antrian</h2>
              <p class="text-sm text-gray-500">Ringkasan & laporan pasien berdasarkan data antrian (semua poli)</p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <label class="text-sm text-gray-600">Periode:</label>
              <input id="lap-from" type="date" value="${todayFormatted}" class="px-3 py-2 border rounded" />
              <input id="lap-to" type="date" value="${todayFormatted}" class="px-3 py-2 border rounded" />

              <select id="lap-jenis-kelamin" class="px-3 py-2 border rounded">
                <option value="">Semua JK</option>
                <option value="Laki-laki">Laki-laki</option>
                <option value="Perempuan">Perempuan</option>
              </select>

              <select id="lap-kepesertaan" class="px-3 py-2 border rounded">
                <option value="">Semua Kepesertaan</option>
                <option value="BPJS">BPJS</option>
                <option value="Umum">Umum</option>
                <option value="Lainnya">Lainnya</option>
              </select>

              <input id="lap-desa" placeholder="Desa (opsional)" class="px-3 py-2 border rounded" />

              <button id="lap-refresh" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">Terapkan</button>
              <button id="lap-export" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition">Export CSV</button>
            </div>
          </div>

          <div id="lap-stats" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-white border p-4 rounded shadow-sm">
              <div class="text-sm text-gray-500">Total Pasien</div>
              <div id="stat-total" class="text-2xl font-bold text-gray-800">0</div>
            </div>
            <div class="bg-white border p-4 rounded shadow-sm">
              <div class="text-sm text-gray-500">Per Poli (Top 5)</div>
              <div id="stat-poli" class="text-2xl font-bold text-gray-800">0</div>
            </div>
            <div class="bg-white border p-4 rounded shadow-sm">
              <div class="text-sm text-gray-500">Jenis Kelamin</div>
              <div id="stat-jk" class="text-2xl font-bold text-gray-800">0</div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

            <div class="bg-white border p-4 rounded shadow-sm relative h-[250px]">
              <h4 class="text-sm text-gray-600 mb-2">Pasien Poli / Ruangan</h4>
              <div id="chart-poli-wrapper" class="w-full h-full relative pt-2">
                <canvas id="chart-poli" class="w-full h-full"></canvas>
              </div>
            </div>

            <div class="bg-white border p-4 rounded shadow-sm relative h-[250px]">
              <h4 class="text-sm text-gray-600 mb-2">Kunjungan Pasien Lama/Baru</h4>
              <div id="chart-pie-lama-baru-wrapper" class="w-full h-full relative flex items-center justify-center">
                <canvas id="chart-pie-lama-baru" class="w-40 h-40"></canvas>
              </div>
            </div>

            <div class="bg-white border p-4 rounded shadow-sm relative h-[250px]">
              <h4 class="text-sm text-gray-600 mb-2">Kunjungan 7 Hari Kebelakang</h4>
              <div id="chart-trend-wrapper" class="w-full h-full relative pt-2">
                <canvas id="chart-trend" class="w-full h-full"></canvas>
              </div>
            </div>
          </div>

          <div class="overflow-x-auto border rounded-lg mb-4">
            <table id="lap-table" class="min-w-[1100px] divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr id="lap-headers">
                  <th data-key="no" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">No</th>
                  <th data-key="tanggal" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Tanggal</th>
                  <th data-key="no_antrian" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">No Antrian</th>
                  <th data-key="nama" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Nama</th>
                  <th data-key="nik" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">NIK</th>
                  <th data-key="kepesertaan" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Kepesertaan</th>
                  <th data-key="poli_tujuan" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Poli</th>
                  <th data-key="jenis_kelamin" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">JK</th>
                  <th data-key="keluhan" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Keluhan</th>
                  <th data-key="status" class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">Status</th>
                </tr>
              </thead>
              <tbody id="lap-body" class="bg-white divide-y divide-gray-200">
                <tr><td colspan="10" class="p-4 text-center text-gray-500">Memuat data laporan...</td></tr>
              </tbody>
            </table>
          </div>

          <div id="lap-pagination" class="mt-4 flex items-center justify-between"></div>
        </div>
      `;

    // 🚨 RESET STATS KOSONG
    if ($('stat-poli')) $('stat-poli').textContent = '0';
    if ($('stat-jk')) $('stat-jk').textContent = '0';

    // attach listeners
    $('lap-refresh').addEventListener('click', () => loadAndRender());
    $('lap-export').addEventListener('click', () => exportCSV(filteredData));

    // Tambahkan listener change untuk langsung render saat filter tanggal diubah
    $('lap-from').addEventListener('change', () => loadAndRender());
    $('lap-to').addEventListener('change', () => loadAndRender());
    $('lap-jenis-kelamin').addEventListener('change', () => applyFiltersAndRender());
    $('lap-kepesertaan').addEventListener('change', () => applyFiltersAndRender());
    $('lap-desa').addEventListener('input', () => applyFiltersAndRender());


    // header sort listeners
    document.querySelectorAll('#lap-headers th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        toggleSort(key);
      });
    });

    // initial load
    await loadAndRender();
  };

  // --- LOAD & FILTER ---
  const loadAndRender = async () => {
    try {
      const path = getAntrianCollectionPath();
      const colRef = collection(db, path);

      let queryConstraints = [];
      let fromVal = $('lap-from').value;
      let toVal = $('lap-to').value;

      let startTs;
      let endTs;

      // 🚨 PERBAIKAN LOGIKA TANGGAL TUNGGAL & PARSING INPUT
      if (fromVal || toVal) {
          // Jika hanya satu field diisi, samakan kedua field
          if (fromVal && !toVal) toVal = fromVal;
          if (toVal && !fromVal) fromVal = toVal;

          // Parsing tanggal input (YYYY-MM-DD)
          const startDate = parseDateInput(fromVal);
          const endDate = parseDateInput(toVal);

          if (startDate && endDate) {
              startTs = Timestamp.fromDate(startDate);
              endDate.setHours(23, 59, 59, 999);
              endTs = Timestamp.fromDate(endDate);
          } else {
              // Fallback jika parsing gagal, gunakan default hari ini
              startTs = getTodayStartTimestamp();
              const endDay = new Date();
              endDay.setHours(23, 59, 59, 999);
              endTs = Timestamp.fromDate(endDay);
              
              // Update UI jika fallback terjadi
              $('lap-from').value = fmtDate(startTs);
              $('lap-to').value = fmtDate(endTs);
          }
      } else {
          // Default load adalah ALL TIME jika field kosong
          // Namun, karena UI defaultnya Hari Ini, kita pakai default UI:
          startTs = getTodayStartTimestamp();
          const endDay = new Date();
          endDay.setHours(23, 59, 59, 999);
          endTs = Timestamp.fromDate(endDay);
      }


      // 2. Terapkan filter ke Query Firestore
      queryConstraints.push(where('timestamp', '>=', startTs));
      queryConstraints.push(where('timestamp', '<=', endTs));

      const q = query(colRef, ...queryConstraints, orderBy('timestamp', 'desc'));
      const snap = await getDocs(q);

      allData = [];
      snap.forEach(d => {
        allData.push({
          id: d.id,
          ...d.data()
        });
      });

      // Terapkan filter tambahan (JK, Kepesertaan, Desa) di sisi klien
      applyFiltersAndRender();

    } catch (e) {
      console.error("Error loading and rendering reports:", e);
      if ($('lap-body')) $('lap-body').innerHTML = `<tr><td colspan="10" class="p-4 text-center text-red-500">Gagal mengambil data. Cek konsol.</td></tr>`;
    }
  };

  const applyFiltersAndRender = () => {

    const jk = $('lap-jenis-kelamin').value;
    const kep = $('lap-kepesertaan').value;
    const desa = $('lap-desa').value.trim().toLowerCase();

    filteredData = allData.filter(item => {

      if (jk && ((item.jenis_kelamin || '').toLowerCase() !== jk.toLowerCase())) return false;
      if (kep && ((item.kepesertaan || '').toLowerCase() !== kep.toLowerCase())) return false;
      if (desa) {
        const ad = (item.alamat_desa || item.desa || '').toString().toLowerCase();
        if (!ad.includes(desa)) return false;
      }
      return true;
    });

    if (sortState.column) sortArray(filteredData, sortState.column, sortState.dir);

    pagination.page = 1;
    renderReport();
    renderStats();
    // Panggil fungsi ensureCharts yang baru
    ensureCharts();
  };

  // --- STATS, SORTING, RENDER REPORT ---

  const renderStats = () => {
    const total = filteredData.length;
    if ($('stat-total')) $('stat-total').textContent = total;

    const poliCount = {};
    filteredData.forEach(it => {
      const p = (it.poli_tujuan || 'UMUM').toUpperCase().trim();
      poliCount[p] = (poliCount[p] || 0) + 1;
    });
    // Menampilkan Top 5 poli pada kartu statistik
    const poliList = Object.entries(poliCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join('<br/>') || '-';
    if ($('stat-poli')) $('stat-poli').innerHTML = poliList.replace(/<br\/>/g, ' / ') || '0';

    const jkCount = {};
    filteredData.forEach(it => {
      const j = (it.jenis_kelamin || 'Tidak Diketahui');
      jkCount[j] = (jkCount[j] || 0) + 1;
    });
    const jkList = Object.entries(jkCount).map(([k, v]) => `${k}: ${v}`).join(' — ') || '-';
    if ($('stat-jk')) $('stat-jk').innerHTML = jkList.replace(/ — /g, ' / ') || '0';
  };

  const toggleSort = (key) => {
    if (sortState.column === key) {
      sortState.dir = (sortState.dir === 'asc') ? 'desc' : 'asc';
    } else {
      sortState.column = key;
      sortState.dir = 'asc';
    }
    if (sortState.column) sortArray(filteredData, sortState.column, sortState.dir);
    renderReport();
    document.querySelectorAll('#lap-headers th').forEach(th => {
      const k = th.getAttribute('data-key');
      th.querySelectorAll('.sort-ind').forEach(n => n.remove());
      if (k === sortState.column) {
        th.insertAdjacentHTML('beforeend', `<span class="sort-ind ml-2 text-xs">${sortState.dir==='asc'?'▲':'▼'}</span>`);
      }
    });
  };

  const sortArray = (arr, key, dir) => {
    arr.sort((a, b) => {
      const A = getValueForSort(a, key);
      const B = getValueForSort(b, key);
      if (A == null && B == null) return 0;
      if (A == null) return dir === 'asc' ? 1 : -1;
      if (B == null) return dir === 'asc' ? -1 : 1;
      if (typeof A === 'number' && typeof B === 'number') return dir === 'asc' ? A - B : B - A;
      return dir === 'asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
  };

  const getValueForSort = (item, key) => {
    switch (key) {
      case 'tanggal':
        return item.timestamp ? (item.timestamp.toDate ? item.timestamp.toDate().getTime() : new Date(item.timestamp).getTime()) : 0;
      case 'no_antrian':
        return item.no_antrian || 0;
      case 'nama':
        return (item.nama_pasien || item.nama || '').toLowerCase();
      case 'nik':
        return (item.nik || '').toLowerCase();
      case 'kepesertaan':
        return (item.kepesertaan || '').toLowerCase();
      case 'poli_tujuan':
        return (item.poli_tujuan || '').toLowerCase();
      case 'jenis_kelamin':
        return (item.jenis_kelamin || '').toLowerCase();
      case 'status':
        return item.status || 0;
      default:
        return '';
    }
  };

  // --- RENDER REPORT TABLE (with pagination) ---
  const renderReport = () => {
    const tbody = $('lap-body');
    if (!tbody) return;

    const perPage = 10;
    const totalItems = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    if (pagination.page > totalPages) pagination.page = totalPages;

    let pageItems = filteredData.slice((pagination.page - 1) * perPage, pagination.page * perPage);

    if (!pageItems.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-gray-500">Tidak ada data untuk periode/fitur yang dipilih.</td></tr>`;
      renderPaginationControls(totalItems, pagination.page, perPage);
      return;
    }

    let rows = '';
    pageItems.forEach((it, idx) => {
      const no = ((pagination.page - 1) * perPage) + idx + 1;
      const tanggal = it.timestamp ? fmtDate(it.timestamp) : '-';
      const no_antrian = it.no_antrian || '-';
      const nama = it.nama_pasien || it.nama || '-';
      const nik = it.nik || '-';
      const kep = it.kepesertaan || '-';
      const poli = it.poli_tujuan || '-';
      const jk = it.jenis_kelamin || '-';
      const keluhan = it.keluhan || it.keluhan_pasien || '-';
      const statusText = it.status === 0 ? 'Menunggu' : (it.status === 1 ? 'Diproses' : (it.status === 2 ? 'Selesai' : String(it.status))); // Ubah it.status ke r.status

      rows += `
        <tr class="hover:bg-gray-50 align-top">
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${no}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${tanggal}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${no_antrian}</td>
          <td class="px-4 py-3 text-sm text-gray-900 font-medium">${nama}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${nik}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${kep}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${poli}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${jk}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${keluhan.length>120 ? keluhan.slice(0,120)+'...' : keluhan}</td>
          <td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">${statusText}</td>
        </tr>
      `;
    });

    tbody.innerHTML = rows;
    renderPaginationControls(totalItems, pagination.page, perPage);
  };

  const renderPaginationControls = (totalItems, currentPage, perPage) => {
    const container = $('lap-pagination');
    if (!container) return;

    const totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(totalItems / perPage));
    if (totalPages <= 1) {
      container.innerHTML = `<div class="text-sm text-gray-600">Total ${totalItems} item</div>`;
      return;
    }

    let html = `<div class="flex items-center gap-2">`;
    html += `<button id="lap-prev" class="px-3 py-1 border rounded ${currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''}">Prev</button>`;
    const start = Math.max(1, currentPage - 3);
    const end = Math.min(totalPages, currentPage + 3);
    for (let p = start; p <= end; p++) {
      html += `<button class="lap-page px-3 py-1 border rounded ${p === currentPage ? 'bg-gray-200' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button id="lap-next" class="px-3 py-1 border rounded ${currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}">Next</button>`;
    html += `</div>`;
    html += `<div class="text-sm text-gray-600">Halaman ${currentPage} / ${totalPages} — Total ${totalItems} item</div>`;

    container.innerHTML = `<div class="flex items-center justify-between w-full">${html}</div>`;

    const prev = $('lap-prev');
    const next = $('lap-next');
    if (prev) prev.addEventListener('click', () => {
      if (pagination.page > 1) {
        pagination.page--;
        renderReport();
      }
    });
    if (next) next.addEventListener('click', () => {
      if (pagination.page < totalPages) {
        pagination.page++;
        renderReport();
      }
    });
    container.querySelectorAll('.lap-page').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = Number(e.currentTarget.getAttribute('data-page'));
        pagination.page = p;
        renderReport();
      });
    });
  };

  // --- NEW: FUNCTION TO CALCULATE CHART DATA ---
  const generateChartData = (data) => {
    // 1. Data Poli
    const poliCount = {};
    const lamaBaruCount = {
      Lama: 0,
      Baru: 0
    };
    const dayCount = {};

    // Inisialisasi 7 hari kebelakang
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKeys = [];
    const dayTimestamps = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.getTime();
      dayCount[key] = 0;
      dayKeys.push(fmtDateShort(d)); // Label: DD/MM
      dayTimestamps.push(key);
    }

    data.forEach(item => {
      // Poli
      const p = (item.poli_tujuan || 'UMUM').toUpperCase().trim();
      poliCount[p] = (poliCount[p] || 0) + 1;

      // Lama/Baru
      const statusKunjungan = (item.kunjungan_status || 'Baru');
      if (statusKunjungan === 'Lama') {
        lamaBaruCount.Lama++;
      } else {
        lamaBaruCount.Baru++;
      }

      // Trend 7 Hari (hanya hitung jika tanggal berada dalam rentang 7 hari)
      if (item.timestamp && item.timestamp.toDate) {
        const itemDate = item.timestamp.toDate();
        itemDate.setHours(0, 0, 0, 0);
        const itemTime = itemDate.getTime();
        
        // Cek apakah itemTime adalah salah satu dari 7 hari yang diinisialisasi
        const isWithin7Days = dayTimestamps.includes(itemTime);
        if (isWithin7Days) {
           dayCount[itemTime] = (dayCount[itemTime] || 0) + 1;
        }
      }
    });

    // Urutkan data poli (Top 5)
    const sortedPoli = Object.entries(poliCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const poliLabels = sortedPoli.map(p => p[0]);
    const poliValues = sortedPoli.map(p => p[1]);

    // Format data trend
    const dayValues = dayTimestamps.map(ts => dayCount[ts] || 0);

    return {
      poliLabels,
      poliValues,
      lamaBaruLabels: ['Lama', 'Baru'],
      lamaBaruValues: [lamaBaruCount.Lama, lamaBaruCount.Baru],
      dayKeys,
      dayValues,
    };
  };

  // --- CHARTS: build datasets from filteredData ---
  const updateCharts = (data) => {
    const {
      poliLabels,
      poliValues,
      lamaBaruLabels,
      lamaBaruValues,
      dayKeys,
      dayValues
    } = generateChartData(data); // <-- Panggil fungsi baru

    // WARNA untuk Chart Poli (didekati sesuai gambar)
    const poliColors = {
      'UMUM': 'rgba(153, 102, 102, 0.8)',
      'KONSELING': 'rgba(255, 222, 173, 0.8)',
      'GIGI': 'rgba(240, 230, 140, 0.8)',
      'KIA': 'rgba(128, 0, 128, 0.8)',
      'GAWAT DARURAT': 'rgba(147, 112, 219, 0.8)',
      'INAP UMUM': 'rgba(139, 69, 19, 0.8)',
      'GUDANG FARMASI': 'rgba(70, 130, 180, 0.8)',
      'APOTEK': 'rgba(105, 105, 105, 0.8)',
      'LABORATORIUM': 'rgba(54, 69, 79, 0.8)',
      'DEFAULT': 'rgba(180, 180, 180, 0.8)'
    };

    const poliBackgroundColors = poliLabels.map(label => poliColors[label] || poliColors['DEFAULT']);
    const poliBorderColors = poliBackgroundColors.map(color => color.replace('0.8', '1'));

    // 1. Bar chart for poli
    const ctxBar = $('chart-poli');
    if (ctxBar) {
      if (chartBar) {
        chartBar.data.labels = poliLabels;
        chartBar.data.datasets[0].data = poliValues;
        chartBar.data.datasets[0].backgroundColor = poliBackgroundColors;
        chartBar.data.datasets[0].borderColor = poliBorderColors;
        chartBar.update();
      } else if (chartJsLoaded && window.Chart) {
        chartBar = new Chart(ctxBar, {
          type: 'bar',
          data: {
            labels: poliLabels,
            datasets: [{
              label: 'Jumlah pasien',
              data: poliValues,
              backgroundColor: poliBackgroundColors,
              borderColor: poliBorderColors,
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'x',
            scales: {
              x: {
                ticks: {
                  maxRotation: 45,
                  minRotation: 0,
                  mirror: false
                },
                grid: {
                  display: false
                }
              },
              y: {
                beginAtZero: true,
                precision: 0,
                grid: {
                  display: true
                }
              }
            },
            plugins: {
              legend: {
                display: false, // Ubah ke false karena label sudah ada di sumbu x
                position: 'top',
                align: 'start',
                labels: {
                  boxWidth: 20,
                  padding: 10
                }
              },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.label}: ${context.raw}`
                }
              }
            }
          }
        });
      }
    }

    // 2. Pie chart for Lama/Baru
    const ctxPie = $('chart-pie-lama-baru');
    if (ctxPie) {
      if (chartPie) {
        chartPie.data.labels = lamaBaruLabels;
        chartPie.data.datasets[0].data = lamaBaruValues;
        chartPie.update();
      } else if (chartJsLoaded && window.Chart) {
        chartPie = new Chart(ctxPie, {
          type: 'pie',
          data: {
            labels: lamaBaruLabels,
            datasets: [{
              label: 'Jumlah Kunjungan',
              data: lamaBaruValues,
              backgroundColor: [
                'rgba(75, 192, 192, 1)',
                'rgba(50, 205, 50, 1)',
              ],
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'center',
                labels: {
                  boxWidth: 15,
                  padding: 10
                }
              },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.label}: ${context.raw}`
                }
              }
            }
          }
        });
      }
    }


    // 3. Line chart for trend (7 Hari)
    const ctxLine = $('chart-trend');
    if (ctxLine) {
      if (chartLine) {
        chartLine.data.labels = dayKeys;
        chartLine.data.datasets[0].data = dayValues;
        chartLine.update();
      } else if (chartJsLoaded && window.Chart) {
        chartLine = new Chart(ctxLine, {
          type: 'line',
          data: {
            labels: dayKeys,
            datasets: [{
              label: 'Pasien per hari',
              data: dayValues,
              fill: 'origin',
              tension: 0.4,
              backgroundColor: 'rgba(16,185,129,0.25)',
              borderColor: 'rgba(16,185,129,1)',
              pointRadius: 5,
              pointBackgroundColor: 'rgba(16,185,129,1)',
              pointBorderColor: '#fff',
              pointHoverRadius: 7
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                ticks: {
                  maxRotation: 0,
                  minRotation: 0
                },
                grid: {
                  display: false
                }
              },
              y: {
                beginAtZero: true,
                precision: 0,
                grid: {
                  display: true
                }
              }
            },
            plugins: {
              legend: {
                display: false
              }
            }
          }
        });
      }
    }
  };

  // --- EXPORT CSV ---
  const exportCSV = (rowsData) => {
    if (!rowsData || !rowsData.length) return alert('Tidak ada data untuk diexport.');
    const headers = ['Tanggal', 'No Antrian', 'Nama', 'NIK', 'Kepesertaan', 'Poli', 'Jenis Kelamin', 'Keluhan', 'Status'];
    const lines = [headers.map(h => `"${h.replace(/"/g,'""')}"`).join(',')];

    rowsData.forEach(r => {
      const tanggal = r.timestamp ? fmtDate(r.timestamp) : '';
      const noan = r.no_antrian || '';
      const nama = (r.nama_pasien || r.nama || '').replace(/"/g, '""');
      const nik = r.nik || '';
      const kep = r.kepesertaan || '';
      const poli = r.poli_tujuan || '';
      const jk = r.jenis_kelamin || '';
      const kel = (r.keluhan || r.keluhan_pasien || '').replace(/"/g, '""');
      const status = r.status === 0 ? 'Menunggu' : (r.status === 1 ? 'Diproses' : (r.status === 2 ? 'Selesai' : String(r.status))); // Ubah it.status ke r.status
      lines.push([tanggal, noan, `"${nama}"`, nik, kep, poli, jk, `"${kel}"`, status].join(','));
    });

    const csv = lines.join('\r\n');
    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    });
    const filename = `laporan_antrian_${new Date().toISOString().slice(0,10)}.csv`;
    if (navigator.msSaveBlob) navigator.msSaveBlob(blob, filename);
    else {
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // --- PUBLIC API ---
  return {
    renderLaporanView,
    loadAndRender,
    getAllData: () => allData
  };
}