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
function validateAndNormalizeUrl(raw) {
    // ... (フロントエンドと共通のロジック) ...
    try {
        const cleaned = raw.trim();
        if (/\s/.test(cleaned) || /[<>"'`]/.test(cleaned)) return null; 

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
    // ... (フロントエンドと共通のロジック) ...
    if (!input) return null;
    const lower = input.toLowerCase();

    if (COLOR_MAP[input]) {
        return COLOR_MAP[input];
    }
    if (/^#([0-9A-F]{3}){1,2}$/i.test(input)) {
        return input;
    }
    if (/^rgba?\((.+?)\)$/i.test(lower) || /^hsla?\((.+?)\)$/i.test(lower)) {
        return input;
    }
    if (/^[a-z]+$/.test(lower)) {
        return lower;
    }
    return null;
}

// MarkScriptパーサーのためのヘルパー関数（インライン機能修正版をサーバーサイド向けに調整）
function parseLineForInlines(text) {
    // ... (フロントエンドと共通のロジック。ただしコンテンツのエスケープを推奨) ...
    let result = text;
    
    // 1. 埋め (リンク) の処理
    result = result.replace(/埋め\s+(https?:\/\/[^\s]+)(?:\s+(.*?))?(?=\s*埋め|\s*色付|\s*枠文字|$)/g, (match, url, linkText) => {
        const safeUrl = validateAndNormalizeUrl(url);
        // HTMLエンコードを適用 (XSS対策)
        const display = (linkText || url || '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        if (safeUrl) {
            return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${display}</a>`;
        }
        return `[無効なURL: ${url}]`; 
    });

    // 2. 色付 / 枠文字 の処理
    const inlineRegex = /(色付|枠文字)\s*\(([^)]+)\)\s*(.*?)(?=(?:色付|枠文字|埋め|\s*$))/g;

    result = result.replace(inlineRegex, (match, type, rawColor, content) => {
        const color = normalizeColor(rawColor.trim());
        // HTMLエンコードを適用 (XSS対策)
        const contentTrimmed = content.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        if (!color) return `[無効な色: ${rawColor}]`; 

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

    // インライン処理後の残りのテキストをエスケープ
    return result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}


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
            // テキストを安全に挿入するためエスケープ
            const textPart = line.slice(4).trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            htmlFragment += `<h1>${textPart}</h1>\n`;
            continue;
        }

        // 3. 大
        if (line.startsWith('大 ')) {
            const textPart = line.slice(2).trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            htmlFragment += `<h3>${textPart}</h3>\n`;
            continue;
        }

        // 4. 小 (文字を小さくする)
        if (line.startsWith('小 ')) {
            const content = line.slice(2).trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            htmlFragment += `<p class="small-text">${content}</p>\n`;
            continue;
        }

        // 5. コピー 
        if (line.startsWith('コピー ')) {
            const content = line.slice(4).trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // 公開ページではコピー機能を提供できないため、コードブロックとして表示
            htmlFragment += `<div class="code-box"><pre><code>${content}</code></pre></div>\n`;
            continue;
        }

        // 6. 引用 (画像)
        if (line.startsWith('引用 ')) {
            const rawUrl = line.slice(3).trim().split(/\s+/)[0];
            const safeUrl = validateAndNormalizeUrl(rawUrl);

            if (safeUrl) {
                const altText = `引用画像: ${safeUrl}`;
                htmlFragment += `<figure><img src="${safeUrl}" alt="${altText}"><figcaption>${safeUrl}</figcaption></figure>\n`;
            } else {
                htmlFragment += `<p>[無効な画像URL: ${rawUrl} - 画像がブロックされました]</p>\n`;
            }
            continue;
        }
        
        // 7. 改行コマンド <br>
        if (line.startsWith('改行')) {
            htmlFragment += '<br>\n';
            continue;
        }

        // 8. 空行: 改行 <br>
        if (line.trim() === '') {
            htmlFragment += '<br>\n';
            continue;
        }

        // 9. その他: 通常の段落 <p> (インライン処理を適用)
        // インラインディレクティブ (色付, 枠文字, 埋め) をHTMLに変換
        const htmlContent = parseLineForInlines(line); 
        htmlFragment += `<p>${htmlContent}</p>\n`;
    }

    return { fragment: htmlFragment, bgColor: globalBgColor };
}

function convertMarkscriptToFullHtml(markscript) {
    const { fragment, bgColor } = parseMarkScriptToHtmlFragment(markscript);

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
        a { color: #0645ad; text-decoration: none; border-bottom: 1px dashed #0645ad50; }
        a:hover { text-decoration: none; border-bottom: 1px solid #0645ad; }
        
        /* MarkScript拡張機能の公開用スタイル */
        .code-box { background: #e8e8e8; padding: 10px; border-radius: 5px; margin: 10px 0; overflow-x: auto; font-family: 'Consolas', monospace; }
        .small-text { font-size: 0.9em; color: #666; }
        
        img { max-width: 100%; height: auto; display: block; margin: 10px auto; border-radius: 5px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
        figure { margin: 0; }
        figcaption { font-size: 0.9em; color: #777; text-align: center; margin-top: 5px; word-break: break-all; }

        /* インライン要素のスタイル */
        .colored-text, .bordered-text { padding: 2px 4px; border-radius: 4px; margin: 0 2px; }
        .bordered-text { border: 2px solid; display: inline-block; padding: 5px 10px; }
    </style>
</head>
<body>
    ${fragment}
</body>
</html>`;
}


// --- サーバーレス関数のメインハンドラ ---

module.exports = async (req, res) => {
    // ... (CORS, Method check, etc. setup)

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

    // 🚨 修正された厳格なパス検証 🚨
    
    // 1. パスの前後の空白と先頭のスラッシュを除去
    let cleanPath = rawFilepath.trim().replace(/^\/+/, '');

    // 2. パストラバーサル要素 (../, ..\) を厳密にチェック
    if (cleanPath.includes('..') || cleanPath.includes('\\')) {
         console.warn(`Attempted Path Traversal blocked: ${rawFilepath}`);
        return res.status(403).json({ error: 'ファイルパスに不正な文字が含まれています（ディレクトリアクセス違反）。', details: 'Path Traversal attempt blocked.' });
    }

    // 3. "site/" プレフィックスの保証
    if (!cleanPath.startsWith('site/')) {
        cleanPath = 'site/' + cleanPath;
    }

    // 4. 拡張子と許可された文字の最終検証
    // 許可する文字: 英数字、ハイフン、アンダースコア、スラッシュ (site/ の直下のみ)、そして .html
    // パスが 'site/path/file.html' の形式であることを厳格に確認
    if (!cleanPath.endsWith('.html') || cleanPath.length < 10 || !cleanPath.match(/^site\/[a-zA-Z0-9_\-\/]+\.html$/)) {
         console.warn(`Invalid characters or format blocked: ${cleanPath}`);
        return res.status(400).json({ error: '有効なファイルパスを入力してください。パスは site/ で始まり、英数字とハイフンのみ使用できます。', details: 'Invalid file path format.' });
    }

    // 5. 最大パス長チェック (GitHubの制限を考慮)
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
