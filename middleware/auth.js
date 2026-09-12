import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ============================================================
// СОЗДАТЬ JWT-ТОКЕН ДЛЯ ПОЛЬЗОВАТЕЛЯ
// ============================================================
export function signToken(user) {
    return jwt.sign(
        {
            id: user.id,
            login: user.login,
            provider: user.provider
        },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );
}

// ============================================================
// MIDDLEWARE: ТРЕБУЕТ АВТОРИЗАЦИИ
// Проверяет заголовок Authorization: Bearer <token>
// Если токен валиден — кладёт данные в req.user и пропускает дальше
// Если нет — возвращает 401
// ============================================================
export function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Токен недействителен' });
    }
}

// ============================================================
// ОЧИСТКА ДАННЫХ ПОЛЬЗОВАТЕЛЯ
// Убирает служебные поля перед отправкой на фронтенд
// ============================================================
export function sanitizeUser(u) {
    if (!u) return null;
    return {
        id: u.id,
        login: u.login,
        email: u.email,
        displayName: u.displayName,
        avatar: u.avatar,
        provider: u.provider,
        balances: u.balances,
        steamId: u.steamId,
        steamTradeLink: u.steamTradeLink,
        metaMaskAddress: u.metaMaskAddress,
        clubMember: u.clubMember
    };
}
