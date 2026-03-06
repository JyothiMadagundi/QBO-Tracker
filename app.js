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
let firebaseAvailable = false;

if (isFirebaseConfigured) {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebaseAvailable = true;
        console.log('Firebase initialized successfully');
        if (useFirebaseStorage) {
            storage = firebase.storage();
        }
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        firebaseAvailable = false;
    }
}

// =====================================================
// DATA MANAGEMENT
// =====================================================

// =============================================================================
// DATA MANAGEMENT - Firebase is the SINGLE SOURCE OF TRUTH
// =============================================================================

// Get all entries - Firebase is the single source of truth
async function getEntries() {
    // If Firebase is available, ONLY use Firebase data
    if (firebaseAvailable) {
        try {
            const snapshot = await db.collection('entries').get();
            const firebaseEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Deduplicate by ID (just in case)
            const entries = deduplicateById(firebaseEntries);
            
            // Sort by createdAt (newest first)
            entries.sort((a, b) => {
                const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return timeB - timeA;
            });
            
            // Cache to localStorage for offline access
            localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
            
            return entries;
        } catch (error) {
            console.error('Firebase fetch error, using cached data:', error);
            // Fall back to localStorage cache only if Firebase fails
            return getLocalEntries();
        }
    }
    
    // If Firebase not available, use localStorage (offline mode)
    return getLocalEntries();
}

// Get entries from localStorage (offline fallback)
function getLocalEntries() {
    const localData = localStorage.getItem('qbo_tracker_entries');
    let entries = [];
    try {
        entries = localData ? JSON.parse(localData) : [];
    } catch (e) {
        console.error('Error parsing localStorage:', e);
        entries = [];
    }
    return deduplicateById(entries);
}

// Simple deduplication by ID only
function deduplicateById(entries) {
    const seen = new Map();
    const unique = [];
    
    for (const entry of entries) {
        if (!entry || !entry.id) continue;
        const id = String(entry.id);
        if (!seen.has(id)) {
            seen.set(id, true);
            unique.push(entry);
        }
    }
    
    return unique;
}

// Save entry - Firebase FIRST (source of truth), then cache to localStorage
async function saveEntry(entryData) {
    // Generate ID if new entry
    if (!entryData.id) {
        entryData.id = generateId();
    }
    
    // Add timestamps
    if (!entryData.createdAt) {
        entryData.createdAt = new Date().toISOString();
    }
    entryData.updatedAt = new Date().toISOString();
    
    // Save to Firebase FIRST (source of truth)
    if (firebaseAvailable) {
        try {
            await db.collection('entries').doc(String(entryData.id)).set(entryData);
            // Only update localStorage after successful Firebase save
            saveToLocalStorage(entryData);
            return entryData;
        } catch (error) {
            console.error('Firebase save failed:', error);
            showToast('Failed to save to cloud. Please try again.', 'error');
            throw error; // Don't save locally if Firebase fails - prevents desync
        }
    } else {
        // Offline mode - save locally only
        saveToLocalStorage(entryData);
        showToast('Saved offline. Will sync when online.', 'warning');
        return entryData;
    }
}

// Helper function to update localStorage cache
function saveToLocalStorage(entryData) {
    const rawData = localStorage.getItem('qbo_tracker_entries');
    let entries = [];
    try {
        entries = rawData ? JSON.parse(rawData) : [];
    } catch (e) {
        entries = [];
    }
    
    const entryIdStr = String(entryData.id);
    const index = entries.findIndex(e => String(e.id) === entryIdStr);
    
    if (index !== -1) {
        entries[index] = { ...entryData };
    } else {
        entries.unshift({ ...entryData });
    }
    
    localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
    return entryData;
}

// Delete entry - Firebase FIRST (source of truth), then update localStorage
async function deleteEntryFromDB(entryId) {
    const entryIdStr = String(entryId);
    
    // Delete from Firebase FIRST (source of truth)
    if (firebaseAvailable) {
        try {
            await db.collection('entries').doc(entryIdStr).delete();
            // Only update localStorage after successful Firebase delete
            deleteFromLocalStorage(entryIdStr);
            // Also delete associated files
            await deleteFilesForEntry(entryIdStr);
            return true;
        } catch (error) {
            console.error('Firebase delete failed:', error);
            showToast('Failed to delete from cloud. Please try again.', 'error');
            throw error; // Don't delete locally if Firebase fails - prevents desync
        }
    } else {
        // Offline mode - delete locally only
        deleteFromLocalStorage(entryIdStr);
        await deleteFilesForEntry(entryIdStr);
        showToast('Deleted offline. Will sync when online.', 'warning');
        return true;
    }
}

function deleteFromLocalStorage(entryId) {
    const entryIdStr = String(entryId);
    let entries = JSON.parse(localStorage.getItem('qbo_tracker_entries') || '[]');
    entries = entries.filter(e => String(e.id) !== entryIdStr);
    localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
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
    
    // Toast
    toast: document.getElementById('toast')
};

let deleteTargetId = null;
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
    const entries = await getEntries();
    // Extra safeguard: deduplicate before assigning to global cache
    allEntries = deduplicateById(entries);
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
    } else {
        elements.modalTitle.textContent = 'Add New Entry';
        elements.entryForm.reset();
        elements.entryId.value = '';
    }
    
    elements.provider.focus();
}

function closeEntryModal() {
    elements.entryModal.classList.remove('active');
    elements.entryForm.reset();
}

// Placeholder values that are allowed to be duplicated
const PLACEHOLDER_PROVIDERS = [
    'not yet created',
    'tbd',
    'pending',
    'n/a',
    'na',
    'none',
    'unknown',
    'to be added',
    'to be created',
    ''
];

// Check if Provider ID already exists (Provider must be unique, except for placeholders)
async function checkDuplicateProvider(provider) {
    try {
        const providerLower = (provider || '').toLowerCase().trim();
        
        // Skip check if provider is empty or a placeholder value
        if (PLACEHOLDER_PROVIDERS.includes(providerLower)) {
            return null;
        }
        
        const entries = await getEntries();
        
        for (const entry of entries) {
            const entryProviderLower = (entry.provider || '').toLowerCase().trim();
            
            // Skip entries with placeholder providers
            if (PLACEHOLDER_PROVIDERS.includes(entryProviderLower)) {
                continue;
            }
            
            // Check if provider matches
            if (entryProviderLower === providerLower) {
                return entry;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error checking duplicate:', error);
        return null; // Allow save if check fails
    }
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
    
    // Check for duplicate Provider ID (placeholders like "Not yet created" are allowed)
    const existingEntry = await checkDuplicateProvider(entryData.provider);
    
    // If duplicate found, check if it's the same entry being edited
    if (existingEntry) {
        const isSameEntry = isEditing && String(existingEntry.id) === String(editingEntryId);
        
        if (!isSameEntry) {
            showToast(`Provider ID "${entryData.provider}" already exists for bank "${existingEntry.bankName}"!`, 'error');
            elements.provider.focus();
            elements.provider.classList.add('input-error');
            setTimeout(() => {
                elements.provider.classList.remove('input-error');
            }, 3000);
            return;
        }
    }
    
    if (isEditing) {
        entryData.id = elements.entryId.value;
    }
    
    try {
        const savedEntry = await saveEntry(entryData);
        
        if (savedEntry) {
            showToast(isEditing ? 'Entry updated successfully' : 'Entry added successfully', 'success');
        }
        
        closeEntryModal();
        await refreshData();
    } catch (error) {
        console.error('Save failed:', error);
        // Error toast is shown by saveEntry
    }
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
    
    try {
        await deleteEntryFromDB(deleteTargetId);
        closeDeleteModal();
        showToast('Entry and attachments deleted', 'success');
        await refreshData();
    } catch (error) {
        console.error('Delete failed:', error);
        closeDeleteModal();
        // Error toast is shown by deleteEntryFromDB
    }
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
    // Compare as strings to handle type mismatches
    const entry = allEntries.find(e => String(e.id) === String(id));
    if (entry) {
        await openModal(entry);
    } else {
        showToast('Entry not found', 'error');
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
