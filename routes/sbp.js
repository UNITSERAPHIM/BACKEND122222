import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';
import * as db from '../db.js';

const router = express.Router();

const USDT_RUB_RATE = parseFloat(process.env.USDT_RUB_RATE) || 92;
const COMMISSION_PERCENT = parseFloat(process.env.COMMISSION_PERCENT) || 7.5;

// ============================================================
// ГЕНЕРАЦИЯ TOKEN ДЛЯ T-BANK API
// ============================================================
function generateTbankToken(payload) {
    const tokenPayload = { ...payload, Password: process.env.TBANK_PASSWORD };
    const sortedKeys = Object.keys(tokenPayload).sort();
    const concat = sortedKeys
        .filter(k => k !== 'Token' && !k.startsWith('DATA'))
        .map(k => tokenPayload[k])
        .join('');
    return crypto.createHash('sha256').update(concat).digest('hex');
}

// ============================================================
// СОЗДАТЬ ПЛАТЁЖ + QR
// ============================================================
router.post('/sbp/create', requireAuth, async (req, res) => {
    try {
        const { amountRub } = req.body;
        const userId = req.user.id;

        const amount = parseFloat(amountRub);
        if (isNaN(amount) || amount < 100 || amount > 150000) {
            return res.status(400).json({ error: 'Сумма должна быть от 100 до 150 000 ₽' });
        }

        const usdtBeforeCommission = amount / USDT_RUB_RATE;
        const commission = usdtBeforeCommission * COMMISSION_PERCENT / 100;
        const usdtAfterCommission = usdtBeforeCommission - commission;

        const orderId = `sbp_${userId}_${Date.now()}`;

        // Запрос Init в T-Bank
        const initPayload = {
            TerminalKey: process.env.TBANK_TERMINAL_KEY,
            Amount: Math.round(amount * 100),
            OrderId: orderId,
            Description: `Пополнение GREENCOIN для ${userId}`,
            PayType: 'O'
        };
        initPayload.Token = generateTbankToken(initPayload);

        const initRes = await fetch(`${process.env.TBANK_API_URL}/Init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initPayload)
        });
        const initData = await initRes.json();

        if (!initData.Success) {
            console.error('[T-Bank Init]', initData);
            return res.status(500).json({
                error: 'Ошибка банка: ' + (initData.Message || 'unknown')
            });
        }

        // Запрос QR
        const qrPayload = {
            TerminalKey: process.env.TBANK_TERMINAL_KEY,
            PaymentId: initData.PaymentId,
            DataType: 'IMAGE'
        };
        qrPayload.Token = generateTbankToken(qrPayload);

        const qrRes = await fetch(`${process.env.TBANK_API_URL}/GetQr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(qrPayload)
        });
        const qrData = await qrRes.json();

        if (!qrData.Success) {
            console.error('[T-Bank QR]', qrData);
            return res.status(500).json({ error: 'Ошибка генерации QR' });
        }

        // Сохраняем pending-платёж
        db.savePendingSbp(orderId, {
            userId,
            paymentId: initData.PaymentId,
            amountRub: amount,
            amountUsdtBefore: usdtBeforeCommission,
            commission,
            amountUsdtAfter: usdtAfterCommission,
            amountGrn: usdtAfterCommission,
            status: 'pending',
            createdAt: Date.now()
        });

        res.json({
            orderId,
            paymentId: initData.PaymentId,
            qrImage: qrData.Data,
            amountRub: amount,
            amountUsdt: usdtAfterCommission,
            amountGrn: usdtAfterCommission,
            commissionPercent: COMMISSION_PERCENT
        });

    } catch (e) {
        console.error('[SBP create]', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ============================================================
// ВЕБХУК ОТ T-BANK
// Банк сам присылает сюда уведомление об оплате
// ============================================================
router.post('/sbp/webhook', async (req, res) => {
    try {
        const body = req.body;

        // Проверка подписи
        const receivedToken = body.Token;
        const payload = { ...body };
        delete payload.Token;
        const expectedToken = generateTbankToken(payload);

        if (receivedToken !== expectedToken) {
            console.error('[Webhook] Invalid signature');
            return res.status(403).send('Invalid signature');
        }

        const { OrderId, Status, PaymentId } = body;
        if (Status !== 'CONFIRMED') {
            console.log(`[Webhook] Order ${OrderId}: ${Status}`);
            return res.send('OK');
        }

        const pending = db.getPendingSbp(OrderId);
        if (!pending) {
            console.error('[Webhook] Order not found:', OrderId);
            return res.send('OK');
        }
        if (pending.status === 'completed') {
            return res.send('OK');
        }

        const user = db.findUserById(pending.userId);
        if (!user) return res.send('OK');

        // Начисляем баланс
        user.balances.usdt = (user.balances.usdt || 0) + pending.amountUsdtAfter;
        user.balances.grn = (user.balances.grn || 0) + pending.amountGrn;
        db.updateUser(user.id, user);

        // Записываем транзакцию
        db.addTransaction({
            userId: user.id,
            type: 'sbp_deposit',
            amountRub: pending.amountRub,
            amountUsdt: pending.amountUsdtAfter,
            amountGrn: pending.amountGrn,
            commission: pending.commission,
            status: 'completed',
            orderId: OrderId,
            paymentId: PaymentId
        });

        pending.status = 'completed';
        db.savePendingSbp(OrderId, pending);

        console.log(`[Webhook] Order ${OrderId} completed. +${pending.amountGrn.toFixed(2)} GRN → ${user.login}`);
        res.send('OK');

    } catch (e) {
        console.error('[Webhook error]', e);
        res.status(500).send('Error');
    }
});

// ============================================================
// СТАТУС ПЛАТЕЖА (фронтенд опрашивает, пока не оплатят)
// ============================================================
router.get('/sbp/status/:orderId', requireAuth, (req, res) => {
    const pending = db.getPendingSbp(req.params.orderId);
    if (!pending) return res.status(404).json({ error: 'Not found' });
    if (pending.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json({
        status: pending.status,
        amountUsdt: pending.amountUsdtAfter,
        amountGrn: pending.amountGrn
    });
});

export default router;
