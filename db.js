import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

// ============================================================
// ХРАНИЛИЩЕ (в памяти + сохранение в файл db.json)
// ============================================================
let db = {
    users: {},
    transactions: [],
    sbpPending: {}
};

// Загрузка из файла при старте
if (fs.existsSync(DB_FILE)) {
    try {
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        db.users = parsed.users || {};
        db.transactions = parsed.transactions || [];
        db.sbpPending = parsed.sbpPending || {};
        console.log(`[DB] Loaded ${Object.keys(db.users).length} users, ${db.transactions.length} transactions`);
    } catch (e) {
        console.error('[DB] Load error:', e.message);
    }
} else {
    console.log('[DB] New database created');
}

// Сохранить на диск (вызывается после каждой записи)
function persist() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('[DB] Persist error:', e.message);
    }
}

// ============================================================
// ПОЛЬЗОВАТЕЛИ
// ============================================================

// Найти по провайдеру (google / telegram / steam) и его ID
export function findUserByProvider(provider, providerId) {
    return Object.values(db.users).find(
        u => u.provider === provider && String(u.providerId) === String(providerId)
    );
}

// Найти по внутреннему ID
export function findUserById(id) {
    return db.users[id];
}

// Найти по логину
export function findUserByLogin(login) {
    return Object.values(db.users).find(u => u.login === login);
}

// Создать пользователя
export function createUser(data) {
    const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    const user = {
        id,
        login: data.login || `user_${id.slice(-6)}`,
        email: data.email || null,
        provider: data.provider || 'local',
        providerId: data.providerId ? String(data.providerId) : null,
        displayName: data.displayName || null,
        avatar: data.avatar || null,
        balances: {
            usdt: 0,
            grn: 0,
            bonus: 0,
            ...(data.balances || {})
        },
        steamId: data.steamId || null,
        steamTradeLink: data.steamTradeLink || '',
        metaMaskAddress: data.metaMaskAddress || null,
        clubMember: data.clubMember || false,
        createdAt: Date.now()
    };

    db.users[id] = user;
    persist();
    console.log(`[DB] User created: ${user.login} (${user.provider})`);
    return user;
}

// Обновить пользователя
export function updateUser(id, patch) {
    if (!db.users[id]) return null;
    Object.assign(db.users[id], patch);
    persist();
    return db.users[id];
}

// Получить всех пользователей
export function getAllUsers() {
    return Object.values(db.users);
}

// ============================================================
// ТРАНЗАКЦИИ
// ============================================================
export function addTransaction(tx) {
    const transaction = {
        id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        createdAt: Date.now(),
        ...tx
    };
    db.transactions.push(transaction);
    persist();
    return transaction;
}

export function getUserTransactions(userId) {
    return db.transactions.filter(t => t.userId === userId);
}

export function getAllTransactions() {
    return db.transactions;
}

// ============================================================
// СБП — временные платежи до подтверждения
// ============================================================
export function savePendingSbp(orderId, data) {
    db.sbpPending[orderId] = data;
    persist();
}

export function getPendingSbp(orderId) {
    return db.sbpPending[orderId];
}

export function removePendingSbp(orderId) {
    delete db.sbpPending[orderId];
    persist();
}

export default db;
