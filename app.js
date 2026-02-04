// ===== Database Setup with Dexie =====
const db = new Dexie('ZenSpendDB');
db.version(1).stores({
    expenses: '++id, amount, category, description, isWant, date, month',
    parking: '++id, amount, category, description, parkDate, expiryDate',
    settings: 'key, value'
});

// ===== App State =====
const state = {
    budget: 0,
    impulseTax: 0,
    mascotState: 'zen',
    holdTimeout: null,
    holdProgress: 0,
    isHolding: false,
    pendingExpense: null,
    charts: { pie: null, bar: null }
};

// ===== Category Icons =====
const categoryIcons = {
    'Food': '🍕',
    'Travel': '🚗',
    'Fees/Bills': '📄',
    'Home': '🏠',
    'Groceries': '🛒',
    'Shopping': '🛍️',
    'Gifting': '🎁',
    'Entertainment': '🎬'
};

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== Initialize App =====
async function init() {
    await loadSettings();
    await updateDashboard();
    await renderExpenses();
    await renderParking();
    await updateCharts();
    setupEventListeners();
    registerServiceWorker();
    updateMascot();
}

// ===== Settings Management =====
async function loadSettings() {
    const budgetSetting = await db.settings.get('budget');
    const taxSetting = await db.settings.get('impulseTax');
    
    state.budget = budgetSetting?.value || 0;
    state.impulseTax = taxSetting?.value || 0;
    
    $('#monthlyBudget').value = state.budget || '';
}

async function saveBudget(amount) {
    await db.settings.put({ key: 'budget', value: amount });
    state.budget = amount;
    await updateDashboard();
    updateMascot('proud');
    showToast('Budget saved! 💰');
}

async function saveImpulseTax(amount) {
    state.impulseTax += amount;
    await db.settings.put({ key: 'impulseTax', value: state.impulseTax });
}

// ===== Core Calculations =====
function getDaysInMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function getDaysRemaining() {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(1, lastDay - now.getDate() + 1);
}

function getDaysPassed() {
    const now = new Date();
    return Math.max(1, now.getDate());
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getMonthlySpending() {
    const month = getCurrentMonth();
    const expenses = await db.expenses.where('month').equals(month).toArray();
    return expenses.reduce((sum, e) => sum + e.amount, 0);
}

async function calculateSafeToSpend() {
    if (state.budget <= 0) return 0;
    const spent = await getMonthlySpending();
    const remaining = state.budget - spent;
    const daysLeft = getDaysRemaining();
    return Math.max(0, Math.floor(remaining / daysLeft));
}

async function calculateRunway() {
    const spent = await getMonthlySpending();
    const remaining = state.budget - spent;
    
    if (spent <= 0) return { type: 'infinite' };
    if (remaining <= 0) return { type: 'overrun' };
    
    const avgDaily = spent / getDaysPassed();
    const daysUntilZero = remaining / avgDaily;
    
    const runwayDate = new Date();
    runwayDate.setDate(runwayDate.getDate() + Math.floor(daysUntilZero));
    
    return { type: 'date', date: runwayDate };
}

function calculateImpulseTax(amount) {
    if (amount % 100 === 0) return 0;
    return Math.ceil(amount / 100) * 100 - amount;
}

// ===== Dashboard Update =====
async function updateDashboard() {
    const spent = await getMonthlySpending();
    const safeToSpend = await calculateSafeToSpend();
    const runway = await calculateRunway();
    
    // Update values
    $('#safeToSpend').textContent = `₹${safeToSpend.toLocaleString()}`;
    $('#impulseTax').textContent = `₹${state.impulseTax.toLocaleString()}`;
    $('#budgetAmount').textContent = state.budget.toLocaleString();
    $('#spentAmount').textContent = Math.floor(spent).toLocaleString();
    
    // Update runway
    if (runway.type === 'infinite') {
        $('#runway').textContent = '∞';
    } else if (runway.type === 'overrun') {
        $('#runway').textContent = 'Overrun!';
    } else {
        const options = { month: 'short', day: 'numeric' };
        $('#runway').textContent = runway.date.toLocaleDateString('en-IN', options);
    }
    
    // Update progress bar
    const progress = state.budget > 0 ? (spent / state.budget) * 100 : 0;
    $('#budgetProgress').style.width = `${Math.min(100, progress)}%`;
    
    // Warning state
    const safeCard = $('.safe-spend-card');
    if (safeToSpend < 100) {
        safeCard.classList.add('warning');
    } else {
        safeCard.classList.remove('warning');
    }
}

// ===== Mascot System =====
function updateMascot(tempState = null) {
    const mascot = $('#mascot');
    let newState = 'zen';
    
    if (tempState) {
        newState = tempState;
        mascot.src = `assets/mascot-${tempState}.png`;
        setTimeout(() => updateMascot(), 3000);
        return;
    }
    
    // Calculate persistent state
    (async () => {
        const safeToSpend = await calculateSafeToSpend();
        const spent = await getMonthlySpending();
        const ratio = state.budget > 0 ? (state.budget - spent) / state.budget : 1;
        
        if (safeToSpend < 100) {
            newState = 'panicked';
        } else if (ratio < 0.5) {
            newState = 'suspicious';
        } else {
            newState = 'zen';
        }
        
        state.mascotState = newState;
        mascot.src = `assets/mascot-${newState}.png`;
    })();
}

// ===== Expense Management =====
async function addExpense(data) {
    const now = new Date();
    const expense = {
        amount: parseFloat(data.amount),
        category: data.category,
        description: data.description || '',
        isWant: data.isWant,
        date: now.toISOString(),
        month: getCurrentMonth()
    };
    
    await db.expenses.add(expense);
    
    // Handle impulse tax for "Want" expenses
    if (data.isWant) {
        const tax = calculateImpulseTax(expense.amount);
        if (tax > 0) {
            await saveImpulseTax(tax);
        }
    }
    
    await updateDashboard();
    await renderExpenses();
    await updateCharts();
    updateMascot(data.isWant && expense.amount > 2000 ? 'disappointed' : null);
    
    playSound(data.isWant ? 'crunch' : 'chime');
}

async function deleteExpense(id) {
    await db.expenses.delete(id);
    await updateDashboard();
    await renderExpenses();
    await updateCharts();
}

async function renderExpenses() {
    const month = getCurrentMonth();
    const expenses = await db.expenses.where('month').equals(month).reverse().toArray();
    const container = $('#expenseList');
    
    if (expenses.length === 0) {
        container.innerHTML = '<p class="empty-state">No expenses yet. Start tracking!</p>';
        return;
    }
    
    container.innerHTML = expenses.map(e => {
        const date = new Date(e.date);
        const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="expense-item" data-id="${e.id}">
                <div class="expense-icon">${categoryIcons[e.category] || '💰'}</div>
                <div class="expense-details">
                    <div class="expense-category">${e.category}</div>
                    ${e.description ? `<div class="expense-desc">${e.description}</div>` : ''}
                    <div class="expense-meta">${dateStr} • ${timeStr} • ${e.isWant ? 'Want' : 'Need'}</div>
                </div>
                <div class="expense-amount ${e.isWant ? 'want' : 'need'}">₹${e.amount.toLocaleString()}</div>
                <button class="delete-btn" onclick="deleteExpense(${e.id})">×</button>
            </div>
        `;
    }).join('');
}

// ===== Parking Lot (30-Day Rule) =====
async function parkItem(data) {
    const now = new Date();
    const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    await db.parking.add({
        amount: parseFloat(data.amount),
        category: data.category,
        description: data.description || '',
        parkDate: now.toISOString(),
        expiryDate: expiry.toISOString()
    });
    
    await renderParking();
    updateMascot('proud');
    showToast('Item parked for 30 days! 🅿️');
}

async function convertParkedToExpense(id) {
    const item = await db.parking.get(id);
    if (!item) return;
    
    await addExpense({
        amount: item.amount,
        category: item.category,
        description: item.description,
        isWant: true
    });
    
    await db.parking.delete(id);
    await renderParking();
}

async function deleteParkedItem(id) {
    await db.parking.delete(id);
    await renderParking();
    showToast('Item removed from parking! 🎉');
}

async function renderParking() {
    const items = await db.parking.toArray();
    const container = $('#parkingList');
    
    if (items.length === 0) {
        container.innerHTML = '<p class="empty-state">Parked items will appear here.</p>';
        return;
    }
    
    const now = new Date();
    
    container.innerHTML = items.map(item => {
        const expiry = new Date(item.expiryDate);
        const daysLeft = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
        
        return `
            <div class="parking-item" data-id="${item.id}">
                <div class="parking-header">
                    <div>
                        <strong>${item.category}</strong> - ₹${item.amount.toLocaleString()}
                        ${item.description ? `<br><small>${item.description}</small>` : ''}
                    </div>
                    <span class="parking-countdown">${daysLeft} days left</span>
                </div>
                <div class="parking-actions">
                    <button class="btn btn-secondary" onclick="deleteParkedItem(${item.id})">Remove</button>
                    <button class="btn btn-primary" onclick="convertParkedToExpense(${item.id})">Buy Now</button>
                </div>
            </div>
        `;
    }).join('');
}

// ===== Charts =====
async function updateCharts() {
    await updatePieChart();
    await updateBarChart();
}

async function updatePieChart() {
    const month = getCurrentMonth();
    const expenses = await db.expenses.where('month').equals(month).toArray();
    
    const categoryTotals = {};
    expenses.forEach(e => {
        categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
    });
    
    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    
    const ctx = $('#pieChart').getContext('2d');
    
    if (state.charts.pie) {
        state.charts.pie.destroy();
    }
    
    state.charts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: [
                    'rgba(127, 176, 105, 0.8)',
                    'rgba(224, 122, 95, 0.8)',
                    'rgba(19, 78, 94, 0.8)',
                    'rgba(255, 206, 86, 0.8)',
                    'rgba(153, 102, 255, 0.8)',
                    'rgba(75, 192, 192, 0.8)',
                    'rgba(255, 159, 64, 0.8)',
                    'rgba(199, 199, 199, 0.8)'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11 } }
                }
            }
        }
    });
}

async function updateBarChart() {
    const now = new Date();
    const months = [];
    const totals = [];
    
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = d.toLocaleDateString('en-IN', { month: 'short' });
        
        const expenses = await db.expenses.where('month').equals(monthKey).toArray();
        const total = expenses.reduce((sum, e) => sum + e.amount, 0);
        
        months.push(monthLabel);
        totals.push(total);
    }
    
    const ctx = $('#barChart').getContext('2d');
    
    if (state.charts.bar) {
        state.charts.bar.destroy();
    }
    
    state.charts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Spending',
                data: totals,
                backgroundColor: 'rgba(127, 176, 105, 0.6)',
                borderColor: 'rgba(127, 176, 105, 1)',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: 'rgba(255,255,255,0.7)' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: { color: 'rgba(255,255,255,0.7)' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Tab Navigation
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.tab-btn').forEach(b => b.classList.remove('active'));
            $$('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            $(`#${btn.dataset.tab}-panel`).classList.add('active');
        });
    });
    
    // Modal Controls
    $('#addExpenseBtn').addEventListener('click', () => openModal('expenseModal'));
    $('#closeModal').addEventListener('click', () => closeModal('expenseModal'));
    $('#settingsBtn').addEventListener('click', () => openModal('settingsModal'));
    $('#closeSettings').addEventListener('click', () => closeModal('settingsModal'));
    
    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });
    
    // Need/Want Toggle
    $('#wantToggle').addEventListener('change', handleToggleChange);
    
    // Amount Input - Lunch Translator
    $('#amount').addEventListener('input', handleAmountChange);
    
    // Save Button - Hold for Want
    const saveBtn = $('#saveBtn');
    saveBtn.addEventListener('mousedown', startHold);
    saveBtn.addEventListener('touchstart', startHold, { passive: true });
    saveBtn.addEventListener('mouseup', endHold);
    saveBtn.addEventListener('touchend', endHold);
    saveBtn.addEventListener('mouseleave', cancelHold);
    
    // Form Submit
    $('#expenseForm').addEventListener('submit', handleFormSubmit);
    
    // Park Button
    $('#parkBtn').addEventListener('click', handlePark);
    
    // Settings
    $('#saveBudget').addEventListener('click', () => {
        const amount = parseFloat($('#monthlyBudget').value) || 0;
        saveBudget(amount);
    });
    
    // Export/Import
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('change', importData);
    $('#clearBtn').addEventListener('click', clearData);
    
    // Encrypt toggle
    $('#encryptBackup').addEventListener('change', (e) => {
        $('#encryptPassword').classList.toggle('hidden', !e.target.checked);
    });
    
    // CPU Modal
    $('#cpuCancel').addEventListener('click', () => {
        closeModal('cpuModal');
        state.pendingExpense = null;
    });
    
    $('#cpuConfirm').addEventListener('click', () => {
        closeModal('cpuModal');
        if (state.pendingExpense) {
            addExpense(state.pendingExpense);
            state.pendingExpense = null;
            closeModal('expenseModal');
            resetForm();
        }
    });
    
    $('#cpuUses').addEventListener('input', updateCpuResult);
}

// ===== Modal Functions =====
function openModal(id) {
    $(`#${id}`).classList.add('active');
}

function closeModal(id) {
    $(`#${id}`).classList.remove('active');
}

function resetForm() {
    $('#expenseForm').reset();
    $('#wantToggle').checked = false;
    handleToggleChange();
    $('#lunchToast').classList.add('hidden');
}

// ===== Toggle Handler =====
function handleToggleChange() {
    const isWant = $('#wantToggle').checked;
    const label = $('#toggleLabel');
    const saveBtn = $('#saveBtn');
    const parkBtn = $('#parkBtn');
    
    label.textContent = isWant ? 'Want' : 'Need';
    label.className = `toggle-label ${isWant ? 'want' : 'need'}`;
    
    parkBtn.classList.toggle('hidden', !isWant);
    saveBtn.classList.toggle('want-mode', isWant);
    
    updateMascot(isWant ? 'suspicious' : null);
}

// ===== Amount Change Handler (Lunch Translator) =====
function handleAmountChange() {
    const amount = parseFloat($('#amount').value) || 0;
    const toast = $('#lunchToast');
    
    if (amount > 1000) {
        const days = Math.floor(amount / 90);
        toast.innerHTML = `That's equivalent to <strong>${days} days</strong> of essential meals.`;
        toast.classList.remove('hidden');
    } else {
        toast.classList.add('hidden');
    }
}

// ===== Hold Button Logic =====
function startHold(e) {
    if (!$('#wantToggle').checked) return;
    e.preventDefault();
    
    if (!$('#expenseForm').checkValidity()) {
        $('#expenseForm').reportValidity();
        return;
    }
    
    state.isHolding = true;
    state.holdProgress = 0;
    
    const saveBtn = $('#saveBtn');
    const ring = $('.ring-progress');
    
    saveBtn.classList.add('holding');
    $('.progress-ring').classList.remove('hidden');
    
    const duration = 10000; // 10 seconds
    const interval = 100;
    const increment = (100.53 / (duration / interval));
    
    state.holdTimeout = setInterval(() => {
        state.holdProgress += increment;
        const offset = 100.53 - state.holdProgress;
        ring.style.strokeDashoffset = Math.max(0, offset);
        
        if (state.holdProgress >= 100.53) {
            clearInterval(state.holdTimeout);
            completeHold();
        }
    }, interval);
}

function endHold() {
    if (!state.isHolding) return;
    cancelHold();
}

function cancelHold() {
    if (state.holdTimeout) {
        clearInterval(state.holdTimeout);
    }
    state.isHolding = false;
    state.holdProgress = 0;
    
    const saveBtn = $('#saveBtn');
    saveBtn.classList.remove('holding');
    $('.progress-ring').classList.add('hidden');
    $('.ring-progress').style.strokeDashoffset = 100.53;
}

function completeHold() {
    state.isHolding = false;
    cancelHold();
    processExpense(true);
}

// ===== Form Submit Handler =====
function handleFormSubmit(e) {
    e.preventDefault();
    
    const isWant = $('#wantToggle').checked;
    
    if (isWant) {
        // Requires hold - do nothing on regular submit
        return;
    }
    
    processExpense(false);
}

// ===== Process Expense =====
function processExpense(isWant) {
    const amount = parseFloat($('#amount').value);
    const category = $('#category').value;
    const description = $('#description').value;
    
    const expenseData = { amount, category, description, isWant };
    
    // Check for Cost-Per-Use trigger
    if ((category === 'Shopping' || category === 'Entertainment') && amount > 2000) {
        state.pendingExpense = expenseData;
        showCpuModal(amount);
        return;
    }
    
    addExpense(expenseData);
    closeModal('expenseModal');
    resetForm();
}

// ===== Cost Per Use Modal =====
function showCpuModal(amount) {
    $('#cpuAmount').textContent = amount.toLocaleString();
    $('#cpuUses').value = 1;
    updateCpuResult();
    openModal('cpuModal');
}

function updateCpuResult() {
    const amount = state.pendingExpense?.amount || 0;
    const uses = parseInt($('#cpuUses').value) || 1;
    const costPerUse = Math.round(amount / uses);
    const coffees = Math.round(costPerUse / 180); // Assuming ₹180 per coffee
    
    $('#cpuResult').innerHTML = `
        <strong>₹${costPerUse.toLocaleString()}</strong> per use<br>
        <small>That's ~${coffees} expensive coffees each time!</small>
    `;
}

// ===== Park Handler =====
function handlePark() {
    if (!$('#expenseForm').checkValidity()) {
        $('#expenseForm').reportValidity();
        return;
    }
    
    const data = {
        amount: $('#amount').value,
        category: $('#category').value,
        description: $('#description').value
    };
    
    parkItem(data);
    closeModal('expenseModal');
    resetForm();
}

// ===== Sound Effects =====
function playSound(type) {
    const sound = type === 'chime' ? $('#chimeSound') : $('#crunchSound');
    sound.currentTime = 0;
    sound.play().catch(() => {}); // Ignore autoplay restrictions
}

// ===== Toast Notifications =====
function showToast(message) {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// ===== Data Export/Import =====
async function exportData() {
    const expenses = await db.expenses.toArray();
    const parking = await db.parking.toArray();
    const settings = await db.settings.toArray();
    
    let data = JSON.stringify({ expenses, parking, settings, exportDate: new Date().toISOString() });
    
    // Encryption
    if ($('#encryptBackup').checked) {
        const password = $('#encryptPassword').value;
        if (!password) {
            showToast('Please enter a password');
            return;
        }
        data = CryptoJS.AES.encrypt(data, password).toString();
    }
    
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenspend_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    updateMascot('proud');
    showToast('Backup created! 💾');
}

async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            let data = event.target.result;
            
            // Try to decrypt if it looks encrypted
            if (!data.startsWith('{')) {
                const password = prompt('Enter decryption password:');
                if (!password) return;
                
                const bytes = CryptoJS.AES.decrypt(data, password);
                data = bytes.toString(CryptoJS.enc.Utf8);
                
                if (!data) {
                    showToast('Decryption failed. Wrong password?');
                    return;
                }
            }
            
            const parsed = JSON.parse(data);
            
            if (confirm('This will replace all existing data. Continue?')) {
                await db.expenses.clear();
                await db.parking.clear();
                await db.settings.clear();
                
                if (parsed.expenses) await db.expenses.bulkAdd(parsed.expenses);
                if (parsed.parking) await db.parking.bulkAdd(parsed.parking);
                if (parsed.settings) await db.settings.bulkPut(parsed.settings);
                
                await loadSettings();
                await updateDashboard();
                await renderExpenses();
                await renderParking();
                await updateCharts();
                
                showToast('Data imported successfully! 📥');
            }
        } catch (err) {
            showToast('Import failed. Invalid file format.');
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
}

async function clearData() {
    if (!confirm('Are you sure? This will delete ALL your data permanently!')) return;
    if (!confirm('Really? This cannot be undone!')) return;
    
    await db.expenses.clear();
    await db.parking.clear();
    await db.settings.clear();
    
    state.budget = 0;
    state.impulseTax = 0;
    
    await updateDashboard();
    await renderExpenses();
    await renderParking();
    await updateCharts();
    
    showToast('All data cleared.');
}

// ===== Service Worker Registration =====
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('SW registered'))
            .catch(err => console.log('SW registration failed:', err));
    }
}

// ===== Start App =====
document.addEventListener('DOMContentLoaded', init);