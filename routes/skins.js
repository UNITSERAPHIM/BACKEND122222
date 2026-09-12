import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserInventory, estimateBatch } from '../services/steam.js';
import * as db from '../db.js';

const router = express.Router();
const COMMISSION_PERCENT = parseFloat(process.env.COMMISSION_PERCENT) || 7.5;

// ============================================================
// ИНВЕНТАРЬ ПОЛЬЗОВАТЕЛЯ
// Фронт запрашивает — бэкенд тянет инвентарь через Steam API
// ============================================================
router.post('/skins/inventory', requireAuth, async (req, res) => {
    try {
        const user = db.findUserById(req.user.id);
        if (!user || !user.steamId) {
            return res.status(400).json({ error: 'Steam не привязан' });
        }

        const inventory = await getUserInventory(user.steamId, 730, 2);
        res.json({ inventory });

    } catch (e) {
        console.error('[Skins inventory]', e.message);
        res.status(500).json({ error: 'Ошибка получения инвентаря' });
    }
});

// ============================================================
// ОЦЕНКА СКИНОВ
// Принимает массив market_hash_name, возвращает цены с комиссией
// ============================================================
router.post('/skins/estimate', requireAuth, async (req, res) => {
    try {
        const { marketHashNames } = req.body;

        if (!Array.isArray(marketHashNames) || marketHashNames.length === 0) {
            return res.status(400).json({ error: 'Нет скинов для оценки' });
        }
        if (marketHashNames.length > 20) {
            return res.status(400).json({ error: 'Максимум 20 скинов за раз' });
        }

        const items = marketHashNames.map(name => ({
            marketHashName: String(name).slice(0, 200)
        }));

        const estimated = await estimateBatch(items);

        const totalUsd = estimated.reduce((s, i) => s + (i.priceUsd || 0), 0);
        const commission = totalUsd * COMMISSION_PERCENT / 100;
        const netUsd = totalUsd - commission;
        const netGrn = netUsd; // 1 USDT = 1 GRN

        res.json({
            items: estimated,
            totalUsd: parseFloat(totalUsd.toFixed(2)),
            commission: parseFloat(commission.toFixed(2)),
            netUsd: parseFloat(netUsd.toFixed(2)),
            netGrn: parseFloat(netGrn.toFixed(2)),
            commissionPercent: COMMISSION_PERCENT
        });

    } catch (e) {
        console.error('[Skins estimate]', e.message);
        res.status(500).json({ error: 'Ошибка оценки' });
    }
});

// ============================================================
// ПРИЁМ СКИНОВ (эмуляция робота)
// В реальном продакшене здесь был бы вызов Steam-бота
// ============================================================
router.post('/skins/accept', requireAuth, async (req, res) => {
    try {
        const { marketHashNames, tradeLink } = req.body;
        const user = db.findUserById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!user.steamId) {
            return res.status(400).json({ error: 'Steam не привязан' });
        }
        if (!tradeLink || !tradeLink.startsWith('https://steamcommunity.com/tradeoffer/')) {
            return res.status(400).json({ error: 'Некорректная ссылка на обмен' });
        }
        if (!Array.isArray(marketHashNames) || marketHashNames.length === 0) {
            return res.status(400).json({ error: 'Нет скинов' });
        }
        if (marketHashNames.length > 20) {
            return res.status(400).json({ error: 'Максимум 20 скинов' });
        }

        // В РЕАЛЬНОМ ПРОДАКШЕНЕ:
        // 1. Отправить trade offer через Steam-бота (steam-user + steam-tradeoffer-manager)
        // 2. Дождаться подтверждения пользователя в Steam Guard
        // 3. Проверить, что предметы пришли на аккаунт бота
        // 4. Пересчитать стоимость через Pricempire
        // 5. Начислить GRN

        const items = marketHashNames.map(name => ({
            marketHashName: String(name).slice(0, 200)
        }));

        const estimated = await estimateBatch(items);

        const totalUsd = estimated.reduce((s, i) => s + (i.priceUsd || 0), 0);
        const commission = totalUsd * COMMISSION_PERCENT / 100;
        const netGrn = totalUsd - commission;

        // Начисляем пользователю
        user.balances.grn = (user.balances.grn || 0) + netGrn;
        user.steamTradeLink = tradeLink;
        db.updateUser(user.id, user);

        // Записываем транзакцию
        db.addTransaction({
            userId: user.id,
            type: 'skin_exchange',
            items: estimated.map(i => i.marketHashName),
            totalUsd: parseFloat(totalUsd.toFixed(2)),
            commission: parseFloat(commission.toFixed(2)),
            netGrn: parseFloat(netGrn.toFixed(2)),
            tradeLink,
            status: 'completed'
        });

        console.log(`[Skins] ${user.login} → +${netGrn.toFixed(2)} GRN за ${items.length} скинов`);

        res.json({
            success: true,
            totalUsd: parseFloat(totalUsd.toFixed(2)),
            commission: parseFloat(commission.toFixed(2)),
            netGrn: parseFloat(netGrn.toFixed(2)),
            newBalance: user.balances
        });

    } catch (e) {
        console.error('[Skins accept]', e.message);
        res.status(500).json({ error: 'Ошибка приёма скинов' });
    }
});

export default router;
