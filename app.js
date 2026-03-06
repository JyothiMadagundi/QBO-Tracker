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

// Get all entries from Firebase or localStorage
async function getEntries() {
    console.log('=== GET ENTRIES ===');
    
    // Always use localStorage as the source of truth
    const localData = localStorage.getItem('qbo_tracker_entries');
    console.log('Raw localStorage length:', localData ? localData.length : 0);
    
    let localEntries = [];
    try {
        localEntries = localData ? JSON.parse(localData) : [];
    } catch (e) {
        console.error('Error parsing localStorage in getEntries:', e);
        localEntries = [];
    }
    
    console.log('Parsed entries count:', localEntries.length);
    console.log('Entry IDs:', localEntries.map(e => e.id));
    
    return localEntries;
}

// Save entry to Firebase or localStorage
async function saveEntry(entryData) {
    console.log('saveEntry called, firebaseAvailable:', firebaseAvailable, 'entryData:', entryData);
    
    // Generate ID if new entry
    if (!entryData.id) {
        entryData.id = generateId();
    }
    
    // ALWAYS save to localStorage first for reliability
    const savedToLocal = saveToLocalStorage(entryData);
    console.log('Saved to localStorage:', savedToLocal.id);
    
    // Then try Firebase if available (async, don't wait)
    if (firebaseAvailable) {
        try {
            console.log('Also saving to Firebase...');
            // Try Firebase with timeout
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Firebase save timeout')), 5000)
            );
            
            const firebasePromise = db.collection('entries').doc(entryData.id).set(entryData);
            await Promise.race([firebasePromise, timeoutPromise]);
            console.log('Entry also saved to Firebase');
        } catch (error) {
            console.warn('Firebase save failed/timed out, but localStorage save succeeded:', error.message);
        }
    }
    
    return savedToLocal;
}

// Helper function to save to localStorage
function saveToLocalStorage(entryData) {
    console.log('=== SAVE TO LOCALSTORAGE ===');
    console.log('Entry to save:', JSON.stringify(entryData, null, 2));
    
    // Get current entries
    const rawData = localStorage.getItem('qbo_tracker_entries');
    console.log('Raw localStorage data length:', rawData ? rawData.length : 0);
    
    let entries = [];
    try {
        entries = rawData ? JSON.parse(rawData) : [];
    } catch (e) {
        console.error('Error parsing localStorage:', e);
        entries = [];
    }
    
    console.log('Current entries count:', entries.length);
    console.log('Current entry IDs:', entries.map(e => e.id));
    
    // Use string comparison for IDs to handle type mismatches
    const entryIdStr = String(entryData.id);
    const index = entries.findIndex(e => String(e.id) === entryIdStr);
    
    console.log('Looking for entry with ID:', entryIdStr, 'Found at index:', index);
    
    if (index !== -1) {
        // Update existing entry - preserve createdAt if not in new data
        if (!entryData.createdAt && entries[index].createdAt) {
            entryData.createdAt = entries[index].createdAt;
        }
        console.log('UPDATING entry at index:', index);
        console.log('Old entry:', JSON.stringify(entries[index], null, 2));
        entries[index] = { ...entryData }; // Make a copy
        console.log('New entry:', JSON.stringify(entries[index], null, 2));
    } else {
        // Add new entry
        console.log('ADDING new entry');
        entries.unshift({ ...entryData }); // Make a copy
    }
    
    // Save back to localStorage
    const newData = JSON.stringify(entries);
    console.log('Saving to localStorage, new data length:', newData.length);
    localStorage.setItem('qbo_tracker_entries', newData);
    
    // Verify the save
    const verifyData = localStorage.getItem('qbo_tracker_entries');
    const verifyEntries = JSON.parse(verifyData);
    console.log('VERIFY: Total entries after save:', verifyEntries.length);
    console.log('VERIFY: Entry IDs after save:', verifyEntries.map(e => e.id));
    
    return entryData;
}

// Delete entry from Firebase or localStorage
async function deleteEntryFromDB(entryId) {
    console.log('Deleting entry:', entryId, 'firebaseAvailable:', firebaseAvailable);
    
    // ALWAYS delete from localStorage first
    deleteFromLocalStorage(entryId);
    console.log('Deleted from localStorage');
    
    // Also delete associated files
    await deleteFilesForEntry(entryId);
    
    // Then try Firebase if available
    if (firebaseAvailable) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Firebase delete timeout')), 5000)
            );
            const firebasePromise = db.collection('entries').doc(entryId).delete();
            await Promise.race([firebasePromise, timeoutPromise]);
            console.log('Entry also deleted from Firebase');
        } catch (error) {
            console.warn('Firebase delete failed/timed out:', error.message);
        }
    }
}

function deleteFromLocalStorage(entryId) {
    console.log('Deleting from localStorage:', entryId);
    let entries = JSON.parse(localStorage.getItem('qbo_tracker_entries') || '[]');
    entries = entries.filter(e => e.id !== entryId);
    localStorage.setItem('qbo_tracker_entries', JSON.stringify(entries));
    console.log('Deleted from localStorage, remaining entries:', entries.length);
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
    initImportExport();
    // File upload functionality removed - using "Files Received" dropdown instead
    
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
    console.log('=== REFRESH DATA ===');
    allEntries = await getEntries();
    console.log('After getEntries, allEntries count:', allEntries.length);
    console.log('Entry IDs in allEntries:', allEntries.map(e => e.id));
    updateDashboard();
    await renderEntries();
    renderBanks();
    console.log('=== REFRESH DATA COMPLETE ===');
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
            console.log('Provider is a placeholder value, skipping duplicate check:', providerLower);
            return null;
        }
        
        const entries = await getEntries();
        
        console.log('=== DUPLICATE CHECK ===');
        console.log('Provider to check:', providerLower);
        console.log('Total entries:', entries.length);
        
        for (const entry of entries) {
            const entryProviderLower = (entry.provider || '').toLowerCase().trim();
            
            // Skip entries with placeholder providers
            if (PLACEHOLDER_PROVIDERS.includes(entryProviderLower)) {
                continue;
            }
            
            // Check if provider matches
            if (entryProviderLower === providerLower) {
                console.log('DUPLICATE FOUND! Entry:', entry.id, 'Bank:', entry.bankName);
                return entry;
            }
        }
        
        console.log('No duplicate found');
        return null;
    } catch (error) {
        console.error('Error checking duplicate:', error);
        return null; // Allow save if check fails
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    console.log('Form submit started...');
    
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
    
    console.log('Entry data:', entryData);
    
    const isEditing = !!elements.entryId.value;
    const editingEntryId = isEditing ? elements.entryId.value : null;
    
    console.log('isEditing:', isEditing, 'editingEntryId:', editingEntryId);
    
    // Check for duplicate Provider ID (placeholders like "Not yet created" are allowed)
    console.log('Checking for duplicate Provider...');
    const existingEntry = await checkDuplicateProvider(entryData.provider);
    
    // If duplicate found, check if it's the same entry being edited
    if (existingEntry) {
        const isSameEntry = isEditing && String(existingEntry.id) === String(editingEntryId);
        
        if (!isSameEntry) {
            console.log('Duplicate found and it is a different entry');
            showToast(`Provider ID "${entryData.provider}" already exists for bank "${existingEntry.bankName}"!`, 'error');
            elements.provider.focus();
            elements.provider.classList.add('input-error');
            setTimeout(() => {
                elements.provider.classList.remove('input-error');
            }, 3000);
            return;
        } else {
            console.log('Duplicate found but it is the same entry being edited - OK');
        }
    }
    
    if (isEditing) {
        entryData.id = elements.entryId.value;
    } else {
        entryData.createdAt = new Date().toISOString();
    }
    
    console.log('Saving entry...');
    const savedEntry = await saveEntry(entryData);
    console.log('Save result:', savedEntry);
    
    if (savedEntry) {
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
    console.log('Editing entry with ID:', id, 'Type:', typeof id);
    // Compare as strings to handle type mismatches
    const entry = allEntries.find(e => String(e.id) === String(id));
    console.log('Found entry:', entry);
    if (entry) {
        await openModal(entry);
    } else {
        console.error('Entry not found with ID:', id);
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
            let failedCount = 0;
            let skippedCount = 0;
            
            // Show progress
            showToast(`Importing ${jsonData.length} entries...`, 'success');
            
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
                    try {
                        const savedEntry = await saveEntry(entryData);
                        if (savedEntry) {
                            importedCount++;
                        } else {
                            failedCount++;
                            console.error('Failed to save entry:', entryData);
                        }
                    } catch (saveError) {
                        failedCount++;
                        console.error('Error saving entry:', saveError, entryData);
                    }
                } else {
                    skippedCount++;
                    console.warn('Skipped row - missing bankName or customerId:', row);
                }
            }
            
            // Build result message
            let message = `Imported ${importedCount} entries`;
            if (failedCount > 0) message += `, ${failedCount} failed`;
            if (skippedCount > 0) message += `, ${skippedCount} skipped`;
            
            showToast(message, failedCount > 0 ? 'error' : 'success');
            await refreshData();
            
            // Log summary to console for debugging
            console.log('Import Summary:', { importedCount, failedCount, skippedCount, total: jsonData.length });
            
        } catch (error) {
            console.error('Import error:', error);
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
