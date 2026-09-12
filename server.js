import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import sbpRoutes from './routes/sbp.js';
import skinsRoutes from './routes/skins.js';

const app = express();

// ============================================================
// БЕЗОПАСНОСТЬ
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        console.warn('[CORS blocked]', origin);
        callback(new Error('CORS blocked: ' + origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

// ============================================================
// RATE LIMITING (защита от спама)
// ============================================================
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Слишком много запросов, попробуйте позже' }
}));

app.use('/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Слишком много попыток авторизации' }
}));

app.use('/sbp/create', rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Слишком много запросов на оплату' }
}));

// ============================================================
// МАРШРУТЫ
// ============================================================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'green-noise-backend',
        version: '1.0.0',
        time: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

app.use('/', authRoutes);
app.use('/', sbpRoutes);
app.use('/', skinsRoutes);

// ============================================================
// ОБРАБОТКА ОШИБОК
// ============================================================
app.use((err, req, res, next) => {
    console.error('[Unhandled error]', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============================================================
// ЗАПУСК
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🌿 Green Noise backend started');
    console.log(`   Port: ${PORT}`);
    console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend: ${process.env.FRONTEND_URL || 'not set'}`);
    console.log(`   Google: ${process.env.GOOGLE_CLIENT_ID ? 'ON' : 'OFF'}`);
    console.log(`   Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'ON' : 'OFF'}`);
    console.log(`   Steam: ${process.env.STEAM_API_KEY ? 'ON' : 'OFF'}`);
    console.log(`   T-Bank: ${process.env.TBANK_TERMINAL_KEY ? 'ON' : 'OFF'}`);
});
