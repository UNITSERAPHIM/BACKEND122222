import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { checkSignature } from '@grammyjs/validator';
import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam-modern';
import { signToken, requireAuth, sanitizeUser } from '../middleware/auth.js';
import * as db from '../db.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ============================================================
// GOOGLE OAUTH
// Фронтенд присылает credential (JWT от Google Identity Services)
// Бэкенд верифицирует подпись через google-auth-library
// ============================================================
router.post('/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ error: 'No credential' });

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const { sub: googleId, email, name, picture, email_verified } = payload;

        if (!email_verified) {
            return res.status(403).json({ error: 'Email не подтверждён' });
        }

        let user = db.findUserByProvider('google', googleId);
        if (!user) {
            user = db.createUser({
                login: 'google_' + String(googleId).slice(-8),
                email,
                provider: 'google',
                providerId: String(googleId),
                displayName: name,
                avatar: picture,
                balances: { usdt: 100, grn: 100, bonus: 50 }
            });
        }

        const token = signToken(user);
        res.json({ token, user: sanitizeUser(user) });
    } catch (e) {
        console.error('[Google auth]', e.message);
        res.status(401).json({ error: 'Google verification failed' });
    }
});

// ============================================================
// TELEGRAM LOGIN WIDGET
// Telegram присылает объект user с hash — проверяем HMAC-SHA256
// через @grammyjs/validator
// ============================================================
router.post('/auth/telegram', (req, res) => {
    try {
        const data = req.body;
        if (!data || !data.hash) {
            return res.status(400).json({ error: 'No hash' });
        }

        // Проверка подписи Telegram
        const isValid = checkSignature(process.env.TELEGRAM_BOT_TOKEN, data);
        if (!isValid) {
            console.error('[Telegram auth] Invalid signature');
            return res.status(403).json({ error: 'Invalid Telegram signature' });
        }

        // Свежесть авторизации — не старше 24 часов
        const authDate = parseInt(data.auth_date || 0) * 1000;
        if (Date.now() - authDate > 24 * 60 * 60 * 1000) {
            return res.status(403).json({ error: 'Auth expired' });
        }

        const tgId = String(data.id);
        let user = db.findUserByProvider('telegram', tgId);
        if (!user) {
            user = db.createUser({
                login: 'tg_' + tgId,
                provider: 'telegram',
                providerId: tgId,
                displayName: (data.first_name || '') + (data.last_name ? ' ' + data.last_name : ''),
                avatar: data.photo_url || null,
                balances: { usdt: 100, grn: 100, bonus: 50 }
            });
        }

        const token = signToken(user);
        res.json({ token, user: sanitizeUser(user) });
    } catch (e) {
        console.error('[Telegram auth]', e.message);
        res.status(401).json({ error: 'Telegram verification failed' });
    }
});

// ============================================================
// STEAM OPENID 2.0
// Через паспортную стратегию passport-steam-modern
// ============================================================
if (process.env.STEAM_REALM && process.env.STEAM_RETURN_URL) {
    passport.use(new SteamStrategy({
        realm: process.env.STEAM_REALM,
        returnURL: process.env.STEAM_RETURN_URL,
        apiKey: process.env.STEAM_API_KEY
    }, (profile, done) => {
        try {
            const steamId = profile.id;
            let user = db.findUserByProvider('steam', steamId);

            if (!user) {
                user = db.createUser({
                    login: 'steam_' + steamId.slice(-8),
                    provider: 'steam',
                    providerId: steamId,
                    steamId: steamId,
                    displayName: profile.displayName || ('Steam ' + steamId.slice(-6)),
                    avatar: profile.photos?.[0]?.value || null,
                    balances: { usdt: 0, grn: 0, bonus: 0 }
                });
            } else if (!user.steamId) {
                user = db.updateUser(user.id, { steamId });
            }

            return done(null, user);
        } catch (e) {
            return done(e);
        }
    }));
}

// Открыть страницу авторизации Steam
router.get('/auth/steam',
    passport.authenticate('steam', { session: false })
);

// Steam вернёт пользователя сюда
router.get('/auth/steam/return',
    passport.authenticate('steam', { session: false, failureRedirect: '/auth/steam/fail' }),
    (req, res) => {
        const user = req.user;
        const token = signToken(user);
        // Редирект на фронтенд с токеном в query-параметре
        res.redirect(`${process.env.FRONTEND_URL}/?steam_token=${token}`);
    }
);

// Ошибка Steam-авторизации
router.get('/auth/steam/fail', (req, res) => {
    res.redirect(`${process.env.FRONTEND_URL}/?steam_error=1`);
});

// ============================================================
// ПОЛУЧИТЬ СВОЙ ПРОФИЛЬ
// Требует валидный JWT в заголовке Authorization
// ============================================================
router.get('/me', requireAuth, (req, res) => {
    const user = db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: sanitizeUser(user) });
});

export default router;