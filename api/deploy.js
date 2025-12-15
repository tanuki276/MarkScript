// api/deploy.js (Node.js / Vercel Functions / Netlify Functions向け)

// npm install @octokit/rest url
const { Octokit } = require('@octokit/rest'); 
const { URL } = require('url'); 

// --- 設定/環境変数 ---
// Vercel環境変数: GITHUB_TOKEN
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
// ユーザー自身の情報に書き換えること
const REPO_OWNER = 'tanuki276'; 
const REPO_NAME = 'MarkScript'; 
// 実際にデプロイされたドメインに変更すること
const PUBLISHED_DOMAIN = 'https://mark-script.vercel.app'; 
const BRANCH = 'main'; 

// フロントエンドと完全に同期させたCOLOR_MAP
const COLOR_MAP = {
    '赤': 'red',
    '青': 'blue',
    '緑': 'green',
    '黄': 'yellow',
    '黒': 'black',
    '白': 'white',
    '灰': 'gray', 
    '紫': 'purple',
    'オレンジ': 'orange',
};

if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKENが環境変数に設定されていません。");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- ユーティリティ ---

// 厳密なHTMLエスケープ関数
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[&<>"']/g, function(match) {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}

function validateAndNormalizeUrl(raw) {
    try {
        const cleaned = raw.trim();
        // 制御文字や不正な文字をチェック
        if (/\s/.test(cleaned) || /[<>"'`\r\n\t]/.test(cleaned)) return null; 

        const url = new URL(cleaned); 
        const allowedProtocols = ['http:', 'https:'];

        if (!allowedProtocols.includes(url.protocol)) return null; 
        if (url.username || url.password || url.port) return null;
        if (url.href.length > 2048) return null; 
        if (url.pathname.includes('..')) return null;

        return url.href;
    } catch (e) {
        return null;
    }
}

function normalizeColor(input) {
    if (!input) return null;
    const lower = input.toLowerCase();

    if (COLOR_MAP[input]) {
        return COLOR_MAP[input];
    }
    // HEX, RGB/RGBA/HSL/HSLA, 標準色名に対応
    if (/^#([0-9A-F]{3}){1,2}$/i.test(input) || 
        /^rgba?\((.+?)\)$/i.test(lower) || 
        /^hsla?\((.+?)\)$/i.test(lower) || 
        /^[a-z]+$/.test(lower)) {
        return input;
    }
    return null;
}

// MarkScriptパーサーのためのヘルパー関数（インライン機能修正版をサーバーサイド向けに調整）
function parseLineForInlines(text) {
    // 最初にすべての < と > を一時的な記号に置き換え、生のHTMLタグをすべて無害化する
    let result = text.replace(/</g, '__LT__').replace(/>/g, '__GT__');
    
    // 1. コード (インラインコード `...`) の処理
    result = result.replace(/`([^`]+)`/g, (match, content) => {
        // エスケープ記号をHTMLエンティティ(&lt; &gt;)に戻し、コードタグを生成
        const safeContent = content.replace(/__LT__/g, '&lt;').replace(/__GT__/g, '&gt;');
        return `<code>${safeContent}</code>`;
    });

    // 2. 埋め (リンク) の処理
    result = result.replace(/埋め\s+(https?:\/\/[^\s]+)(?:\s+(.*?))?(?=(?:\s*埋め|\s*色付|\s*枠文字|\s*$|`))/g, (match, url, linkText) => {
        const safeUrl = validateAndNormalizeUrl(url);
        // リンクテキストもエスケープされた記号をHTMLエンティティに戻す
        const display = (linkText || url || '').trim().replace(/__LT__/g, '&lt;').replace(/__GT__/g, '&gt;');

        if (safeUrl) {
            return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${display}</a>`;
        }
        return `[無効なURL: ${escapeHtml(url)}]`; 
    });

    // 3. 色付 / 枠文字 の処理
    const inlineRegex = /(色付|枠文字)\s*\(([^)]+)\)\s*(.*?)(?=(?:色付|枠文字|埋め|\s*$|`))/g;

    result = result.replace(inlineRegex, (match, type, rawColor, content) => {
        const color = normalizeColor(rawColor.trim());
        // コンテンツもエスケープされた記号をHTMLエンティティに戻す
        const contentTrimmed = content.trim().replace(/__LT__/g, '&lt;').replace(/__GT__/g, '&gt;');

        if (!color) return `[無効な色: ${escapeHtml(rawColor)}]`; 

        const isBorder = (type === '枠文字');
        let style = '';
        let className = '';

        if (isBorder) {
            className = 'bordered-text';
            style = `border-color: ${color}; color: ${color};`;
        } else {
            className = 'colored-text';
            style = `color: ${color};`;
        }

        return `<span class="${className}" style="${style}">${contentTrimmed}</span>`;
    });

    // 4. 最後に、ディレクティブによってHTMLタグに変換されなかった部分に残ったエスケープ記号をHTMLエンティティに戻す。
    //    これで、生の < や > はすべて &lt; &gt; になり、XSSを防ぐ。
    result = result.replace(/__LT__/g, '&lt;').replace(/__GT__/g, '&gt;');

    return result; 
}
// --- MarkScriptパーサー（全体） ---

function parseMarkScriptToHtmlFragment(text) {
    const lines = text.split(/\r?\n/).slice(0, 2000); 
    let htmlFragment = '';
    const MAX_LINE_CHARS = 2000;
    let globalBgColor = null; 

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line == null) line = '';
        if (line.length > MAX_LINE_CHARS) {
            line = line.slice(0, MAX_LINE_CHARS) + '…';
        }

        // --- MarkScript パース ---

        // 1. 背景 (BG色は最初に検出されたもののみを採用)
        if (i === 0 && line.startsWith('背景 ')) {
             const color = line.slice(3).trim().split(/\s+/)[0];
             const validColor = normalizeColor(color);
             if (validColor) {
                 globalBgColor = validColor;
             }
             continue; 
        }

        // 2. タイトル
        if (line.startsWith('タイトル ')) {
            const textPart = escapeHtml(line.slice(4).trim());
            htmlFragment += `<h1>${textPart}</h1>\n`;
            continue;
        }

        // 3. 大
        if (line.startsWith('大 ')) {
            const textPart = escapeHtml(line.slice(2).trim());
            htmlFragment += `<h3>${textPart}</h3>\n`;
            continue;
        }

        // 4. 小 (文字を小さくする)
        if (line.startsWith('小 ')) {
            const content = escapeHtml(line.slice(2).trim());
            htmlFragment += `<p class="small-text">${content}</p>\n`;
            continue;
        }

        // 5. コピー 
        if (line.startsWith('コピー ')) {
            const content = escapeHtml(line.slice(4).trim());
            // 公開ページではコピー機能を提供できないため、コードブロックとして表示
            htmlFragment += `<div class="code-box"><pre><code>${content}</code></pre></div>\n`;
            continue;
        }

        // 6. ボタン (新規)
        if (line.startsWith('ボタン ')) {
            const parts = line.slice(4).trim().split(/\s+/);
            const rawUrl = parts[0];
            const text = parts.slice(1).join(' ').trim() || 'ボタン';
            const safeUrl = validateAndNormalizeUrl(rawUrl);
            const safeText = escapeHtml(text);

            if (safeUrl) {
                htmlFragment += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="action-button">${safeText}</a>\n`;
            } else {
                htmlFragment += `<p>[無効なボタンURL: ${escapeHtml(rawUrl)} - ボタンがブロックされました]</p>\n`;
            }
            continue;
        }

        // 7. ボックス (新規)
        if (line.startsWith('ボックス ')) {
            const match = line.match(/^ボックス\s+\(([^)]+)\)\s*(.*)/);
            if (match) {
                const rawColor = match[1].trim();
                const content = match[2].trim();
                const color = normalizeColor(rawColor);

                if (color) {
                    const isDarkBackground = (color !== 'white' && color !== '#ffffff' && color !== 'yellow' && !/rgba?\(255, 255, 255/.test(color));
                    const textColor = isDarkBackground ? 'white' : '#1f2937';

                    // ボックス内の内容にもインライン解析を適用 (XSS対策済み)
                    const htmlContent = parseLineForInlines(content); 

                    htmlFragment += `<div class="alert-box" style="background-color: ${color}; color: ${textColor};">${htmlContent}</div>\n`;

                } else {
                    htmlFragment += `<p>[無効な色: ${escapeHtml(rawColor)} - ボックスがブロックされました]</p>\n`;
                }
            }
            continue;
        }

        // 8. 引用 (画像)
        if (line.startsWith('引用 ')) {
            const rawUrl = line.slice(3).trim().split(/\s+/)[0];
            const safeUrl = validateAndNormalizeUrl(rawUrl);

            if (safeUrl) {
                const altText = `引用画像: ${safeUrl}`;
                htmlFragment += `<figure><img src="${safeUrl}" alt="${escapeHtml(altText)}"><figcaption>${escapeHtml(safeUrl)}</figcaption></figure>\n`;
            } else {
                htmlFragment += `<p>[無効な画像URL: ${escapeHtml(rawUrl)} - 画像がブロックされました]</p>\n`;
            }
            continue;
        }

        // 9. 改行コマンド <br>
        if (line.startsWith('改行')) {
            htmlFragment += '<br>\n';
            continue;
        }

        // 10. 空行: 改行 <br>
        if (line.trim() === '') {
            htmlFragment += '<br>\n';
            continue;
        }

        // 11. その他: 通常の段落 <p> (インライン処理を適用)
        // parseLineForInlinesの修正により、生のHTMLタグはエスケープされるため安全
        const htmlContent = parseLineForInlines(line); 
        htmlFragment += `<p>${htmlContent}</p>\n`;
    }

    return { fragment: htmlFragment, bgColor: globalBgColor };
}

function convertMarkscriptToFullHtml(markscript) {
    const { fragment, bgColor } = parseMarkScriptToHtmlFragment(markscript);

    // タイトルはフラグメントから抽出
    const match = fragment.match(/<h1>(.*?)<\/h1>/);
    const title = match ? match[1].replace(/<\/?[^>]+(>|$)/g, "") : 'MarkScript Published Site'; 

    const bodyStyle = bgColor ? `background-color: ${bgColor};` : `background-color: #f9f9f9;`;

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        /* UI改善のための基本スタイル */
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; margin: 0 auto; max-width: 800px; padding: 20px; ${bodyStyle} color: #333; transition: background-color 0.3s; }
        h1 { border-bottom: 2px solid #ccc; padding-bottom: 10px; color: #2a6496; }
        h3 { color: #555; margin-top: 1.5em; }
        p { margin-top: 0; margin-bottom: 1em; }
        
        /* MarkScript拡張機能の公開用スタイル */
        .code-box { background: #e8e8e8; padding: 10px; border-radius: 5px; margin: 10px 0; overflow-x: auto; font-family: 'Consolas', monospace; }
        .code-box pre { margin: 0; }
        .code-box code { display: block; white-space: pre-wrap; }

        .small-text { font-size: 0.9em; color: #666; }
        
        img { max-width: 100%; height: auto; display: block; margin: 10px auto; border-radius: 5px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
        figure { margin: 0; }
        figcaption { font-size: 0.9em; color: #777; text-align: center; margin-top: 5px; word-break: break-all; }

        /* インライン要素のスタイル */
        .colored-text, .bordered-text { padding: 2px 4px; border-radius: 4px; margin: 0 2px; }
        .bordered-text { border: 2px solid; display: inline-block; padding: 5px 10px; }
        
        code { background: #e8e8e8; padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 0.9em; color: #333; }

        /* 新規追加: ボタン */
        .action-button {
            display: inline-block;
            padding: 10px 20px;
            font-size: 16px;
            border: none;
            background: #10b981; 
            color: white !important;
            border-radius: 8px;
            cursor: pointer;
            text-decoration: none;
            transition: background-color 0.2s, transform 0.1s;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin: 10px 0;
            line-height: 1;
        }
        .action-button:hover { background: #059669; }

        /* 新規追加: ボックス */
        .alert-box {
            margin: 15px 0;
            padding: 10px 15px;
            border-radius: 6px;
            font-weight: 500;
        }
        .alert-box a { color: inherit; text-decoration: underline; }
        
        /* リンクの基本スタイル */
        a { color: #0645ad; text-decoration: none; border-bottom: 1px dashed #0645ad50; }
        a:hover { text-decoration: none; border-bottom: 1px solid #0645ad; }
    </style>
</head>
<body>
    ${fragment}
</body>
</html>`;
}


// --- サーバーレス関数のメインハンドラ ---

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'サーバー設定エラー: GitHubトークンが設定されていません。' });
    }

    let body;
    try {
        body = req.body || (typeof req.body === 'string' ? JSON.parse(req.body) : {});
    } catch (e) {
        return res.status(400).json({ error: '無効なJSON形式です。' });
    }

    const { markscript, filepath: rawFilepath } = body;

    if (!markscript || !rawFilepath) {
        return res.status(400).json({ error: 'markscriptとfilepathは必須です。' });
    }

    // 🚨 厳格なパス検証 🚨
    let cleanPath = rawFilepath.trim().replace(/^\/+/, '');

    if (cleanPath.includes('..') || cleanPath.includes('\\')) {
         console.warn(`Attempted Path Traversal blocked: ${rawFilepath}`);
        return res.status(403).json({ error: 'ファイルパスに不正な文字が含まれています（ディレクトリアクセス違反）。', details: 'Path Traversal attempt blocked.' });
    }

    if (!cleanPath.startsWith('site/')) {
        cleanPath = 'site/' + cleanPath;
    }

    const pathRegex = /^site\/[a-zA-Z0-9_\-\/]+\.html$/;
    if (!cleanPath.endsWith('.html') || !cleanPath.match(pathRegex)) {
         console.warn(`Invalid characters or format blocked: ${cleanPath}`);
        return res.status(400).json({ error: '有効なファイルパスを入力してください。パスは site/ で始まり、英数字、ハイフン、アンダースコアのみ使用できます。', details: 'Invalid file path format.' });
    }

    if (cleanPath.length > 255) {
        return res.status(400).json({ error: 'ファイルパスが長すぎます。', details: 'Path too long.' });
    }

    // ----------------------------------------

    let sha = null;

    try {
        // 1. 既存ファイルのSHAを取得 
        try {
            const { data } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: cleanPath,
                branch: BRANCH,
            });
            sha = data.sha;
        } catch (error) {
            if (error.status !== 404) {
                console.error(`Error getting SHA for ${cleanPath}:`, error.message);
                throw error;
            }
        }

        // 2. MarkScriptを完全なHTMLに変換
        const htmlContent = convertMarkscriptToFullHtml(markscript);

        // 3. コンテンツをBase64でエンコード
        const contentBase64 = Buffer.from(htmlContent, 'utf-8').toString('base64');

        // 4. GitHub APIを使用してファイルをリポジトリにプッシュ/更新
        const message = sha ? `[MarkScript] Updated: ${cleanPath}` : `[MarkScript] Created: ${cleanPath}`;

        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: cleanPath, 
            message: message,
            content: contentBase64,
            branch: BRANCH,
            sha: sha, 
        });

        // 5. 公開URLを返す 
        const finalDomain = PUBLISHED_DOMAIN.endsWith('/') ? PUBLISHED_DOMAIN.slice(0, -1) : PUBLISHED_DOMAIN;
        const publishedUrl = `${finalDomain}/${cleanPath}`;

        res.status(200).json({ 
            message: 'Successfully deployed!',
            publishedUrl: publishedUrl
        });

    } catch (error) {
        console.error('GitHub API Error (General):', error.message);
        const gh_error = error.response && error.response.data && error.response.data.message;

        res.status(500).json({ 
            error: 'デプロイ中にエラーが発生しました。',
            details: gh_error || error.message 
        });
    }
};
