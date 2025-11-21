// api/deploy.js (Node.js / Vercel Functions / Netlify Functions向け)

// npm install @octokit/rest url
const { Octokit } = require('@octokit/rest'); 
const { URL } = require('url'); // Node.js環境でURLを扱う

// --- 設定/環境変数 ---
// 環境変数から取得することを推奨
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
// ユーザー自身の情報に書き換えること
const REPO_OWNER = 'tanuki276'; 
const REPO_NAME = 'MarkScript'; 
// 実際にデプロイされたドメインに変更すること
const PUBLISHED_DOMAIN = 'https://mark-script.vercel.app'; 
const BRANCH = 'main'; // 公開ブランチ

// フロントエンドと完全に同期させたCOLOR_MAP
const COLOR_MAP = {
    '赤': 'red',
    '青': 'blue',
    '緑': 'green',
    '黄': 'yellow',
    '黒': 'black',
    '白': 'white',
    '灰': 'gray', // 'グレー'を'灰'に修正
    '紫': 'purple',
    'オレンジ': 'orange',
};

// サーバーレス関数環境ではログ出力が重要
if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKENが環境変数に設定されていません。");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- ユーティリティ ---
function validateAndNormalizeUrl(raw) {
    try {
        const cleaned = raw.trim();
        // 1. 不正文字フィルタリング ('<', '>', '"', "'"、および空白)
        if (/\s/.test(cleaned) || /[<>"'`]/.test(cleaned)) return null; 

        const url = new URL(cleaned); 
        const allowedProtocols = ['http:', 'https:'];
        
        // 2. 許可されたプロトコルのみ
        if (!allowedProtocols.includes(url.protocol)) return null; 
        
        // 3. ユーザー名/パスワード/ポートを許可しない
        if (url.username || url.password || url.port) return null;
        
        // 4. URL全体の長さ制限 (DoS攻撃対策)
        if (url.href.length > 2048) return null; 
        
        // 5. パスに '../' のようなディレクトラバーサル要素がないかチェック
        if (url.pathname.includes('..')) return null;

        return url.href;
    } catch (e) {
        return null; // 無効なURL構造
    }
}

// フロントエンドと完全に同期させたnormalizeColor
function normalizeColor(input) {
    if (!input) return null;
    const lower = input.toLowerCase();

    // 1. 日本語の色名マップ
    if (COLOR_MAP[input]) {
        return COLOR_MAP[input];
    }
    // 2. HEXコード
    if (/^#([0-9A-F]{3}){1,2}$/i.test(input)) {
        return input;
    }
    // 3. CSSのRGB/RGBA, HSL/HSLA 形式 (フロントエンドと同期)
    if (/^rgba?\((.+?)\)$/i.test(lower) || /^hsla?\((.+?)\)$/i.test(lower)) {
        return input;
    }
    // 4. CSSの予約語
    if (/^[a-z]+$/.test(lower)) {
        return lower;
    }
    return null;
}


// --- MarkScriptをHTMLフラグメントに変換するロジック ---
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
            const textPart = line.slice(4).trim();
            // XSS対策: textPartは安全なテキストだが、念のためHTMLエスケープ処理を推奨
            htmlFragment += `<h1>${textPart}</h1>\n`;
            continue;
        }

        // 3. 大
        if (line.startsWith('大 ')) {
            const textPart = line.slice(2).trim();
            htmlFragment += `<h3>${textPart}</h3>\n`;
            continue;
        }

        // 4. 小 (文字を小さくする)
        if (line.startsWith('小 ')) {
            const content = line.slice(2).trim();
            htmlFragment += `<p class="small-text">${content}</p>\n`;
            continue;
        }

        // 5. コピー (コードブロックとして表示 - コピーはクライアント側機能のため、ここではテキスト表示のみ)
        if (line.startsWith('コピー ')) {
            const content = line.slice(4).trim();
            htmlFragment += `<div class="code-box"><pre><code>${content}</code></pre></div>\n`;
            continue;
        }

        // 6. 引用 (画像)
        if (line.startsWith('引用 ')) {
            const rawUrl = line.slice(3).trim().split(/\s+/)[0];
            const safeUrl = validateAndNormalizeUrl(rawUrl);

            if (safeUrl) {
                // imgタグにURLを直接挿入しても、validateAndNormalizeUrlを通しているので安全性が保たれる
                const altText = `引用画像: ${safeUrl}`;
                htmlFragment += `<figure><img src="${safeUrl}" alt="${altText}"><figcaption>${safeUrl}</figcaption></figure>\n`;
            } else {
                htmlFragment += `<p>[無効な画像URL: ${rawUrl} - 画像がブロックされました]</p>\n`;
            }
            continue;
        }

        // 7. 色付 または 枠文字 (パースロジックをフロントエンドと同期)
        if (line.startsWith('色付 ') || line.startsWith('枠文字 ')) {
            const isBorder = line.startsWith('枠文字 ');
            const prefixLength = isBorder ? 5 : 3;

            // 修正: (色) テキスト のパターンを抽出を強化
            const content = line.slice(prefixLength).trim();
            const match = content.match(/^\(([^)]+)\)\s*(.*)/); // 最初の閉じ括弧までを色とする

            if (match && match.length >= 3) {
                const rawColor = match[1].trim();
                const contentText = match[2].trim();
                const color = normalizeColor(rawColor);

                if (color) {
                    let spanStyle = `color: ${color};`;
                    let pClass = '';

                    if (isBorder) {
                        spanStyle += `border: 2px solid ${color}; padding: 5px 10px; display: inline-block; border-radius: 5px;`;
                        pClass = 'bordered-wrapper'; 
                    }

                    // contentTextはテキストとして安全に挿入
                    htmlFragment += `<p${pClass ? ` class="${pClass}"` : ''}><span style="${spanStyle}">${contentText}</span></p>\n`;
                } else {
                    htmlFragment += `<p>[無効な色: ${rawColor}] ${contentText}</p>\n`;
                }
            } else {
                 htmlFragment += `<p>[${isBorder ? '枠文字' : '色付'} の形式が不正です]</p>\n`;
            }
            continue;
        }

        // 8. 埋め (リンク)
        if (line.startsWith('埋め ')) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
                const rawUrl = parts[1];
                const linkText = parts.slice(2).join(' ') || rawUrl;
                const safeUrl = validateAndNormalizeUrl(rawUrl);

                if (safeUrl) {
                    htmlFragment += `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a></p>\n`;
                } else {
                    htmlFragment += `<p>[無効なURL: ${rawUrl} - リンクがブロックされました]</p>\n`;
                }
            } else {
                htmlFragment += `<p>[埋め の形式が不正です]</p>\n`;
            }
            continue;
        }

        // 9. [新規追加] 改行コマンド <br> (フロントエンドと同期)
        if (line.startsWith('改行')) {
            htmlFragment += '<br>\n';
            continue;
        }
        
        // 10. 空行: 改行 <br>
        if (line.trim() === '') {
            htmlFragment += '<br>\n';
            continue;
        }

        // 11. その他: 通常の段落 <p>
        htmlFragment += `<p>${line}</p>\n`;
    }

    return { fragment: htmlFragment, bgColor: globalBgColor };
}

// --- 完全なHTML全体を生成する関数 ---
function convertMarkscriptToFullHtml(markscript) {
    const { fragment, bgColor } = parseMarkScriptToHtmlFragment(markscript);

    const match = fragment.match(/<h1>(.*?)<\/h1>/);
    const title = match ? match[1].replace(/<\/?[^>]+(>|$)/g, "") : 'MarkScript Published Site'; 

    // 背景色があればbodyスタイルに追加
    const bodyStyle = bgColor ? `background-color: ${bgColor};` : `background-color: #f9f9f9;`;

    // 公開サイト用のCSSを整備
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

        /* 枠文字のラッパー (pタグ) 用スタイル */
        .bordered-wrapper { margin: 1em 0; }
        .bordered-wrapper span { display: inline-block; } /* 枠文字のspanが正しく動作するように */
    </style>
</head>
<body>
    ${fragment}
</body>
</html>`;
}


// --- サーバーレス関数のメインハンドラ ---

module.exports = async (req, res) => {
    // CORSヘッダーを先に設定 (ローカル開発用。本番環境ではVercel/Netlifyの設定に依存)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        // プリフライトリクエストの処理
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'サーバー設定エラー: GitHubトークンが設定されていません。' });
    }

    // JSONボディのパース
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

    // パスのサニタイズと正規化
    // 1. パストラバーサルの防止と空白の除去
    let cleanPath = rawFilepath.replace(/\.\.[\/\\]/g, '').trim(); 
    
    // 2. "site/" プレフィックスの保証
    if (!cleanPath.startsWith('site/')) {
        cleanPath = 'site/' + cleanPath.replace(/^\/+/, ''); // 先頭のスラッシュを削除してから 'site/' を付与
    }

    if (!cleanPath.endsWith('.html') || cleanPath.length < 10) { // 最低限の長さチェックも追加
        return res.status(400).json({ error: 'ファイルパスは.htmlで終わり、適切な長さである必要があります。' });
    }
    
    // GitHub APIで既存のファイルのSHAを取得 (上書きフラグとして利用)
    let sha = null;

    try {
        // 1. 既存ファイルのSHAを取得 (上書きが必要な場合)
        try {
            const { data } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: cleanPath,
                branch: BRANCH,
            });
            sha = data.sha;
        } catch (error) {
            // 404以外は致命的なエラーとしてスロー
            if (error.status !== 404) {
                console.error(`Error getting SHA for ${cleanPath}:`, error.message);
                throw error;
            }
        }

        // 2. MarkScriptを完全なHTMLに変換
        const htmlContent = convertMarkscriptToFullHtml(markscript);

        // 3. コンテンツをBase64でエンコード (GitHub APIの要件)
        const contentBase64 = Buffer.from(htmlContent, 'utf-8').toString('base64');

        // 4. GitHub APIを使用してファイルをリポジトリにプッシュ/更新
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: cleanPath, 
            message: sha ? `[MarkScript] Updated: ${cleanPath}` : `[MarkScript] Created: ${cleanPath}`,
            content: contentBase64,
            branch: BRANCH,
            sha: sha, // shaがあれば更新、なければ新規作成
        });

        // 5. 公開URLを返す (ドメインの末尾にスラッシュがないことを確認し、パスを結合)
        const finalDomain = PUBLISHED_DOMAIN.endsWith('/') ? PUBLISHED_DOMAIN.slice(0, -1) : PUBLISHED_DOMAIN;
        const publishedUrl = `${finalDomain}/${cleanPath}`;

        res.status(200).json({ 
            message: 'Successfully deployed!',
            publishedUrl: publishedUrl
        });

    } catch (error) {
        console.error('GitHub API Error (General):', error.message);
        res.status(500).json({ 
            error: 'デプロイ中にエラーが発生しました。リポジトリ名、ブランチ、トークンの権限（`repo`スコープ）を確認してください。',
            details: error.message 
        });
    }
};