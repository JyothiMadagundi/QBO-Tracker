// QBO Script Tracker - Application Logic with Firebase

// =====================================================
// FIREBASE CONFIGURATION - UPDATE THESE VALUES!
// =====================================================
// Go to https://console.firebase.google.com
// 1. Create a new project (or use existing)
// 2. Add a web app
// 3. Copy your config values below
// 4. Enable Firestore Database and Storage in Firebase console

const firebaseConfig = {
    apiKey: "AIzaSyBaD4IcnIeOuggs7IXu84-YggJE6O0vFi0",
    authDomain: "qbo-tracker.firebaseapp.com",
    projectId: "qbo-tracker",
    storageBucket: "qbo-tracker.firebasestorage.app",
    messagingSenderId: "204401157729",
    appId: "1:204401157729:web:4299465d249c035b82ac20"
};

// Check if Firebase is configured
const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

// Firebase Storage requires Blaze plan - set to false to use local IndexedDB for files
const useFirebaseStorage = false;

// Initialize Firebase (only if configured)
let db = null;
let storage = null;

if (isFirebaseConfigured) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    if (useFirebaseStorage) {
        storage = firebase.storage();
    }
}

// =====================================================
// DATA MANAGEMENT
// =====================================================

// Get all entries from Firebase or localStorage
async function getEntries() {
    if (isFirebaseConfigured) {
        try {
            const snapshot = await db.collection('entries').orderBy('createdAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting entries:', error);
            showToast('Error loading data from cloud', 'error');
            return [];
        }
    } else {
        // Fallback to localStorage
        const data = localStorage.getItem('qbo_tracker_entries');
        return data ? JSON.parse(data) : [];
    }
}

// Save entry to Firebase or localStorage
async function saveEntry(entryData) {
    if (isFirebaseConfigured) {
        try {
            if (entryData.id) {
                // Update existing
                await db.collection('entries').doc(entryData.id).update(entryData);
            } else {
                // Add new
                const docRef = await db.collection('entries').add(entryData);
                entryData.id = docRef.id;
            }
            return entryData;
        } catch (error) {
            console.error('Error saving entry:', error);
            showToast('Error saving to cloud', 'error');
            return null;
        }
    } else {
        // Fallback to localStorage
        const entries = JSON.parse(localStorage.getItem('qbo_tracker_entries') || '[]');
        if (entryData.id) {
            const index = entries.findIndex(e => e.id === entryData.id);
            if (index !== -1) entries[index] = entryData;
        } else {
            entryData.id = generateId();
            entries.unshift(entryData);
        }
        localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
        return entryData;
    }
}

// Delete entry from Firebase or localStorage
async function deleteEntryFromDB(entryId) {
    if (isFirebaseConfigured) {
        try {
            await db.collection('entries').doc(entryId).delete();
            // Also delete associated files
            await deleteFilesForEntry(entryId);
        } catch (error) {
            console.error('Error deleting entry:', error);
            showToast('Error deleting from cloud', 'error');
        }
    } else {
        let entries = JSON.parse(localStorage.getItem('qbo_tracker_entries') || '[]');
        entries = entries.filter(e => e.id !== entryId);
        localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// =====================================================
// FILE STORAGE (Firebase Storage or IndexedDB)
// =====================================================

let localDB = null;

// Initialize local IndexedDB for fallback
function initLocalDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('qbo_tracker_files', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            localDB = request.result;
            resolve(localDB);
        };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('files')) {
                const store = database.createObjectStore('files', { keyPath: 'id' });
                store.createIndex('entryId', 'entryId', { unique: false });
            }
        };
    });
}

// Save file to Firebase Storage or IndexedDB
async function saveFile(entryId, file) {
    const fileId = generateId();
    const fileData = {
        id: fileId,
        entryId: entryId,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString()
    };

    if (useFirebaseStorage && isFirebaseConfigured) {
        try {
            // Upload to Firebase Storage
            const storageRef = storage.ref(`files/${entryId}/${fileId}_${file.name}`);
            await storageRef.put(file);
            fileData.storagePath = storageRef.fullPath;
            fileData.downloadURL = await storageRef.getDownloadURL();
            
            // Save metadata to Firestore
            await db.collection('files').doc(fileId).set(fileData);
            return fileData;
        } catch (error) {
            console.error('Error uploading file:', error);
            showToast('Error uploading file to cloud', 'error');
            return null;
        }
    } else {
        // Fallback to IndexedDB
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                fileData.data = reader.result;
                const transaction = localDB.transaction(['files'], 'readwrite');
                const store = transaction.objectStore('files');
                const request = store.add(fileData);
                request.onsuccess = () => resolve(fileData);
                request.onerror = () => reject(request.error);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }
}

// Get files for an entry (always uses local IndexedDB since Firebase Storage requires Blaze plan)
async function getFilesForEntry(entryId) {
    if (useFirebaseStorage && isFirebaseConfigured) {
        try {
            const snapshot = await db.collection('files').where('entryId', '==', entryId).get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting files:', error);
            return [];
        }
    } else {
        return new Promise((resolve, reject) => {
            const transaction = localDB.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const index = store.index('entryId');
            const request = index.getAll(entryId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
}

// Delete a file (always uses local IndexedDB since Firebase Storage requires Blaze plan)
async function deleteFile(fileId, storagePath) {
    if (useFirebaseStorage && isFirebaseConfigured) {
        try {
            // Delete from Storage
            if (storagePath) {
                await storage.ref(storagePath).delete();
            }
            // Delete metadata from Firestore
            await db.collection('files').doc(fileId).delete();
        } catch (error) {
            console.error('Error deleting file:', error);
        }
    } else {
        return new Promise((resolve, reject) => {
            const transaction = localDB.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            const request = store.delete(fileId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// Delete all files for an entry
async function deleteFilesForEntry(entryId) {
    const files = await getFilesForEntry(entryId);
    for (const file of files) {
        await deleteFile(file.id, file.storagePath);
    }
}

// Get file count for an entry
async function getFileCount(entryId) {
    const files = await getFilesForEntry(entryId);
    return files.length;
}

// Download a file (always uses local IndexedDB since Firebase Storage requires Blaze plan)
async function downloadFileById(fileId) {
    if (useFirebaseStorage && isFirebaseConfigured) {
        try {
            const doc = await db.collection('files').doc(fileId).get();
            if (doc.exists) {
                const file = doc.data();
                window.open(file.downloadURL, '_blank');
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            showToast('Error downloading file', 'error');
        }
    } else {
        const transaction = localDB.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(fileId);
        request.onsuccess = () => {
            const file = request.result;
            if (file) {
                const link = document.createElement('a');
                link.href = file.data;
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        };
    }
}

// =====================================================
// DOM ELEMENTS
// =====================================================

const elements = {
    // Navigation
    navItems: document.querySelectorAll('.nav-item'),
    viewAllLinks: document.querySelectorAll('.view-all'),
    
    // Views
    dashboardView: document.getElementById('dashboardView'),
    entriesView: document.getElementById('entriesView'),
    banksView: document.getElementById('banksView'),
    pageTitle: document.getElementById('pageTitle'),
    
    // Stats
    statPending: document.getElementById('statPending'),
    statInProgress: document.getElementById('statInProgress'),
    statCompleted: document.getElementById('statCompleted'),
    statError: document.getElementById('statError'),
    countHar: document.getElementById('countHar'),
    countAttempt: document.getElementById('countAttempt'),
    countIssue: document.getElementById('countIssue'),
    
    // Lists
    recentEntriesList: document.getElementById('recentEntriesList'),
    entriesTableBody: document.getElementById('entriesTableBody'),
    banksGrid: document.getElementById('banksGrid'),
    
    // Empty states
    emptyState: document.getElementById('emptyState'),
    emptyBanksState: document.getElementById('emptyBanksState'),
    
    // Filters
    searchInput: document.getElementById('searchInput'),
    filterCallType: document.getElementById('filterCallType'),
    filterStatus: document.getElementById('filterStatus'),
    dateFrom: document.getElementById('dateFrom'),
    dateTo: document.getElementById('dateTo'),
    applyDateFilter: document.getElementById('applyDateFilter'),
    clearDateFilter: document.getElementById('clearDateFilter'),
    
    // Modal
    entryModal: document.getElementById('entryModal'),
    modalTitle: document.getElementById('modalTitle'),
    entryForm: document.getElementById('entryForm'),
    addEntryBtn: document.getElementById('addEntryBtn'),
    closeModal: document.getElementById('closeModal'),
    cancelBtn: document.getElementById('cancelBtn'),
    
    // Form fields
    entryId: document.getElementById('entryId'),
    provider: document.getElementById('provider'),
    bankName: document.getElementById('bankName'),
    customerId: document.getElementById('customerId'),
    customerName: document.getElementById('customerName'),
    callType: document.getElementById('callType'),
    requestedBy: document.getElementById('requestedBy'),
    filesReceived: document.getElementById('filesReceived'),
    attendedBy: document.getElementById('attendedBy'),
    callBookedDate: document.getElementById('callBookedDate'),
    status: document.getElementById('status'),
    connectionStatus: document.getElementById('connectionStatus'),
    errorCode: document.getElementById('errorCode'),
    notes: document.getElementById('notes'),
    
    // Delete modal
    deleteModal: document.getElementById('deleteModal'),
    closeDeleteModal: document.getElementById('closeDeleteModal'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    
    // Import/Export
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    
    // File Upload
    fileUploadArea: document.getElementById('fileUploadArea'),
    fileUploadPrompt: document.getElementById('fileUploadPrompt'),
    fileInput: document.getElementById('fileInput'),
    attachedFilesList: document.getElementById('attachedFilesList'),
    
    // Attachments Modal
    attachmentsModal: document.getElementById('attachmentsModal'),
    closeAttachmentsModal: document.getElementById('closeAttachmentsModal'),
    attachmentEntryInfo: document.getElementById('attachmentEntryInfo'),
    attachmentsModalList: document.getElementById('attachmentsModalList'),
    emptyAttachments: document.getElementById('emptyAttachments'),
    addMoreFiles: document.getElementById('addMoreFiles'),
    addFilesInput: document.getElementById('addFilesInput'),
    
    // Toast
    toast: document.getElementById('toast')
};

let deleteTargetId = null;
let currentEntryFiles = [];
let currentAttachmentsEntryId = null;
let allEntries = []; // Cache for filtered views

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Show status banner
    showConfigWarning();
    
    await initLocalDB();
    initNavigation();
    initModal();
    initFilters();
    initImportExport();
    initFileUpload();
    initAttachmentsModal();
    
    await refreshData();
});

function showConfigWarning() {
    // Don't show any banner if Firebase is configured
    if (isFirebaseConfigured) {
        return;
    }
    
    // Only show warning if Firebase is NOT configured (for development/setup)
    const warning = document.createElement('div');
    warning.className = 'config-warning';
    warning.innerHTML = `
        <div class="warning-content">
            <strong>⚠️ Firebase Not Configured</strong>
            <p>Data is being saved locally only. To enable cloud sync for all team members:</p>
            <ol>
                <li>Go to <a href="https://console.firebase.google.com" target="_blank">Firebase Console</a></li>
                <li>Create a project and add a web app</li>
                <li>Update the config in <code>app.js</code></li>
                <li>Enable Firestore Database and Storage</li>
            </ol>
            <button onclick="this.parentElement.parentElement.remove()">Dismiss</button>
        </div>
    `;
    document.body.appendChild(warning);
}

async function refreshData() {
    allEntries = await getEntries();
    updateDashboard();
    await renderEntries();
    renderBanks();
}

// =====================================================
// NAVIGATION
// =====================================================

function initNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            switchView(view);
        });
    });
    
    elements.viewAllLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            switchView(view);
        });
    });
}

async function switchView(viewName) {
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });
    
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    const titles = {
        dashboard: 'Dashboard',
        entries: 'All Entries',
        banks: 'Banks Overview'
    };
    
    elements.pageTitle.textContent = titles[viewName] || 'Dashboard';
    
    const targetView = document.getElementById(viewName + 'View');
    if (targetView) {
        targetView.classList.add('active');
    }
    
    if (viewName === 'entries') {
        await renderEntries();
    } else if (viewName === 'banks') {
        renderBanks();
    } else {
        updateDashboard();
    }
}

// =====================================================
// MODAL MANAGEMENT
// =====================================================

function initModal() {
    elements.addEntryBtn.addEventListener('click', () => openModal());
    elements.closeModal.addEventListener('click', closeEntryModal);
    elements.cancelBtn.addEventListener('click', closeEntryModal);
    elements.entryForm.addEventListener('submit', handleFormSubmit);
    
    elements.closeDeleteModal.addEventListener('click', closeDeleteModal);
    elements.cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    elements.confirmDeleteBtn.addEventListener('click', confirmDelete);
    
    elements.entryModal.addEventListener('click', (e) => {
        if (e.target === elements.entryModal) closeEntryModal();
    });
    
    elements.deleteModal.addEventListener('click', (e) => {
        if (e.target === elements.deleteModal) closeDeleteModal();
    });
}

async function openModal(entry = null) {
    elements.entryModal.classList.add('active');
    currentEntryFiles = [];
    
    if (entry) {
        elements.modalTitle.textContent = 'Edit Entry';
        elements.entryId.value = entry.id;
        elements.provider.value = entry.provider || '';
        elements.bankName.value = entry.bankName || '';
        elements.customerId.value = entry.customerId || '';
        elements.customerName.value = entry.customerName || '';
        elements.callType.value = entry.callType || '';
        elements.requestedBy.value = entry.requestedBy || '';
        elements.attendedBy.value = entry.attendedBy || '';
        elements.callBookedDate.value = entry.callBookedDate || '';
        elements.filesReceived.value = entry.filesReceived || 'no';
        elements.status.value = entry.status || 'pending';
        elements.connectionStatus.value = entry.connectionStatus || 'not_tested';
        elements.errorCode.value = entry.errorCode || '';
        elements.notes.value = entry.notes || '';
        
        const existingFiles = await getFilesForEntry(entry.id);
        renderExistingFiles(existingFiles);
    } else {
        elements.modalTitle.textContent = 'Add New Entry';
        elements.entryForm.reset();
        elements.entryId.value = '';
        elements.attachedFilesList.innerHTML = '';
    }
    
    elements.provider.focus();
}

function renderExistingFiles(files) {
    if (files.length === 0) {
        elements.attachedFilesList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No files attached. Add new files above.</p>';
        return;
    }
    
    elements.attachedFilesList.innerHTML = `
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 8px;">Existing files (${files.length}):</p>
        ${files.map(f => `
            <div class="attached-file">
                <div class="attached-file-info">
                    <div class="attached-file-icon ${getFileIconClass(f.name)}">
                        ${getFileIcon(f.name)}
                    </div>
                    <div class="attached-file-details">
                        <span class="attached-file-name">${escapeHtml(f.name)}</span>
                        <span class="attached-file-size">${formatFileSize(f.size)}</span>
                    </div>
                </div>
            </div>
        `).join('')}
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 12px;">Add more files above ↑</p>
    `;
}

function closeEntryModal() {
    elements.entryModal.classList.remove('active');
    elements.entryForm.reset();
    currentEntryFiles = [];
    elements.attachedFilesList.innerHTML = '';
}

// Check if Customer ID already exists
async function checkDuplicateCustomerId(customerId, excludeEntryId = null) {
    const entries = await getEntries();
    return entries.find(entry => 
        entry.customerId.toLowerCase() === customerId.toLowerCase() && 
        entry.id !== excludeEntryId
    );
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const entryData = {
        provider: elements.provider.value.trim(),
        bankName: elements.bankName.value.trim(),
        customerId: elements.customerId.value.trim(),
        customerName: elements.customerName.value.trim(),
        callType: elements.callType.value,
        requestedBy: elements.requestedBy.value.trim(),
        attendedBy: elements.attendedBy.value.trim(),
        callBookedDate: elements.callBookedDate.value,
        filesReceived: elements.filesReceived.value,
        status: elements.status.value,
        connectionStatus: elements.connectionStatus.value,
        errorCode: elements.errorCode.value.trim(),
        notes: elements.notes.value.trim(),
        updatedAt: new Date().toISOString()
    };
    
    const isEditing = !!elements.entryId.value;
    const editingEntryId = isEditing ? elements.entryId.value : null;
    
    // Check for duplicate Customer ID
    const existingEntry = await checkDuplicateCustomerId(entryData.customerId, editingEntryId);
    if (existingEntry) {
        showToast(`Customer ID "${entryData.customerId}" already exists for bank "${existingEntry.bankName}"!`, 'error');
        elements.customerId.focus();
        elements.customerId.classList.add('input-error');
        setTimeout(() => elements.customerId.classList.remove('input-error'), 3000);
        return;
    }
    
    if (isEditing) {
        entryData.id = elements.entryId.value;
    } else {
        entryData.createdAt = new Date().toISOString();
    }
    
    const savedEntry = await saveEntry(entryData);
    
    if (savedEntry) {
        // Save any new files
        if (currentEntryFiles.length > 0) {
            for (const f of currentEntryFiles) {
                try {
                    await saveFile(savedEntry.id, f.file);
                } catch (error) {
                    console.error('Error saving file:', error);
                }
            }
            currentEntryFiles = [];
        }
        
        showToast(isEditing ? 'Entry updated successfully' : 'Entry added successfully', 'success');
    }
    
    closeEntryModal();
    await refreshData();
}

function openDeleteModal(id) {
    deleteTargetId = id;
    elements.deleteModal.classList.add('active');
}

function closeDeleteModal() {
    elements.deleteModal.classList.remove('active');
    deleteTargetId = null;
}

async function confirmDelete() {
    if (!deleteTargetId) return;
    
    await deleteEntryFromDB(deleteTargetId);
    
    closeDeleteModal();
    showToast('Entry and attachments deleted', 'success');
    await refreshData();
}

// =====================================================
// FILTERS
// =====================================================

function initFilters() {
    elements.searchInput.addEventListener('input', () => renderEntries());
    elements.filterCallType.addEventListener('change', () => renderEntries());
    elements.filterStatus.addEventListener('change', () => renderEntries());
    
    elements.applyDateFilter.addEventListener('click', () => renderEntries());
    elements.clearDateFilter.addEventListener('click', () => {
        elements.dateFrom.value = '';
        elements.dateTo.value = '';
        renderEntries();
    });
}

function getFilteredEntries() {
    let entries = [...allEntries];
    const search = elements.searchInput.value.toLowerCase();
    const callType = elements.filterCallType.value;
    const status = elements.filterStatus.value;
    const dateFrom = elements.dateFrom.value;
    const dateTo = elements.dateTo.value;
    
    if (search) {
        entries = entries.filter(e => 
            (e.bankName || '').toLowerCase().includes(search) ||
            (e.customerId || '').toLowerCase().includes(search) ||
            (e.customerName || '').toLowerCase().includes(search) ||
            (e.provider || '').toLowerCase().includes(search) ||
            (e.requestedBy || '').toLowerCase().includes(search) ||
            (e.attendedBy || '').toLowerCase().includes(search) ||
            (e.notes || '').toLowerCase().includes(search)
        );
    }
    
    if (callType) {
        entries = entries.filter(e => e.callType === callType);
    }
    
    if (status) {
        entries = entries.filter(e => e.status === status);
    }
    
    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        entries = entries.filter(e => {
            const entryDate = new Date(e.createdAt);
            return entryDate >= fromDate;
        });
    }
    
    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        entries = entries.filter(e => {
            const entryDate = new Date(e.createdAt);
            return entryDate <= toDate;
        });
    }
    
    return entries;
}

// =====================================================
// DASHBOARD
// =====================================================

function updateDashboard() {
    const entries = allEntries;
    
    const statusCounts = { pending: 0, in_progress: 0, completed: 0, error: 0 };
    const callTypeCounts = { har_collection: 0, verification_attempt: 0, issue_check: 0 };
    
    entries.forEach(entry => {
        if (statusCounts.hasOwnProperty(entry.status)) {
            statusCounts[entry.status]++;
        }
        if (callTypeCounts.hasOwnProperty(entry.callType)) {
            callTypeCounts[entry.callType]++;
        }
    });
    
    elements.statPending.textContent = statusCounts.pending;
    elements.statInProgress.textContent = statusCounts.in_progress;
    elements.statCompleted.textContent = statusCounts.completed;
    elements.statError.textContent = statusCounts.error;
    
    elements.countHar.textContent = callTypeCounts.har_collection;
    elements.countAttempt.textContent = callTypeCounts.verification_attempt;
    elements.countIssue.textContent = callTypeCounts.issue_check;
    
    renderRecentEntries(entries.slice(0, 5));
}

function renderRecentEntries(entries) {
    if (entries.length === 0) {
        elements.recentEntriesList.innerHTML = `
            <div class="empty-state visible" style="padding: 30px;">
                <p style="color: var(--text-muted);">No entries yet</p>
            </div>
        `;
        return;
    }
    
    elements.recentEntriesList.innerHTML = entries.map(entry => `
        <div class="recent-entry">
            <div class="recent-entry-info">
                <span class="recent-entry-bank">${escapeHtml(entry.provider ? entry.provider + ' - ' : '')}${escapeHtml(entry.bankName)}</span>
                <div class="recent-entry-meta">
                    <span>${formatCallType(entry.callType)}</span>
                    <span>•</span>
                    <span>${entry.requestedBy ? 'By ' + escapeHtml(entry.requestedBy) : ''}</span>
                    <span>•</span>
                    <span>${formatDate(entry.createdAt)}</span>
                </div>
            </div>
            <span class="status-badge ${entry.status}">${formatStatus(entry.status)}</span>
        </div>
    `).join('');
}

// =====================================================
// ENTRIES TABLE
// =====================================================

async function renderEntries() {
    const entries = getFilteredEntries();
    
    if (entries.length === 0) {
        elements.entriesTableBody.innerHTML = '';
        elements.emptyState.classList.add('visible');
        return;
    }
    
    elements.emptyState.classList.remove('visible');
    
    // Get file counts
    const fileCounts = {};
    for (const entry of entries) {
        fileCounts[entry.id] = await getFileCount(entry.id);
    }
    
    elements.entriesTableBody.innerHTML = entries.map(entry => {
        const fileCount = fileCounts[entry.id] || 0;
        return `
        <tr>
            <td>${formatDate(entry.createdAt)}</td>
            <td class="call-booked-date">${entry.callBookedDate ? formatDateInput(entry.callBookedDate) : '-'}</td>
            <td><span class="provider-badge">${escapeHtml(entry.provider || 'N/A')}</span></td>
            <td><strong>${escapeHtml(entry.bankName)}</strong></td>
            <td><code style="font-family: var(--font-mono); font-size: 0.85em;">${escapeHtml(entry.customerId)}</code></td>
            <td>${escapeHtml(entry.customerName || '-')}</td>
            <td><span class="call-type-badge ${entry.callType}">${formatCallType(entry.callType)}</span></td>
            <td>${escapeHtml(entry.requestedBy || '-')}</td>
            <td>${escapeHtml(entry.attendedBy || '-')}</td>
            <td><span class="status-badge ${entry.status}">${formatStatus(entry.status)}</span></td>
            <td><span class="files-received-badge ${entry.filesReceived === 'yes' ? 'yes' : 'no'}">${entry.filesReceived === 'yes' ? 'Yes' : 'No'}</span></td>
            <td class="notes-cell" title="${escapeHtml(entry.notes || '')}">
                ${entry.notes 
                    ? `<span class="notes-preview">${escapeHtml(entry.notes.length > 50 ? entry.notes.substring(0, 50) + '...' : entry.notes)}</span>`
                    : `<span class="no-notes">-</span>`
                }
            </td>
            <td>
                <div class="action-btns">
                    <button class="action-btn edit" title="Edit" onclick="editEntry('${entry.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn delete" title="Delete" onclick="deleteEntry('${entry.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');
}

// Global functions
window.editEntry = async function(id) {
    const entry = allEntries.find(e => e.id === id);
    if (entry) {
        await openModal(entry);
    }
};

window.deleteEntry = function(id) {
    openDeleteModal(id);
};

// =====================================================
// BANKS VIEW
// =====================================================

function renderBanks() {
    const entries = allEntries;
    const bankMap = new Map();
    
    entries.forEach(entry => {
        const key = `${entry.provider || 'Unknown'}_${entry.bankName}`;
        if (!bankMap.has(key)) {
            bankMap.set(key, {
                provider: entry.provider || 'Unknown',
                name: entry.bankName,
                total: 0,
                completed: 0,
                pending: 0,
                inProgress: 0,
                hasSuccessfulConnection: false,
                teamMembers: new Set()
            });
        }
        
        const bank = bankMap.get(key);
        bank.total++;
        
        if (entry.status === 'completed') bank.completed++;
        if (entry.status === 'pending') bank.pending++;
        if (entry.status === 'in_progress') bank.inProgress++;
        if (entry.connectionStatus === 'success') bank.hasSuccessfulConnection = true;
        if (entry.requestedBy) bank.teamMembers.add(entry.requestedBy);
        if (entry.attendedBy) bank.teamMembers.add(entry.attendedBy);
    });
    
    if (bankMap.size === 0) {
        elements.banksGrid.innerHTML = '';
        elements.emptyBanksState.classList.add('visible');
        return;
    }
    
    elements.emptyBanksState.classList.remove('visible');
    
    const banks = Array.from(bankMap.values()).sort((a, b) => b.total - a.total);
    
    elements.banksGrid.innerHTML = banks.map(bank => `
        <div class="bank-card">
            <div class="bank-card-header">
                <div>
                    <span class="provider-badge" style="margin-bottom: 8px; display: inline-block;">${escapeHtml(bank.provider)}</span>
                    <h3>${escapeHtml(bank.name)}</h3>
                </div>
                ${bank.hasSuccessfulConnection 
                    ? '<span class="bank-connection-indicator connected">✓ Connected</span>'
                    : bank.completed > 0 
                        ? '<span class="bank-connection-indicator pending">Pending</span>'
                        : '<span class="bank-connection-indicator failed">Not Connected</span>'
                }
            </div>
            <div class="bank-card-stats">
                <div class="bank-stat">
                    <span class="bank-stat-value">${bank.total}</span>
                    <span class="bank-stat-label">Total Entries</span>
                </div>
                <div class="bank-stat">
                    <span class="bank-stat-value">${bank.completed}</span>
                    <span class="bank-stat-label">Completed</span>
                </div>
                <div class="bank-stat">
                    <span class="bank-stat-value">${bank.inProgress}</span>
                    <span class="bank-stat-label">In Progress</span>
                </div>
                <div class="bank-stat">
                    <span class="bank-stat-value">${bank.pending}</span>
                    <span class="bank-stat-label">Pending</span>
                </div>
            </div>
            ${bank.teamMembers.size > 0 ? `
                <div class="bank-team-members">
                    <span class="team-label">Team: </span>
                    <span class="team-names">${Array.from(bank.teamMembers).map(m => escapeHtml(m)).join(', ')}</span>
                </div>
            ` : ''}
        </div>
    `).join('');
}

// =====================================================
// FILE UPLOAD
// =====================================================

function initFileUpload() {
    elements.fileUploadPrompt.addEventListener('click', () => {
        elements.fileInput.click();
    });
    
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    elements.fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.fileUploadArea.classList.add('drag-over');
    });
    
    elements.fileUploadArea.addEventListener('dragleave', () => {
        elements.fileUploadArea.classList.remove('drag-over');
    });
    
    elements.fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.fileUploadArea.classList.remove('drag-over');
        processFiles(e.dataTransfer.files);
    });
}

function handleFileSelect(e) {
    processFiles(e.target.files);
    e.target.value = '';
}

function processFiles(files) {
    const maxSize = 100 * 1024 * 1024; // 100MB limit
    const allowedTypes = ['har', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'json', 'zip', 'doc', 'docx', 'xls', 'xlsx'];
    
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (file.size > maxSize) {
            showToast(`File "${file.name}" exceeds 100MB limit`, 'error');
            continue;
        }
        
        if (!allowedTypes.includes(ext)) {
            showToast(`File type ".${ext}" not allowed`, 'error');
            continue;
        }
        
        currentEntryFiles.push({
            tempId: generateId(),
            file: file,
            name: file.name,
            size: file.size,
            type: file.type
        });
    }
    
    renderAttachedFiles();
}

function renderAttachedFiles() {
    if (currentEntryFiles.length === 0) {
        elements.attachedFilesList.innerHTML = '';
        return;
    }
    
    elements.attachedFilesList.innerHTML = currentEntryFiles.map(f => `
        <div class="attached-file">
            <div class="attached-file-info">
                <div class="attached-file-icon ${getFileIconClass(f.name)}">
                    ${getFileIcon(f.name)}
                </div>
                <div class="attached-file-details">
                    <span class="attached-file-name">${escapeHtml(f.name)}</span>
                    <span class="attached-file-size">${formatFileSize(f.size)}</span>
                </div>
            </div>
            <div class="attached-file-actions">
                <button class="file-action-btn delete" title="Remove" onclick="removeAttachedFile('${f.tempId}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

window.removeAttachedFile = function(tempId) {
    currentEntryFiles = currentEntryFiles.filter(f => f.tempId !== tempId);
    renderAttachedFiles();
};

// =====================================================
// ATTACHMENTS MODAL
// =====================================================

function initAttachmentsModal() {
    elements.closeAttachmentsModal.addEventListener('click', closeAttachmentsModal);
    elements.attachmentsModal.addEventListener('click', (e) => {
        if (e.target === elements.attachmentsModal) closeAttachmentsModal();
    });
    
    elements.addMoreFiles.addEventListener('click', () => {
        elements.addFilesInput.click();
    });
    
    elements.addFilesInput.addEventListener('change', async (e) => {
        await addFilesToEntry(currentAttachmentsEntryId, e.target.files);
        e.target.value = '';
        await renderAttachmentsModalFiles(currentAttachmentsEntryId);
        await refreshData();
    });
}

async function openAttachmentsModal(entryId) {
    currentAttachmentsEntryId = entryId;
    const entry = allEntries.find(e => e.id === entryId);
    
    if (!entry) return;
    
    elements.attachmentEntryInfo.innerHTML = `
        <span class="bank-name">${escapeHtml(entry.provider ? entry.provider + ' - ' : '')}${escapeHtml(entry.bankName)}</span>
        <span class="case-id">${escapeHtml(entry.customerId)}</span>
    `;
    
    await renderAttachmentsModalFiles(entryId);
    elements.attachmentsModal.classList.add('active');
}

window.openAttachmentsModal = openAttachmentsModal;

async function renderAttachmentsModalFiles(entryId) {
    const files = await getFilesForEntry(entryId);
    
    if (files.length === 0) {
        elements.attachmentsModalList.innerHTML = '';
        elements.emptyAttachments.classList.add('visible');
        return;
    }
    
    elements.emptyAttachments.classList.remove('visible');
    
    elements.attachmentsModalList.innerHTML = files.map(f => `
        <div class="attached-file">
            <div class="attached-file-info">
                <div class="attached-file-icon ${getFileIconClass(f.name)}">
                    ${getFileIcon(f.name)}
                </div>
                <div class="attached-file-details">
                    <span class="attached-file-name">${escapeHtml(f.name)}</span>
                    <span class="attached-file-size">${formatFileSize(f.size)} • ${formatDate(f.uploadedAt)}</span>
                </div>
            </div>
            <div class="attached-file-actions">
                <button class="file-action-btn preview" title="Preview/Open" onclick="previewFile('${f.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
                <button class="file-action-btn download" title="Download" onclick="downloadFile('${f.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
                <button class="file-action-btn delete" title="Delete" onclick="deleteAttachment('${f.id}', '${f.storagePath || ''}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

function closeAttachmentsModal() {
    elements.attachmentsModal.classList.remove('active');
    currentAttachmentsEntryId = null;
}

async function addFilesToEntry(entryId, files) {
    const maxSize = 100 * 1024 * 1024; // 100MB limit
    const allowedTypes = ['har', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'json', 'zip', 'doc', 'docx', 'xls', 'xlsx'];
    
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (file.size > maxSize) {
            showToast(`File "${file.name}" exceeds 100MB limit`, 'error');
            continue;
        }
        
        if (!allowedTypes.includes(ext)) {
            showToast(`File type ".${ext}" not allowed`, 'error');
            continue;
        }
        
        try {
            await saveFile(entryId, file);
        } catch (error) {
            showToast(`Error saving "${file.name}"`, 'error');
        }
    }
    
    showToast('Files uploaded successfully', 'success');
}

window.downloadFile = async function(fileId) {
    await downloadFileById(fileId);
};

window.previewFile = async function(fileId) {
    // Get file from IndexedDB
    const transaction = localDB.transaction(['files'], 'readonly');
    const store = transaction.objectStore('files');
    const request = store.get(fileId);
    
    request.onsuccess = () => {
        const file = request.result;
        if (!file) {
            showToast('File not found', 'error');
            return;
        }
        
        const ext = file.name.split('.').pop().toLowerCase();
        
        // For images - show in preview modal
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
            openImagePreview(file.data, file.name);
        }
        // For HTML files - open in new tab
        else if (['html', 'htm'].includes(ext)) {
            const newTab = window.open();
            newTab.document.write(atob(file.data.split(',')[1]));
            newTab.document.title = file.name;
        }
        // For HAR files - open in JSON viewer
        else if (ext === 'har') {
            try {
                const harContent = atob(file.data.split(',')[1]);
                const harJson = JSON.parse(harContent);
                openJsonPreview(harJson, file.name);
            } catch (e) {
                // If parsing fails, open as text
                openTextPreview(atob(file.data.split(',')[1]), file.name);
            }
        }
        // For JSON files
        else if (ext === 'json') {
            try {
                const jsonContent = atob(file.data.split(',')[1]);
                const jsonData = JSON.parse(jsonContent);
                openJsonPreview(jsonData, file.name);
            } catch (e) {
                openTextPreview(atob(file.data.split(',')[1]), file.name);
            }
        }
        // For text files
        else if (ext === 'txt') {
            openTextPreview(atob(file.data.split(',')[1]), file.name);
        }
        // For PDF - open in new tab
        else if (ext === 'pdf') {
            const newTab = window.open();
            newTab.document.write(`<iframe src="${file.data}" style="width:100%;height:100%;border:none;"></iframe>`);
            newTab.document.title = file.name;
        }
        // For other files - download
        else {
            downloadFileById(fileId);
        }
    };
};

// Image Preview Modal
function openImagePreview(dataUrl, fileName) {
    const modal = document.createElement('div');
    modal.className = 'preview-modal active';
    modal.innerHTML = `
        <div class="preview-modal-content image-preview">
            <div class="preview-modal-header">
                <h3>${escapeHtml(fileName)}</h3>
                <button class="preview-close-btn" onclick="this.closest('.preview-modal').remove()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="preview-modal-body">
                <img src="${dataUrl}" alt="${escapeHtml(fileName)}" style="max-width: 100%; max-height: 80vh; object-fit: contain;">
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
}

// JSON/HAR Preview Modal
function openJsonPreview(jsonData, fileName) {
    const modal = document.createElement('div');
    modal.className = 'preview-modal active';
    modal.innerHTML = `
        <div class="preview-modal-content json-preview">
            <div class="preview-modal-header">
                <h3>${escapeHtml(fileName)}</h3>
                <button class="preview-close-btn" onclick="this.closest('.preview-modal').remove()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="preview-modal-body">
                <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 70vh; overflow: auto; background: var(--bg-tertiary); padding: 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(JSON.stringify(jsonData, null, 2))}</pre>
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
}

// Text Preview Modal
function openTextPreview(text, fileName) {
    const modal = document.createElement('div');
    modal.className = 'preview-modal active';
    modal.innerHTML = `
        <div class="preview-modal-content text-preview">
            <div class="preview-modal-header">
                <h3>${escapeHtml(fileName)}</h3>
                <button class="preview-close-btn" onclick="this.closest('.preview-modal').remove()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="preview-modal-body">
                <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 70vh; overflow: auto; background: var(--bg-tertiary); padding: 16px; border-radius: 8px; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(text)}</pre>
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
}

window.deleteAttachment = async function(fileId, storagePath) {
    if (confirm('Delete this attachment?')) {
        await deleteFile(fileId, storagePath);
        await renderAttachmentsModalFiles(currentAttachmentsEntryId);
        await refreshData();
        showToast('Attachment deleted', 'success');
    }
};

// =====================================================
// IMPORT/EXPORT
// =====================================================

function initImportExport() {
    elements.exportBtn.addEventListener('click', exportData);
    elements.importBtn.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', importData);
}

async function exportData() {
    const entries = allEntries;
    
    if (entries.length === 0) {
        showToast('No entries to export', 'error');
        return;
    }
    
    const excelData = entries.map(entry => ({
        'Created Date': formatDate(entry.createdAt),
        'Call Booked Date': entry.callBookedDate ? formatDateInput(entry.callBookedDate) : '',
        'Provider': entry.provider || '',
        'Bank Name': entry.bankName,
        'Customer ID': entry.customerId,
        'Customer Name': entry.customerName || '',
        'Call Type': formatCallType(entry.callType),
        'Requested By': entry.requestedBy || '',
        'Attended By': entry.attendedBy || '',
        'Status': formatStatus(entry.status),
        'Files Received': entry.filesReceived === 'yes' ? 'Yes' : 'No',
        'Connection Status': formatConnectionStatus(entry.connectionStatus).replace(/[⏳✓✗⚠]/g, '').trim(),
        'Error Code': entry.errorCode || '',
        'Notes': entry.notes || '',
        'Created At': entry.createdAt,
        'Updated At': entry.updatedAt || '',
        'Call Booked Date Raw': entry.callBookedDate || '',
        'ID': entry.id
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    ws['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 15 }, { wch: 20 },
        { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 18 }, { wch: 15 }, { wch: 30 },
        { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 20 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'QBO Tracker Data');
    
    const fileName = `qbo-tracker-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    showToast('Data exported to Excel successfully', 'success');
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            if (jsonData.length === 0) {
                throw new Error('No data found in Excel file');
            }
            
            let importedCount = 0;
            
            for (const row of jsonData) {
                const entryData = {
                    provider: row['Provider'] || row['provider'] || '',
                    bankName: row['Bank Name'] || row['bankName'] || row['Bank'] || '',
                    customerId: row['Customer ID'] || row['customerId'] || row['Customer/Case ID'] || row['Case ID'] || '',
                    customerName: row['Customer Name'] || row['customerName'] || '',
                    callType: mapCallType(row['Call Type'] || row['callType'] || ''),
                    requestedBy: row['Requested By'] || row['requestedBy'] || '',
                    attendedBy: row['Attended By'] || row['attendedBy'] || '',
                    callBookedDate: row['Call Booked Date Raw'] || row['Call Booked Date'] || '',
                    filesReceived: (row['Files Received'] || '').toLowerCase() === 'yes' ? 'yes' : 'no',
                    status: mapStatus(row['Status'] || row['status'] || 'pending'),
                    connectionStatus: mapConnectionStatus(row['Connection Status'] || ''),
                    errorCode: row['Error Code'] || row['errorCode'] || '',
                    notes: row['Notes'] || row['notes'] || '',
                    createdAt: row['Created At'] || row['createdAt'] || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                if (entryData.bankName && entryData.customerId) {
                    await saveEntry(entryData);
                    importedCount++;
                }
            }
            
            showToast(`Imported ${importedCount} entries`, 'success');
            await refreshData();
        } catch (error) {
            showToast('Error importing Excel: ' + error.message, 'error');
        }
    };
    
    reader.readAsArrayBuffer(file);
    e.target.value = '';
}

function mapCallType(value) {
    const lower = (value || '').toLowerCase();
    if (lower.includes('har') || lower.includes('html') || lower.includes('collection')) return 'har_collection';
    if (lower.includes('verification') || lower.includes('attempt')) return 'verification_attempt';
    if (lower.includes('issue') || lower.includes('check')) return 'issue_check';
    return 'har_collection';
}

function mapStatus(value) {
    const lower = (value || '').toLowerCase();
    if (lower.includes('progress')) return 'in_progress';
    if (lower.includes('complete')) return 'completed';
    if (lower.includes('error') || lower.includes('issue')) return 'error';
    return 'pending';
}

function mapConnectionStatus(value) {
    const lower = (value || '').toLowerCase();
    if (lower.includes('files collected') || lower.includes('collected')) return 'files_collected';
    if (lower.includes('success') || lower.includes('connected')) return 'success';
    if (lower.includes('failed') || lower.includes('fail')) return 'failed';
    if (lower.includes('error') || lower.includes('code')) return 'error_code';
    return 'not_tested';
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatDateInput(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatCallType(type) {
    const types = {
        har_collection: 'HAR/HTML Collection',
        verification_attempt: 'Verification Attempt',
        issue_check: 'Issue Check'
    };
    return types[type] || type;
}

function formatStatus(status) {
    const statuses = {
        pending: 'Pending',
        in_progress: 'In Progress',
        completed: 'Completed',
        error: 'Error'
    };
    return statuses[status] || status;
}

function formatConnectionStatus(status) {
    const statuses = {
        not_tested: '⏳ Not Tested',
        files_collected: '📁 Files Collected',
        success: '✓ Connected',
        failed: '✗ Failed',
        error_code: '⚠ Error Code'
    };
    return statuses[status] || status;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIconClass(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'har') return 'har';
    if (['html', 'htm'].includes(ext)) return 'html';
    if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'other';
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'har') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    if (['html', 'htm'].includes(ext)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
    if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    if (ext === 'pdf') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toast = elements.toast;
    toast.querySelector('.toast-message').textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
