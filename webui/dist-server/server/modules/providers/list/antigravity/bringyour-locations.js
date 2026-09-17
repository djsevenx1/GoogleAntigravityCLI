// lib/bringyour-locations.js — BringYour 代理网络国家节点实时统计
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ZH_MAP = {
    "us": "美国",
    "de": "德国",
    "ca": "加拿大",
    "vn": "越南",
    "gb": "英国",
    "nl": "荷兰",
    "fr": "法国",
    "au": "澳大利亚",
    "sg": "新加坡",
    "ru": "俄罗斯",
    "my": "马来西亚",
    "jp": "日本",
    "it": "意大利",
    "kr": "韩国",
    "in": "印度",
    "es": "西班牙",
    "fi": "芬兰",
    "hk": "中国香港",
    "ro": "罗马尼亚",
    "se": "瑞典",
    "cn": "中国大陆",
    "tr": "土耳其",
    "mx": "墨西哥",
    "ua": "乌克兰",
    "ch": "瑞士",
    "bg": "保加利亚",
    "ma": "摩洛哥",
    "br": "巴西",
    "pt": "葡萄牙",
    "pl": "波兰",
    "cz": "捷克",
    "id": "印度尼西亚",
    "hu": "匈牙利",
    "lv": "拉脱维亚",
    "ie": "爱尔兰",
    "be": "比利时",
    "za": "南非",
    "tw": "中国台湾",
    "at": "奥地利",
    "lt": "立陶宛",
    "ph": "菲律宾",
    "gr": "希腊",
    "sk": "斯洛伐克",
    "kh": "柬埔寨",
    "no": "挪威",
    "rs": "塞尔维亚",
    "hr": "克罗地亚",
    "bd": "孟加拉国",
    "ae": "阿联酋",
    "si": "斯洛文尼亚",
    "th": "泰国",
    "sa": "沙特阿拉伯",
    "ee": "爱沙尼亚",
    "iq": "伊拉克",
    "md": "摩尔多瓦",
    "cy": "塞浦路斯",
    "dk": "丹麦",
    "mo": "中国澳门",
    "mk": "北马其顿",
    "ba": "波斯尼亚和黑塞哥维那",
    "kz": "哈萨克斯坦",
    "pr": "波多黎各",
    "al": "阿尔巴尼亚",
    "ar": "阿根廷",
    "il": "以色列",
    "uy": "乌拉圭",
    "ge": "格鲁吉亚",
    "ng": "尼日利亚",
    "pe": "秘鲁",
    "lu": "卢森堡",
    "af": "阿富汗",
    "ad": "安道尔",
    "do": "多米尼加",
    "kg": "吉尔吉斯斯坦",
    "lb": "黎巴嫩",
    "ky": "开曼群岛",
    "cl": "智利",
    "cr": "哥斯达黎加",
    "nz": "新西兰",
    "uz": "乌兹别克斯坦",
    "bh": "巴林",
    "la": "老挝",
    "co": "哥伦比亚",
    "qa": "卡塔尔",
    "om": "阿曼",
    "tz": "坦桑尼亚",
    "ve": "委内瑞拉"
};
export function getFlag(code) {
    if (!code || code.length !== 2)
        return "🌐";
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
export const FALLBACK_LOCATIONS = [
    {
        "name": "United States",
        "code": "us",
        "zh": "美国",
        "flag": "🇺🇸",
        "count": 36948,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Germany",
        "code": "de",
        "zh": "德国",
        "flag": "🇩🇪",
        "count": 11537,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Canada",
        "code": "ca",
        "zh": "加拿大",
        "flag": "🇨🇦",
        "count": 3265,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Vietnam",
        "code": "vn",
        "zh": "越南",
        "flag": "🇻🇳",
        "count": 1489,
        "stable": true,
        "privacy": false
    },
    {
        "name": "United Kingdom",
        "code": "gb",
        "zh": "英国",
        "flag": "🇬🇧",
        "count": 1376,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Netherlands",
        "code": "nl",
        "zh": "荷兰",
        "flag": "🇳🇱",
        "count": 444,
        "stable": true,
        "privacy": true
    },
    {
        "name": "France",
        "code": "fr",
        "zh": "法国",
        "flag": "🇫🇷",
        "count": 344,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Australia",
        "code": "au",
        "zh": "澳大利亚",
        "flag": "🇦🇺",
        "count": 304,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Singapore",
        "code": "sg",
        "zh": "新加坡",
        "flag": "🇸🇬",
        "count": 261,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Russia",
        "code": "ru",
        "zh": "俄罗斯",
        "flag": "🇷🇺",
        "count": 214,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Malaysia",
        "code": "my",
        "zh": "马来西亚",
        "flag": "🇲🇾",
        "count": 135,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Japan",
        "code": "jp",
        "zh": "日本",
        "flag": "🇯🇵",
        "count": 122,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Italy",
        "code": "it",
        "zh": "意大利",
        "flag": "🇮🇹",
        "count": 118,
        "stable": true,
        "privacy": true
    },
    {
        "name": "South Korea",
        "code": "kr",
        "zh": "韩国",
        "flag": "🇰🇷",
        "count": 108,
        "stable": true,
        "privacy": true
    },
    {
        "name": "India",
        "code": "in",
        "zh": "印度",
        "flag": "🇮🇳",
        "count": 95,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Spain",
        "code": "es",
        "zh": "西班牙",
        "flag": "🇪🇸",
        "count": 84,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Finland",
        "code": "fi",
        "zh": "芬兰",
        "flag": "🇫🇮",
        "count": 75,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Hong Kong",
        "code": "hk",
        "zh": "中国香港",
        "flag": "🇭🇰",
        "count": 71,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Romania",
        "code": "ro",
        "zh": "罗马尼亚",
        "flag": "🇷🇴",
        "count": 60,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Sweden",
        "code": "se",
        "zh": "瑞典",
        "flag": "🇸🇪",
        "count": 49,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Mexico",
        "code": "mx",
        "zh": "墨西哥",
        "flag": "🇲🇽",
        "count": 45,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Turkey",
        "code": "tr",
        "zh": "土耳其",
        "flag": "🇹🇷",
        "count": 43,
        "stable": true,
        "privacy": false
    },
    {
        "name": "China",
        "code": "cn",
        "zh": "中国大陆",
        "flag": "🇨🇳",
        "count": 41,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Ukraine",
        "code": "ua",
        "zh": "乌克兰",
        "flag": "🇺🇦",
        "count": 38,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Switzerland",
        "code": "ch",
        "zh": "瑞士",
        "flag": "🇨🇭",
        "count": 38,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Bulgaria",
        "code": "bg",
        "zh": "保加利亚",
        "flag": "🇧🇬",
        "count": 37,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Morocco",
        "code": "ma",
        "zh": "摩洛哥",
        "flag": "🇲🇦",
        "count": 36,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Brazil",
        "code": "br",
        "zh": "巴西",
        "flag": "🇧🇷",
        "count": 36,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Portugal",
        "code": "pt",
        "zh": "葡萄牙",
        "flag": "🇵🇹",
        "count": 34,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Poland",
        "code": "pl",
        "zh": "波兰",
        "flag": "🇵🇱",
        "count": 33,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Indonesia",
        "code": "id",
        "zh": "印度尼西亚",
        "flag": "🇮🇩",
        "count": 29,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Czechia",
        "code": "cz",
        "zh": "捷克",
        "flag": "🇨🇿",
        "count": 27,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Hungary",
        "code": "hu",
        "zh": "匈牙利",
        "flag": "🇭🇺",
        "count": 25,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Latvia",
        "code": "lv",
        "zh": "拉脱维亚",
        "flag": "🇱🇻",
        "count": 22,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Ireland",
        "code": "ie",
        "zh": "爱尔兰",
        "flag": "🇮🇪",
        "count": 21,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Belgium",
        "code": "be",
        "zh": "比利时",
        "flag": "🇧🇪",
        "count": 19,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Taiwan",
        "code": "tw",
        "zh": "中国台湾",
        "flag": "🇹🇼",
        "count": 18,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Austria",
        "code": "at",
        "zh": "奥地利",
        "flag": "🇦🇹",
        "count": 18,
        "stable": true,
        "privacy": true
    },
    {
        "name": "South Africa",
        "code": "za",
        "zh": "南非",
        "flag": "🇿🇦",
        "count": 17,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Lithuania",
        "code": "lt",
        "zh": "立陶宛",
        "flag": "🇱🇹",
        "count": 13,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Philippines",
        "code": "ph",
        "zh": "菲律宾",
        "flag": "🇵🇭",
        "count": 12,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Greece",
        "code": "gr",
        "zh": "希腊",
        "flag": "🇬🇷",
        "count": 11,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Slovakia",
        "code": "sk",
        "zh": "斯洛伐克",
        "flag": "🇸🇰",
        "count": 11,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Cambodia",
        "code": "kh",
        "zh": "柬埔寨",
        "flag": "🇰🇭",
        "count": 10,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Norway",
        "code": "no",
        "zh": "挪威",
        "flag": "🇳🇴",
        "count": 8,
        "stable": true,
        "privacy": true
    },
    {
        "name": "Serbia",
        "code": "rs",
        "zh": "塞尔维亚",
        "flag": "🇷🇸",
        "count": 8,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Croatia",
        "code": "hr",
        "zh": "克罗地亚",
        "flag": "🇭🇷",
        "count": 8,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Bangladesh",
        "code": "bd",
        "zh": "孟加拉国",
        "flag": "🇧🇩",
        "count": 8,
        "stable": false,
        "privacy": false
    },
    {
        "name": "United Arab Emirates",
        "code": "ae",
        "zh": "阿联酋",
        "flag": "🇦🇪",
        "count": 8,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Slovenia",
        "code": "si",
        "zh": "斯洛文尼亚",
        "flag": "🇸🇮",
        "count": 7,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Thailand",
        "code": "th",
        "zh": "泰国",
        "flag": "🇹🇭",
        "count": 6,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Saudi Arabia",
        "code": "sa",
        "zh": "沙特阿拉伯",
        "flag": "🇸🇦",
        "count": 6,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Estonia",
        "code": "ee",
        "zh": "爱沙尼亚",
        "flag": "🇪🇪",
        "count": 6,
        "stable": false,
        "privacy": true
    },
    {
        "name": "Iraq",
        "code": "iq",
        "zh": "伊拉克",
        "flag": "🇮🇶",
        "count": 6,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Moldova",
        "code": "md",
        "zh": "摩尔多瓦",
        "flag": "🇲🇩",
        "count": 6,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Cyprus",
        "code": "cy",
        "zh": "塞浦路斯",
        "flag": "🇨🇾",
        "count": 6,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Denmark",
        "code": "dk",
        "zh": "丹麦",
        "flag": "🇩🇰",
        "count": 5,
        "stable": false,
        "privacy": true
    },
    {
        "name": "Macao",
        "code": "mo",
        "zh": "中国澳门",
        "flag": "🇲🇴",
        "count": 4,
        "stable": false,
        "privacy": false
    },
    {
        "name": "North Macedonia",
        "code": "mk",
        "zh": "北马其顿",
        "flag": "🇲🇰",
        "count": 4,
        "stable": true,
        "privacy": false
    },
    {
        "name": "Bosnia and Herzegovina",
        "code": "ba",
        "zh": "波斯尼亚和黑塞哥维那",
        "flag": "🇧🇦",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Kazakhstan",
        "code": "kz",
        "zh": "哈萨克斯坦",
        "flag": "🇰🇿",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Puerto Rico",
        "code": "pr",
        "zh": "波多黎各",
        "flag": "🇵🇷",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Albania",
        "code": "al",
        "zh": "阿尔巴尼亚",
        "flag": "🇦🇱",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Argentina",
        "code": "ar",
        "zh": "阿根廷",
        "flag": "🇦🇷",
        "count": 3,
        "stable": false,
        "privacy": true
    },
    {
        "name": "Israel",
        "code": "il",
        "zh": "以色列",
        "flag": "🇮🇱",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Uruguay",
        "code": "uy",
        "zh": "乌拉圭",
        "flag": "🇺🇾",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Georgia",
        "code": "ge",
        "zh": "格鲁吉亚",
        "flag": "🇬🇪",
        "count": 3,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Nigeria",
        "code": "ng",
        "zh": "尼日利亚",
        "flag": "🇳🇬",
        "count": 2,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Peru",
        "code": "pe",
        "zh": "秘鲁",
        "flag": "🇵🇪",
        "count": 2,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Luxembourg",
        "code": "lu",
        "zh": "卢森堡",
        "flag": "🇱🇺",
        "count": 1,
        "stable": false,
        "privacy": true
    },
    {
        "name": "Afghanistan",
        "code": "af",
        "zh": "阿富汗",
        "flag": "🇦🇫",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Andorra",
        "code": "ad",
        "zh": "安道尔",
        "flag": "🇦🇩",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Dominican Republic",
        "code": "do",
        "zh": "多米尼加",
        "flag": "🇩🇴",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Kyrgyzstan",
        "code": "kg",
        "zh": "吉尔吉斯斯坦",
        "flag": "🇰🇬",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Lebanon",
        "code": "lb",
        "zh": "黎巴嫩",
        "flag": "🇱🇧",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Cayman Islands",
        "code": "ky",
        "zh": "开曼群岛",
        "flag": "🇰🇾",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Chile",
        "code": "cl",
        "zh": "智利",
        "flag": "🇨🇱",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Costa Rica",
        "code": "cr",
        "zh": "哥斯达黎加",
        "flag": "🇨🇷",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "New Zealand",
        "code": "nz",
        "zh": "新西兰",
        "flag": "🇳🇿",
        "count": 1,
        "stable": false,
        "privacy": true
    },
    {
        "name": "Uzbekistan",
        "code": "uz",
        "zh": "乌兹别克斯坦",
        "flag": "🇺🇿",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Bahrain",
        "code": "bh",
        "zh": "巴林",
        "flag": "🇧🇭",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Laos",
        "code": "la",
        "zh": "老挝",
        "flag": "🇱🇦",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Colombia",
        "code": "co",
        "zh": "哥伦比亚",
        "flag": "🇨🇴",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Qatar",
        "code": "qa",
        "zh": "卡塔尔",
        "flag": "🇶🇦",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Oman",
        "code": "om",
        "zh": "阿曼",
        "flag": "🇴🇲",
        "count": 1,
        "stable": false,
        "privacy": false
    },
    {
        "name": "Venezuela",
        "code": "ve",
        "zh": "委内瑞拉",
        "flag": "🇻🇪",
        "count": 1,
        "stable": false,
        "privacy": false
    }
];
let cache = {
    data: FALLBACK_LOCATIONS,
    timestamp: Date.now()
};
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 分钟缓存
export async function fetchBringYourLocations() {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp < CACHE_TTL_MS)) {
        return cache.data;
    }
    return new Promise((resolve) => {
        const req = https.get("https://api.bringyour.com/network/provider-locations", { timeout: 4000 }, (res) => {
            if (res.statusCode !== 200) {
                return resolve(cache.data || FALLBACK_LOCATIONS);
            }
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try {
                    const json = JSON.parse(body);
                    if (!Array.isArray(json.locations))
                        return resolve(cache.data || FALLBACK_LOCATIONS);
                    const list = json.locations.map((l) => {
                        const code = (l.country_code || "").toLowerCase();
                        return {
                            name: l.name,
                            code: code,
                            zh: ZH_MAP[code] || l.name,
                            flag: getFlag(code),
                            count: l.provider_count || 0,
                            stable: !!l.stable,
                            privacy: !!l.strong_privacy
                        };
                    }).sort((a, b) => b.count - a.count);
                    cache = { data: list, timestamp: Date.now() };
                    resolve(list);
                }
                catch (_) {
                    resolve(cache.data || FALLBACK_LOCATIONS);
                }
            });
        });
        req.on("error", () => resolve(cache.data || FALLBACK_LOCATIONS));
        req.on("timeout", () => {
            req.destroy();
            resolve(cache.data || FALLBACK_LOCATIONS);
        });
    });
}
import { execFileSync } from "node:child_process";
export function getLatestSocksLogCount() {
    try {
        const logPath = path.join(__dirname, "..", "urnetwork", "socks.log");
        if (!fs.existsSync(logPath))
            return null;
        const out = execFileSync("grep", ["-a", "country matched", logPath], { encoding: "utf8" });
        const lines = out.trim().split("\n").filter(Boolean);
        if (lines.length > 0) {
            const last = lines[lines.length - 1];
            const m = last.match(/country matched "([^"]+)", provider count (\d+)/);
            if (m) {
                return { country: m[1], count: parseInt(m[2], 10) };
            }
        }
    }
    catch (_) { }
    return null;
}
export default {
    ZH_MAP,
    getFlag,
    FALLBACK_LOCATIONS,
    fetchBringYourLocations,
    getLatestSocksLogCount
};
//# sourceMappingURL=bringyour-locations.js.map