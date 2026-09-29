--- /mnt/data/core_original.js	2026-09-29 07:42:56.758793155 +0000
+++ /mnt/data/core_fixed.js	2026-09-29 07:47:42.689705942 +0000
@@ -355,46 +355,81 @@
 }
 
 function extractWindowJson(html, varName) {
-    if (!html) return null;
+    if (!html || !varName) return null;
 
-    // 不再强制要求 window. 前缀
-    const idx = html.indexOf(varName);
-    if (idx === -1) return null;
+    const escapedName = String(varName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
+    const patterns = [
+        new RegExp(`window\\.${escapedName}\\s*=\\s*`, 'g'),
+        new RegExp(`(?:^|[;\\s])${escapedName}\\s*=\\s*`, 'gm')
+    ];
 
-    const eq = html.indexOf('=', idx);
-    if (eq === -1) return null;
+    for (const re of patterns) {
+        let m;
+        while ((m = re.exec(html)) !== null) {
+            let pos = m.index + m[0].length;
+            while (pos < html.length && /\\s/.test(html[pos])) pos++;
+            if (pos >= html.length) continue;
+
+            // window._ROUTER_DATA = {...} / [...]
+            if (html[pos] === '{' || html[pos] === '[') {
+                const raw = extractBalancedJson(html, pos);
+                const parsed = raw ? safeJsonParse(raw) : null;
+                if (parsed) return parsed;
+            }
 
-    let pos = eq + 1;
+            // window._ROUTER_DATA = "{\\\"...\\\"}"
+            if (html[pos] === '"') {
+                const literal = extractQuotedJsonLiteral(html, pos);
+                if (literal) {
+                    const inner = safeJsonParse(literal);
+                    if (inner && typeof inner === 'object') return inner;
+                    if (typeof inner === 'string') {
+                        const parsed = safeJsonParse(inner);
+                        if (parsed) return parsed;
+                    }
+                }
+            }
 
-    while (pos < html.length && /\s/.test(html[pos])) {
-        pos++;
+            // window._ROUTER_DATA = JSON.parse("...")
+            if (html.startsWith('JSON.parse', pos)) {
+                const open = html.indexOf('(', pos + 10);
+                if (open >= 0) {
+                    let q = open + 1;
+                    while (q < html.length && /\\s/.test(html[q])) q++;
+                    if (html[q] === '"') {
+                        const literal = extractQuotedJsonLiteral(html, q);
+                        const inner = literal ? safeJsonParse(literal) : null;
+                        if (typeof inner === 'string') {
+                            const parsed = safeJsonParse(inner);
+                            if (parsed) return parsed;
+                        }
+                    }
+                }
+            }
+        }
     }
 
-    if (pos >= html.length) return null;
-
-    // 格式1：
-    // window._ROUTER_DATA = {...}
-    if (html[pos] === '{') {
-        const raw = extractBalancedJson(html, pos);
-        return raw ? safeJsonParse(raw) : null;
-    }
+    return null;
+}
 
-    // 格式2：
-    // window._ROUTER_DATA = "{\"xxx\":...}"
-    if (html[pos] === '"') {
-        const literal = extractQuotedJsonLiteral(html, pos);
-        if (!literal) return null;
+function extractScriptJson(html, id) {
+    if (!html || !id) return null;
+    const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
+    const re = new RegExp(`<script[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
+    const m = html.match(re);
+    if (!m) return null;
 
-        const inner = safeJsonParse(literal);
+    let raw = (m[1] || '').trim();
+    if (!raw) return null;
 
-        if (typeof inner !== 'string') {
-            return null;
-        }
-
-        return safeJsonParse(inner);
-    }
+    // 抖音部分页面的 RENDER_DATA 是 URI 编码 JSON
+    try {
+        const decoded = decodeURIComponent(raw);
+        const parsed = safeJsonParse(decoded);
+        if (parsed) return parsed;
+    } catch (e) {}
 
-    return null;
+    return safeJsonParse(raw);
 }
 
 function decodeUrl(u) {
@@ -684,161 +719,203 @@
 
 // ========== 核心解析 ==========
 
+function pickMediaUrl(value, depth = 0) {
+    if (depth > 4 || value == null) return '';
+
+    if (typeof value === 'string') {
+        const u = decodeUrl(value).trim();
+        return /^https?:\/\//i.test(u) ? u : '';
+    }
+
+    if (Array.isArray(value)) {
+        for (const v of value) {
+            const u = pickMediaUrl(v, depth + 1);
+            if (u) return u;
+        }
+        return '';
+    }
+
+    if (typeof value !== 'object') return '';
+
+    const priorityKeys = [
+        'url_list', 'urlList', 'download_url_list', 'downloadUrlList',
+        'download_url', 'downloadUrl', 'download_addr', 'downloadAddr',
+        'display_image', 'displayImage', 'origin_image', 'originImage',
+        'play_addr', 'playAddr', 'play_addr_h264', 'playAddrH264',
+        'uri', 'url'
+    ];
+
+    for (const key of priorityKeys) {
+        if (value[key] != null) {
+            const u = pickMediaUrl(value[key], depth + 1);
+            if (u) return u;
+        }
+    }
+
+    return '';
+}
+
+function getImageArray(item) {
+    if (!item || typeof item !== 'object') return [];
+    const candidates = [
+        item.images,
+        item.image_list,
+        item.imageList,
+        item.image_post_info?.images,
+        item.image_post_info?.image_list,
+        item.image_post_info?.imageList,
+        item.imagePostInfo?.images,
+        item.imagePostInfo?.image_list,
+        item.imagePostInfo?.imageList,
+        item.photo_list,
+        item.photoList,
+        item.pictures,
+        item.slides
+    ];
+    return candidates.find(v => Array.isArray(v) && v.length) || [];
+}
+
 function extractFromApiItem(item) {
     const r = { title: '', author: '', cover: '', playUrl: '', images: [] };
-    if (!item) return r;
-    r.title = item.desc || item.share_info?.share_title || '';
-    r.author = item.author?.nickname || item.author?.unique_id || '';
-    if (item.video) {
-        if (item.video.cover?.url_list?.[0]) r.cover = item.video.cover.url_list[0];
-        if (!r.cover && item.video.dynamic_cover?.url_list?.[0]) r.cover = item.video.dynamic_cover.url_list[0];
+    if (!item || typeof item !== 'object') return r;
+
+    r.title = item.desc || item.title || item.share_info?.share_title || item.shareInfo?.shareTitle || '';
+    r.author = item.author?.nickname || item.author?.unique_id || item.author?.uniqueId || item.nickname || '';
+
+    const video = item.video || item.video_info || item.videoInfo;
+    if (video && typeof video === 'object') {
+        r.cover = pickMediaUrl(video.cover) || pickMediaUrl(video.dynamic_cover) || pickMediaUrl(video.dynamicCover) || '';
+
         const candidates = [
-            item.video.play_addr?.url_list,
-            item.video.download_addr?.url_list,
-            item.video.play_addr_h264?.url_list,
-            item.video.bit_rate?.[0]?.play_addr?.url_list
+            video.play_addr,
+            video.playAddr,
+            video.download_addr,
+            video.downloadAddr,
+            video.play_addr_h264,
+            video.playAddrH264,
+            video.bit_rate?.[0]?.play_addr,
+            video.bitRate?.[0]?.playAddr
         ];
-        for (const arr of candidates) {
-            if (Array.isArray(arr) && arr.length) {
-                r.playUrl = (arr[0] || '').toString().replace(/playwm/g, 'play');
-                if (r.playUrl.startsWith('http')) break;
+        for (const candidate of candidates) {
+            const u = pickMediaUrl(candidate).replace(/playwm/g, 'play');
+            if (u) {
+                r.playUrl = u;
+                break;
             }
         }
     }
-   const imgs =
-    item.images ||
-    item.image_list ||
-    item.image_post_info?.images ||
-    item.image_post_info?.image_list ||
-    [];
-    if (Array.isArray(imgs) && imgs.length) {
-       r.images = imgs.map(i => {
-    const url =
-        i?.download_url?.url_list?.[0] ||
-        i?.download_addr?.url_list?.[0] ||
-        i?.download_url_list?.[0] ||
-        i?.url_list?.[0] ||
-        i?.display_image?.url_list?.[0] ||
-        i?.origin_image?.url_list?.[0] ||
-        i?.url ||
-        (typeof i === 'string' ? i : '');
-
-    return {
-        url: String(url || ''),
-        width: Number(i?.width || 0),
-        height: Number(i?.height || 0),
-        uri: i?.uri || ''
-    };
-}).filter(x => x.url && x.url.startsWith('http'));
-        if (r.images.length) r.playUrl = '';
+
+    const imgs = getImageArray(item);
+    if (imgs.length) {
+        const seen = new Set();
+        r.images = imgs.map(i => {
+            const url = pickMediaUrl(i);
+            return {
+                url,
+                width: Number(i?.width || i?.width_px || i?.widthPx || 0),
+                height: Number(i?.height || i?.height_px || i?.heightPx || 0),
+                uri: i?.uri || i?.image_uri || i?.imageUri || ''
+            };
+        }).filter(x => {
+            if (!x.url || !/^https?:\/\//i.test(x.url) || seen.has(x.url)) return false;
+            seen.add(x.url);
+            return true;
+        });
+
+        if (r.images.length) {
+            r.playUrl = '';
+            if (!r.cover) r.cover = r.images[0].url;
+        }
     }
+
     return r;
 }
 
 function parseFromEmbeddedData(html) {
     const result = { title: '', author: '', cover: '', playUrl: '', images: [] };
-   const rd = extractWindowJson(html, '_ROUTER_DATA');
+    if (!html) return result;
 
-if (!rd) {
-    if (typeof console !== 'undefined' && console.warn) {
-    console.warn(
-    '[策略A] ROUTER_DATA失败',
-    'html长度=' + (html ? html.length : 0),
-    'hasRouter=' + (html ? html.includes('_ROUTER_DATA') : false),
-    'hasRender=' + (html ? html.includes('RENDER_DATA') : false)
-);
-    }
-    return result;
-}
-   function findMedia(node, depth = 0) {
-    if (depth > 25 || !node) return null;
+    const roots = [];
+    const router = extractWindowJson(html, '_ROUTER_DATA');
+    if (router) roots.push({ name: '_ROUTER_DATA', data: router });
 
-    if (Array.isArray(node)) {
-        for (const v of node) {
-            const hit = findMedia(v, depth + 1);
-            if (hit) return hit;
-        }
-        return null;
-    }
+    const renderData = extractScriptJson(html, 'RENDER_DATA');
+    if (renderData) roots.push({ name: 'RENDER_DATA', data: renderData });
 
-    if (typeof node !== 'object') return null;
+    const nextData = extractScriptJson(html, '__NEXT_DATA__');
+    if (nextData) roots.push({ name: '__NEXT_DATA__', data: nextData });
 
-    // 优先检查抖音常见的作品容器
-    const priorityKeys = [
-        'item_list',
-        'aweme_list',
-        'aweme_detail',
-        'aweme',
-        'videoInfoRes',
-        'noteInfoRes'
-    ];
+    function findMedia(node, depth = 0, seen = new Set()) {
+        if (depth > 28 || node == null) return null;
 
-    for (const key of priorityKeys) {
-        if (node[key]) {
-            const hit = findMedia(node[key], depth + 1);
+        if (typeof node !== 'object') return null;
+        if (seen.has(node)) return null;
+        seen.add(node);
+
+        const extracted = extractFromApiItem(node);
+        if (extracted.playUrl || extracted.images.length) return node;
+
+        const priorityKeys = [
+            'aweme_detail', 'awemeDetail', 'aweme_list', 'awemeList',
+            'item_list', 'itemList', 'aweme', 'item',
+            'videoInfoRes', 'noteInfoRes', 'itemStruct', 'itemDetail',
+            'data', 'detail'
+        ];
+
+        for (const key of priorityKeys) {
+            if (node[key] != null) {
+                const hit = findMedia(node[key], depth + 1, seen);
+                if (hit) return hit;
+            }
+        }
+
+        if (Array.isArray(node)) {
+            for (const v of node) {
+                const hit = findMedia(v, depth + 1, seen);
+                if (hit) return hit;
+            }
+            return null;
+        }
+
+        for (const value of Object.values(node)) {
+            const hit = findMedia(value, depth + 1, seen);
             if (hit) return hit;
         }
-    }
 
-    const imgs =
-        node.images ||
-        node.image_list ||
-        node.image_post_info?.images ||
-        node.image_post_info?.image_list ||
-        [];
-
-    const hasImages = Array.isArray(imgs) && imgs.length > 0;
-
-    const hasVideo = Boolean(
-        node.video?.play_addr?.url_list?.length ||
-        node.video?.download_addr?.url_list?.length ||
-        node.video?.play_addr_h264?.url_list?.length
-    );
-
-    const awemeType = Number(node.aweme_type || 0);
-    const isGalleryType = [2, 68, 150].includes(awemeType);
-
-    if (
-        hasVideo ||
-        hasImages ||
-        (isGalleryType && (node.aweme_id || node.desc))
-    ) {
-        return node;
-    }
-
-    for (const value of Object.values(node)) {
-        const hit = findMedia(value, depth + 1);
-        if (hit) return hit;
+        return null;
     }
 
-    return null;
-}
-    
-  const hit = findMedia(rd);
-if (hit && typeof console !== 'undefined' && console.log) {
-    console.log(
-        '[策略A] 命中作品',
-        'aweme_type=' + (hit.aweme_type ?? ''),
-        'keys=' + Object.keys(hit).slice(0, 30).join(',')
-    );
-}
-if (hit) {
-    Object.assign(result, extractFromApiItem(hit));
-
-    if (typeof console !== 'undefined' && console.log) {
-        console.log(
-            '[策略A] 找到作品对象',
-            'images=' + result.images.length,
-            'video=' + Boolean(result.playUrl)
-        );
+    for (const root of roots) {
+        const hit = findMedia(root.data);
+        if (hit) {
+            const extracted = extractFromApiItem(hit);
+            if (extracted.playUrl || extracted.images.length) {
+                Object.assign(result, extracted);
+                if (typeof console !== 'undefined' && console.log) {
+                    console.log(
+                        '[策略A] 嵌入数据命中',
+                        'source=' + root.name,
+                        'images=' + result.images.length,
+                        'video=' + Boolean(result.playUrl),
+                        'keys=' + Object.keys(hit).slice(0, 24).join(',')
+                    );
+                }
+                return result;
+            }
+        }
     }
-} else {
+
     if (typeof console !== 'undefined' && console.warn) {
-        console.warn('[策略A] ROUTER_DATA存在，但没有找到媒体对象');
+        console.warn(
+            '[策略A] 嵌入数据未命中',
+            'html长度=' + html.length,
+            'hasRouter=' + html.includes('_ROUTER_DATA'),
+            'hasRender=' + html.includes('RENDER_DATA'),
+            'hasNext=' + html.includes('__NEXT_DATA__')
+        );
     }
-}
 
-return result;
+    return result;
 }
 
 function parseMetaInfo(html) {
@@ -857,8 +934,10 @@
     return r;
 }
 
-async function fetchApiWithCookie(itemId, cookieStr) {
-    const shareRef = `https://www.iesdouyin.com/share/video/${itemId}`;
+async function fetchApiWithCookie(itemId, cookieStr, contentType = 'video') {
+    const shareRef = contentType === 'image'
+        ? `https://www.iesdouyin.com/share/note/${itemId}`
+        : `https://www.iesdouyin.com/share/video/${itemId}`;
     // 只尝试 2 个端点（成功率最高的组合），避免串行叠加耗时
     const endpoints = [
         'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=' + itemId,
@@ -966,9 +1045,11 @@
     return '';
 }
 
-async function fetchApiWithTtwid(itemId, ttwid) {
+async function fetchApiWithTtwid(itemId, ttwid, contentType = 'video') {
     if (!ttwid) return null;
-    const referer = 'https://www.douyin.com/video/' + itemId;
+    const referer = contentType === 'image'
+        ? 'https://www.douyin.com/note/' + itemId
+        : 'https://www.douyin.com/video/' + itemId;
     const cookie = 'ttwid=' + ttwid;
 
     // 注意：只用 www.douyin.com/aweme/v1/web/aweme/detail，其他（如 iesdouyin iteminfo）
@@ -1019,136 +1100,126 @@
 async function performParse(rawUrl) {
     const cleanUrl = extractDouyinUrl(String(rawUrl || ''));
     if (!cleanUrl.startsWith('http')) throw new Error('无法识别有效链接');
+
     if (typeof console !== 'undefined' && console.log) {
         console.log('[解析] URL:', cleanUrl);
     }
 
     let itemId = extractItemId(cleanUrl);
-let contentType = 'video';
-
-if (!itemId) {
-    const step1 = await nativeRequest(cleanUrl, { timeoutMs: 6000 })
-        .catch(() => ({ body: '', finalUrl: '' }));
+    let contentType = /\/(?:note|slides)\//i.test(cleanUrl) ? 'image' : 'video';
 
-    const finalUrl = step1.finalUrl || '';
-    const probe = `${finalUrl}\n${step1.body || ''}`;
+    // 短链先跟随重定向，优先从最终 URL 取 ID 与内容类型。
+    if (!itemId || /v\.douyin\.com/i.test(cleanUrl)) {
+        const step1 = await nativeRequest(cleanUrl, { timeoutMs: 7000 })
+            .catch(() => ({ body: '', finalUrl: '' }));
 
-    itemId =
-        extractItemId(finalUrl) ||
-        extractItemId(step1.body || '');
+        const finalUrl = step1.finalUrl || '';
+        const probe = `${finalUrl}\\n${step1.body || ''}`;
 
-    if (/\/slides\//i.test(probe) || /\/note\//i.test(probe)) {
-        contentType = 'image';
+        itemId = itemId || extractItemId(finalUrl) || extractItemId(step1.body || '');
+        if (/\/(?:note|slides)\//i.test(probe)) contentType = 'image';
+        else if (/\/video\//i.test(finalUrl)) contentType = 'video';
     }
-}
 
-if (!itemId) {
-    throw new Error('无法提取内容ID，请确认链接正确');
-}
-
-if (typeof console !== 'undefined' && console.log) {
-    console.log(`[解析] itemId: ${itemId}, type: ${contentType}`);
-}
-
-const shareUrls = contentType === 'image'
-    ? [
-        `https://www.iesdouyin.com/share/slides/${itemId}/`,
-        `https://www.iesdouyin.com/share/video/${itemId}/`,
-        `https://www.iesdouyin.com/share/note/${itemId}/`
-      ]
-    : [
-        `https://www.iesdouyin.com/share/video/${itemId}/`
-      ];
-
-let workingCookie = '';
-let result = { title: '', author: '', cover: '', playUrl: '', images: [] };
-let sourceUsed = '';
-
-for (const shareUrl of shareUrls) {
-    try {
-        if (typeof console !== 'undefined' && console.log) {
-            console.log('[策略A] 尝试:', shareUrl);
-        }
+    if (!itemId) throw new Error('无法提取内容ID，请确认链接正确');
 
-        const htmlResp = await nativeRequest(shareUrl, { timeoutMs: 8000 });
+    if (typeof console !== 'undefined' && console.log) {
+        console.log(`[解析] itemId: ${itemId}, type: ${contentType}`);
+    }
 
-        const cookie = getCookiesFromHeaders(htmlResp.headers);
-        if (cookie) workingCookie = cookie;
+    let workingCookie = '';
+    let result = { title: '', author: '', cover: '', playUrl: '', images: [] };
+    let sourceUsed = '';
+
+    // 策略A：视频保持原项目的稳定路径；图文额外尝试 note / slides / video。
+    const shareUrls = contentType === 'image'
+        ? [
+            `https://www.iesdouyin.com/share/note/${itemId}/`,
+            `https://www.iesdouyin.com/share/slides/${itemId}/`,
+            `https://www.iesdouyin.com/share/video/${itemId}/`
+          ]
+        : [
+            `https://www.iesdouyin.com/share/video/${itemId}/`
+          ];
 
-        const meta = parseMetaInfo(htmlResp.body);
-        if (meta.title && !result.title) result.title = meta.title;
-        if (meta.image && !result.cover) result.cover = meta.image;
-        if (meta.videoUrl && !result.playUrl) result.playUrl = meta.videoUrl;
+    for (const shareUrl of shareUrls) {
+        try {
+            if (typeof console !== 'undefined' && console.log) {
+                console.log('[策略A] 尝试:', shareUrl);
+            }
 
-        const embedded = parseFromEmbeddedData(htmlResp.body);
+            const htmlResp = await nativeRequest(shareUrl, { timeoutMs: 8000 });
+            const cookie = getCookiesFromHeaders(htmlResp.headers);
+            if (cookie) workingCookie = mergeCookies(workingCookie, cookie);
+
+            const meta = parseMetaInfo(htmlResp.body);
+            if (meta.title && !result.title) result.title = meta.title;
+            if (meta.image && !result.cover) result.cover = meta.image;
+            // 图文页面不要被 og:video 之类的兜底字段误判成视频。
+            if (contentType === 'video' && meta.videoUrl && !result.playUrl) {
+                result.playUrl = meta.videoUrl;
+            }
 
-        if (embedded.playUrl || embedded.images.length) {
-            Object.assign(result, embedded);
-            sourceUsed = 'embedded';
+            const embedded = parseFromEmbeddedData(htmlResp.body);
+            if (embedded.playUrl || embedded.images.length) {
+                if (embedded.title) result.title = embedded.title;
+                if (embedded.author) result.author = embedded.author;
+                if (embedded.cover) result.cover = embedded.cover;
+                result.playUrl = embedded.playUrl || '';
+                result.images = embedded.images || [];
+                sourceUsed = 'embedded';
 
-            if (typeof console !== 'undefined' && console.log) {
-                console.log(
-                    `[策略A] 成功: ${shareUrl}, images=${embedded.images.length}`
-                );
+                if (typeof console !== 'undefined' && console.log) {
+                    console.log('[策略A] 成功:', shareUrl, 'images=' + result.images.length, 'video=' + Boolean(result.playUrl));
+                }
+                break;
+            }
+        } catch (e) {
+            if (typeof console !== 'undefined' && console.warn) {
+                console.warn('[策略A] 地址失败:', shareUrl, e.message);
             }
-
-            break;
-        }
-    } catch (e) {
-        if (typeof console !== 'undefined' && console.warn) {
-            console.warn('[策略A] 地址失败:', shareUrl, e.message);
         }
     }
-}
-    
-        if (!result.playUrl && result.images.length === 0 && workingCookie) {
+
+    // 策略B：官方 API。先带 share 页 Cookie；失败时再裸调一次。
+    if (!result.playUrl && result.images.length === 0) {
         if (typeof console !== 'undefined' && console.log) console.log('[策略B] 调用官方 API...');
-        const apiRes = await fetchApiWithCookie(itemId, workingCookie);
-        if (apiRes && (apiRes.playUrl || apiRes.images.length)) {
-            result.title = apiRes.title || result.title;
-            result.author = apiRes.author || result.author;
-            result.cover = apiRes.cover || result.cover;
-            result.playUrl = apiRes.playUrl;
-            result.images = apiRes.images;
-            sourceUsed = 'api';
-               
 
-        if (typeof console !== 'undefined' && console.log) {
-            console.log('[策略B] API 成功');
+        let apiRes = await fetchApiWithCookie(itemId, workingCookie || '', contentType);
+        if (!apiRes && workingCookie) {
+            apiRes = await fetchApiWithCookie(itemId, '', contentType);
         }
-    }
-} else if (!result.playUrl && result.images.length === 0) {
-        const apiRes = await fetchApiWithCookie(itemId, '');
+
         if (apiRes && (apiRes.playUrl || apiRes.images.length)) {
-            result.playUrl = apiRes.playUrl;
-            result.images = apiRes.images;
             result.title = apiRes.title || result.title;
             result.author = apiRes.author || result.author;
             result.cover = apiRes.cover || result.cover;
-            sourceUsed = 'api-nocookie';
+            result.playUrl = apiRes.playUrl || '';
+            result.images = apiRes.images || [];
+            sourceUsed = workingCookie ? 'api' : 'api-nocookie';
+            if (typeof console !== 'undefined' && console.log) console.log('[策略B] API 成功');
         }
     }
 
     // 策略C：主动申请 ttwid → aweme/v1/web/aweme/detail
-    // （抖音已从 share 页响应中移除 Set-Cookie，导致 workingCookie 可能为空，前两策略失效）
     if (!result.playUrl && result.images.length === 0) {
         if (typeof console !== 'undefined' && console.log) console.log('[策略C] 申请 ttwid 并调用 aweme web API...');
         try {
             const ttwid = await fetchTtwid();
             if (ttwid) {
                 if (typeof console !== 'undefined' && console.log) console.log('[策略C] ttwid 已获取 (len=' + ttwid.length + ')');
-                const apiRes = await fetchApiWithTtwid(itemId, ttwid);
+                const apiRes = await fetchApiWithTtwid(itemId, ttwid, contentType);
                 if (apiRes && (apiRes.playUrl || apiRes.images.length)) {
                     result.title = apiRes.title || result.title;
                     result.author = apiRes.author || result.author;
                     result.cover = apiRes.cover || result.cover;
-                    result.playUrl = apiRes.playUrl;
-                    result.images = apiRes.images;
+                    result.playUrl = apiRes.playUrl || '';
+                    result.images = apiRes.images || [];
                     sourceUsed = 'ttwid-api';
                     if (typeof console !== 'undefined' && console.log) console.log('[策略C] ttwid API 成功');
                 }
-            } else {
-                if (typeof console !== 'undefined' && console.warn) console.warn('[策略C] 未获取到 ttwid');
+            } else if (typeof console !== 'undefined' && console.warn) {
+                console.warn('[策略C] 未获取到 ttwid');
             }
         } catch (e) {
             if (typeof console !== 'undefined' && console.warn) console.warn('[策略C] 异常:', e.message);
