// api/deploy.js (Node.js / Vercel Functions / Netlify Functions向け)

// npm install @octokit/rest url
const { Octokit } = require('@octokit/rest'); 
const { URL } = require('url');

// --- 設定/環境変数 ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'tanuki276'; // !!! ここを自分のGitHubユーザー名に変更 !!!
const REPO_NAME = 'MarkScript'; // !!! ここを公開用リポジトリ名に変更 !!!
const PUBLISHED_DOMAIN = 'https://mark-script.vercel.app/'; // !!! 実際にデプロイされたドメインに変更 !!!
const BRANCH = 'main'; // 公開ブランチ

const COLOR_MAP = {
    '赤': 'red',
    '青': 'blue',
    '緑': 'green',
    '黄': 'yellow',
    '黒': 'black',
    '白': 'white',
    'グレー': 'gray',
    '紫': 'purple',
    'オレンジ': 'orange',
};


if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is not set in environment variables.");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- ユーティリティ ---
function validateAndNormalizeUrl(raw) {
    try {
        const cleaned = raw.trim();
        if (/\s/.test(cleaned)) return null;
        const url = new URL(cleaned); 
        if (!['http:', 'https:'].includes(url.protocol)) return null; 
        if (url.username || url.password) return null;
        return url.href;
    } catch (e) {
        return null;
    }
}

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
    // 3. CSSの予約語
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
    let globalBgColor = null; // 背景色を格納する変数

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
             continue; // 背景設定行はコンテンツとして出力しない
        }

        // 2. タイトル
        if (line.startsWith('タイトル ')) {
            const textPart = line.slice(4).trim();
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

        // 5. コピー (コードブロックとして表示)
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
                const altText = `引用画像: ${safeUrl}`;
                // figcaptionにURLを入れる
                htmlFragment += `<figure><img src="${safeUrl}" alt="${altText}"><figcaption>${safeUrl}</figcaption></figure>\n`;
            } else {
                htmlFragment += `<p>[無効な画像URL: ${rawUrl} - 画像がブロックされました]</p>\n`;
            }
            continue;
        }

        // 7. 色付 または 枠文字
        if (line.startsWith('色付 ') || line.startsWith('枠文字 ')) {
            const isBorder = line.startsWith('枠文字 ');
            const prefixLength = isBorder ? 5 : 3;
            
            // (色) テキスト のパターンを抽出
            const parts = line.slice(prefixLength).trim().match(/^\((.+?)\)\s*(.+)/); 

            if (parts && parts.length === 3) {
                const rawColor = parts[1].trim();
                const content = parts[2].trim();
                const color = normalizeColor(rawColor);
                
                if (color) {
                    let spanStyle = `color: ${color};`;
                    let pClass = '';

                    if (isBorder) {
                        spanStyle += `border: 2px solid ${color}; padding: 5px 10px; display: inline-block; border-radius: 5px;`;
                        pClass = 'bordered-wrapper'; // pタグのmarginを制御するためのクラス
                    }
                    
                    htmlFragment += `<p${pClass ? ` class="${pClass}"` : ''}><span style="${spanStyle}">${content}</span></p>\n`;
                } else {
                    htmlFragment += `<p>[無効な色: ${rawColor}] ${content}</p>\n`;
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

        // 9. 空行: 改行 <br>
        if (line.trim() === '') {
            htmlFragment += '<br>\n';
            continue;
        }
        
        // 10. その他: 通常の段落 <p>
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

    // 公開サイト用のCSS
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; margin: 0 auto; max-width: 800px; padding: 20px; ${bodyStyle} color: #333; }
        h1 { border-bottom: 2px solid #ccc; padding-bottom: 10px; }
        h3 { color: #0645ad; }
        p { margin-top: 0; margin-bottom: 1em; }
        a { color: #0645ad; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .code-box { background: #e0e0e0; padding: 10px; border-radius: 5px; margin: 10px 0; overflow-x: auto;}
        
        /* 拡張機能のスタイル */
        .small-text { font-size: smaller; }
        img { max-width: 100%; height: auto; display: block; margin: 10px auto; border-radius: 5px; }
        figure { margin: 0; }
        figcaption { font-size: 0.9em; color: #666; text-align: center; margin-top: 5px; word-break: break-all; }
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

    const { markscript, filepath: rawFilepath } = req.body;
    
    if (!markscript || !rawFilepath) {
        return res.status(400).json({ error: 'markscriptとfilepathは必須です。' });
    }
    
    // フォルダ統一の処理: パスが "site/" で始まっていない場合は付与する
    let cleanPath = rawFilepath.replace(/\.\.[\/\\]/g, '').trim(); 
    if (!cleanPath.startsWith('site/')) {
        cleanPath = 'site/' + cleanPath.replace(/^\/+/, '');
    }

    if (!cleanPath.endsWith('.html')) {
        return res.status(400).json({ error: 'ファイルパスは.htmlで終わる必要があります。' });
    }

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
            if (error.status !== 404) {
                throw error;
            }
        }

        // 2. MarkScriptを完全なHTMLに変換
        const htmlContent = convertMarkscriptToFullHtml(markscript);
        
        // 3. コンテンツをBase64でエンコード
        const contentBase64 = Buffer.from(htmlContent, 'utf-8').toString('base64');

        // 4. GitHub APIを使用してファイルをリポジトリにプッシュ/更新
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: cleanPath, 
            message: sha ? `[MarkScript] Updated: ${cleanPath}` : `[MarkScript] Created: ${cleanPath}`,
            content: contentBase64,
            branch: BRANCH,
            sha: sha, 
        });

        // 5. 公開URLを返す
        const publishedUrl = `${PUBLISHED_DOMAIN}/${cleanPath}`;

        res.status(200).json({ 
            message: 'Successfully deployed!',
            publishedUrl: publishedUrl
        });

    } catch (error) {
        console.error('GitHub API Error:', error);
        res.status(500).json({ 
            error: 'デプロイ中にエラーが発生しました。詳細はサーバーログを確認してください。',
            details: error.message 
        });
    }
};
