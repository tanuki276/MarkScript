// api/deploy.js (Node.js / Vercel Functions / Netlify Functions向け)

// npm install @octokit/rest
const { Octokit } = require('@octokit/rest'); 
const { URL } = require('url');

// --- 機密情報/環境変数 ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'tanuki276'; // !!! 自分のGitHubユーザー名に変更 !!!
const REPO_NAME = 'MarkScript'; // !!! 公開用リポジトリ名に変更 !!!
const PUBLISHED_DOMAIN = 'https://mark-script.vercel.app/'; // !!! 実際にデプロイされたドメインに変更 !!!
const BRANCH = 'main'; 

if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is not set in environment variables.");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });


// --- MarkScriptをHTMLフラグメントに変換するロジック ---
function parseMarkScriptToHtmlFragment(text) {
    const lines = text.split(/\r?\n/).slice(0, 2000); 
    let htmlFragment = '';
    const MAX_LINE_CHARS = 2000;
    // 背景色を格納する変数
    let globalBgColor = null;

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
    
    // カラーコードやキーワードを検証する簡易関数
    function isValidColor(color) {
        if (!color) return false;
        // HEXコード (#ffffff) またはCSSの予約語 (red, blue, etc.) の簡易チェック
        return /^#([0-9A-F]{3}){1,2}$/i.test(color) || /^[a-z]+$/.test(color);
    }

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
             if (isValidColor(color)) {
                 globalBgColor = color;
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

        // 4. 小 (コードブロック)
        if (line.startsWith('小 ')) {
            const content = line.slice(2).trim();
            htmlFragment += `<div class="code-box"><pre><code>${content}</code></pre></div>\n`;
            continue;
        }
        
        // 5. 画像
        if (line.startsWith('画像 ')) {
            const parts = line.slice(3).trim().split(/\s+/);
            if (parts.length >= 1) {
                const rawUrl = parts[0];
                const altText = parts.slice(1).join(' ') || '引用画像';
                const safeUrl = validateAndNormalizeUrl(rawUrl);

                if (safeUrl) {
                    htmlFragment += `<figure><img src="${safeUrl}" alt="${altText}" style="max-width:100%; height:auto; display:block; margin: 10px 0; border-radius: 5px;"><figcaption>${altText}</figcaption></figure>\n`;
                } else {
                    htmlFragment += `<p>[無効な画像URL: ${rawUrl} - 画像がブロックされました]</p>\n`;
                }
            } else {
                htmlFragment += `<p>[画像 の形式が不正です]</p>\n`;
            }
            continue;
        }

        // 6. 色付 (行内の色付け)
        if (line.startsWith('色付 ')) {
            const parts = line.slice(3).trim().match(/^\((.+?)\)\s*(.+)/); // (色) テキスト のパターンを抽出
            if (parts && parts.length === 3) {
                const color = parts[1].trim();
                const content = parts[2].trim();
                if (isValidColor(color)) {
                    htmlFragment += `<p><span style="color: ${color};">${content}</span></p>\n`;
                } else {
                    htmlFragment += `<p>[無効な色: ${color}] ${content}</p>\n`;
                }
            } else {
                 htmlFragment += `<p>[色付 の形式が不正です]</p>\n`;
            }
            continue;
        }


        // 7. 空行: 改行 <br>
        if (line.trim() === '') {
            htmlFragment += '<br>\n';
            continue;
        }
        
        // 8. その他: 通常の段落 <p>
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
        a { color: #0645ad; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .code-box { background: #e0e0e0; padding: 10px; border-radius: 5px; margin: 10px 0; overflow-x: auto;}
        figcaption { font-size: 0.9em; color: #666; text-align: center; margin-top: 5px; }
    </style>
</head>
<body>
    ${fragment}
</body>
</html>`;
}


// --- サーバーレス関数のメインハンドラ (省略: 以前と同じロジック) ---

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'サーバー設定エラー: GitHubトークンが設定されていません。' });
    }

    const { markscript, filepath } = req.body;
    
    if (!markscript || !filepath) {
        return res.status(400).json({ error: 'markscriptとfilepathは必須です。' });
    }
    
    const cleanPath = filepath.replace(/\.\.[\/\\]/g, '').trim(); 
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
