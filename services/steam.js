import fetch from 'node-fetch';

// ============================================================
// ПОЛУЧИТЬ ИНВЕНТАРЬ ПОЛЬЗОВАТЕЛЯ
// appId 730 = CS2, contextId 2 = инвентарь игрока
// ============================================================
export async function getUserInventory(steamId, appId = 730, contextId = 2) {
    const url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=5000`;

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; GreenNoiseBot/1.0)'
        }
    });

    if (!res.ok) {
        throw new Error('Steam inventory error: ' + res.status);
    }

    const data = await res.json();

    if (!data.assets || !data.descriptions) {
        return [];
    }

    // Сопоставляем assets и descriptions через classid + instanceid
    const descMap = new Map();
    for (const d of data.descriptions) {
        descMap.set(`${d.classid}_${d.instanceid}`, d);
    }

    return data.assets.map(a => {
        const d = descMap.get(`${a.classid}_${a.instanceid}`);
        if (!d) return null;

        return {
            assetId: a.assetid,
            name: d.market_hash_name || d.name,
            marketHashName: d.market_hash_name,
            icon: d.icon_url
                ? `https://community.cloudflare.steamstatic.com/economy/image/${d.icon_url}`
                : null,
            type: d.type,
            rarity: d.type,
            tradable: d.tradable === 1,
            marketable: d.marketable === 1
        };
    }).filter(Boolean);
}

// ============================================================
// ПОЛУЧИТЬ ЦЕНУ СКИНА (Steam Market)
// currency=5 → рубли
// ============================================================
export async function getItemPrice(marketHashName, appId = 730) {
    try {
        const url = `https://steamcommunity.com/market/priceoverview/?appid=${appId}&currency=5&market_hash_name=${encodeURIComponent(marketHashName)}`;

        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; GreenNoiseBot/1.0)'
            }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.success && data.lowest_price) {
                // lowest_price вида "1 234,56 ₽" → парсим в число
                const cleaned = data.lowest_price
                    .replace(/[^\d,.]/g, '')
                    .replace(',', '.');
                const priceRub = parseFloat(cleaned);
                const priceUsd = priceRub / 92;

                return {
                    source: 'steam_market',
                    priceRub: parseFloat(priceRub.toFixed(2)),
                    priceUsd: parseFloat(priceUsd.toFixed(2)),
                    volume: data.volume || 0
                };
            }
        }
    } catch (e) {
        console.warn('[Steam price]', marketHashName, e.message);
    }

    throw new Error('Price not available');
}

// ============================================================
// ОЦЕНИТЬ МАССИВ СКИНОВ
// Пауза 250 мс между запросами — защита от rate limit Steam
// ============================================================
export async function estimateBatch(items) {
    const results = [];

    for (const item of items) {
        try {
            const price = await getItemPrice(item.marketHashName);
            results.push({ ...item, ...price, ok: true });
        } catch (e) {
            results.push({
                ...item,
                priceUsd: 0,
                priceRub: 0,
                ok: false,
                error: e.message
            });
        }

        // Пауза, чтобы Steam не забанил IP
        await new Promise(r => setTimeout(r, 250));
    }

    return results;
}
