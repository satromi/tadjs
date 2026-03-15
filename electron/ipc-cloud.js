/**
 * electron/ipc-cloud.js
 * Net-BTRONクラウド実身共有のIPC通信ハンドラ
 * main.jsから分離
 */

const { ipcMain, BrowserWindow, shell } = require('electron');
const { getLogger } = require('./logger.cjs');
const http = require('http');

const logger = getLogger('IPC-Cloud');

/**
 * クラウド関連のIPCハンドラを登録
 * @param {Object} cloudAccessManager CloudAccessManagerインスタンス
 */
function registerCloudIpcHandlers(cloudAccessManager) {

    // =============================================================
    // ヘルパー関数
    // =============================================================

    // cloudAccessManager の null チェックを一元化するラッパー
    function cloudHandler(name, fn) {
        ipcMain.handle(name, async (event, ...args) => {
            if (!cloudAccessManager) {
                return { success: false, error: 'CloudAccessManager が利用できません' };
            }
            return await fn(event, ...args);
        });
    }

    // IPC入力バリデーション関数
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function isValidUUID(value) {
        return typeof value === 'string' && UUID_REGEX.test(value);
    }
    function validateUUID(value, label) {
        if (!isValidUUID(value)) {
            return { success: false, error: `無効な${label}形式です` };
        }
        return null;
    }
    function validateString(value, label, maxLength = 255) {
        if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
            return { success: false, error: `無効な${label}です（空または長すぎます）` };
        }
        return null;
    }
    function validateEnum(value, label, allowedValues) {
        if (!allowedValues.includes(value)) {
            return { success: false, error: `無効な${label}です` };
        }
        return null;
    }
    function validateVersion(value, label, minValue = 0) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < minValue) {
            return { success: false, error: `${label}は${minValue === 0 ? '非負整数' : '正の整数'}である必要があります` };
        }
        return null;
    }

    // ファイルデータをBufferに変換するヘルパー
    function convertFilesToBuffers(files) {
        const bufferFiles = {};
        if (files.json) bufferFiles.json = Buffer.from(files.json);
        if (files.xtad) bufferFiles.xtad = Buffer.from(files.xtad);
        if (files.ico) bufferFiles.ico = Buffer.from(files.ico);
        if (files.images && Array.isArray(files.images)) {
            bufferFiles.images = files.images.map(img => ({
                name: img.name,
                data: Buffer.from(img.data)
            }));
        }
        return bufferFiles;
    }

    // realObject からrealIdを抽出して検証するヘルパー
    function validateRealObjectId(realObject) {
        const _metadata = realObject.metadata || realObject;
        const _realId = _metadata.realId || _metadata.id;
        return validateUUID(_realId, 'realId');
    }

    // =============================================================
    // IPC通信: Net-BTRON クラウド実身共有
    // =============================================================

    // クラウド初期化
    cloudHandler('cloud-initialize', async (event, config) => {
        // CR-1: Supabase URL検証（悪意あるURLによる認証情報窃取を防止）
        if (!config || !config.url) {
            return { success: false, error: '接続設定が不足しています' };
        }
        try {
            const parsedUrl = new URL(config.url);
            if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
                return { success: false, error: '接続先URLはHTTPSである必要があります' };
            }
            if (!parsedUrl.hostname.endsWith('.supabase.co') && !parsedUrl.hostname.endsWith('.supabase.in') && parsedUrl.hostname !== 'localhost') {
                return { success: false, error: '許可されていない接続先です。Supabase URLを指定してください' };
            }
        } catch (e) {
            return { success: false, error: '無効なURLです' };
        }
        return await cloudAccessManager.initialize(config);
    });

    // クラウド認証: ログイン
    cloudHandler('cloud-sign-in', async (event, { email, password }) => {
        let err;
        if ((err = validateString(email, 'メールアドレス', 255))) return err;
        if ((err = validateString(password, 'パスワード', 255))) return err;
        return await cloudAccessManager.signIn(email, password);
    });

    // クラウド認証: OAuthログイン（システムブラウザ + ローカルHTTPサーバーでコールバック受信）
    cloudHandler('cloud-sign-in-oauth', async (event, { provider }) => {
        let err;
        // LO-2: プロバイダをホワイトリスト検証
        if ((err = validateEnum(provider, 'OAuthプロバイダ', ['google', 'github', 'azure', 'gitlab']))) return err;

        return new Promise((resolve) => {
            let resolved = false;
            let server = null;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                if (server) { try { server.close(); } catch (e) {} server = null; }
            };

            // ローカルHTTPサーバーを起動してOAuthコールバックを受信
            server = http.createServer(async (req, res) => {
                const reqUrl = new URL(req.url, 'http://127.0.0.1');

                if (reqUrl.pathname === '/auth/callback') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<!DOCTYPE html><html><head><title>認証処理中</title></head><body>' +
                        '<p>認証処理中...</p>' +
                        '<script>' +
                        'var h=window.location.hash.substring(1);' +
                        'if(h){window.location.href="/auth/complete?"+h;}' +
                        'else{document.body.innerHTML="<h3>認証に失敗しました</h3><p>このタブを閉じてやり直してください。</p>";}' +
                        '</script></body></html>');
                } else if (reqUrl.pathname === '/auth/complete') {
                    const accessToken = reqUrl.searchParams.get('access_token');
                    const refreshToken = reqUrl.searchParams.get('refresh_token');

                    if (accessToken && refreshToken && !resolved) {
                        resolved = true;
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<!DOCTYPE html><html><head><title>認証完了</title></head><body>' +
                            '<h3>認証が完了しました</h3>' +
                            '<p>このタブを閉じてアプリに戻ってください。</p></body></html>');
                        const sessionResult = await cloudAccessManager.setSessionFromTokens(accessToken, refreshToken);
                        cleanup();
                        resolve(sessionResult);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<!DOCTYPE html><html><body><h3>認証に失敗しました</h3></body></html>');
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve({ success: false, error: 'トークンの取得に失敗しました' });
                        }
                    }
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            server.listen(0, '127.0.0.1', async () => {
                const port = server.address().port;
                const redirectUrl = `http://127.0.0.1:${port}/auth/callback`;

                const urlResult = await cloudAccessManager.signInWithOAuth(provider, redirectUrl);
                if (!urlResult.success) {
                    cleanup();
                    resolve(urlResult);
                    return;
                }

                // タイムアウト（5分）
                timeoutId = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        resolve({ success: false, cancelled: true, error: 'ログインがタイムアウトしました（5分経過）' });
                    }
                }, 5 * 60 * 1000);

                shell.openExternal(urlResult.url);
            });

            server.on('error', (serverErr) => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve({ success: false, error: 'ローカルサーバー起動失敗: ' + serverErr.message });
                }
            });
        });
    });

    // クラウド認証: 新規ユーザー登録
    cloudHandler('cloud-sign-up', async (event, { email, password }) => {
        let err;
        if ((err = validateString(email, 'メールアドレス', 255))) return err;
        if ((err = validateString(password, 'パスワード', 255))) return err;
        return await cloudAccessManager.signUp(email, password);
    });

    // クラウド認証: ログアウト
    cloudHandler('cloud-sign-out', async () => {
        return await cloudAccessManager.signOut();
    });

    // クラウド認証: セッション取得
    cloudHandler('cloud-get-session', async () => {
        return await cloudAccessManager.getSession();
    });

    // クラウド招待: 招待作成
    cloudHandler('cloud-create-invite', async (event, { tenantId, email, role }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateEnum(role, 'ロール', ['admin', 'member', 'readonly']))) return err;
        return await cloudAccessManager.createInvite(tenantId, email || '', role);
    });

    // クラウド招待: トークンで招待情報取得
    cloudHandler('cloud-get-invite-by-token', async (event, { token }) => {
        let err;
        if ((err = validateString(token, '招待トークン', 200))) return err;
        return await cloudAccessManager.getInviteByToken(token);
    });

    // クラウド招待: 招待消費（テナント参加）
    cloudHandler('cloud-consume-invite', async (event, { token }) => {
        let err;
        if ((err = validateString(token, '招待トークン', 200))) return err;
        return await cloudAccessManager.consumeInvite(token);
    });

    // クラウド招待: 招待一覧
    cloudHandler('cloud-list-invites', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return await cloudAccessManager.listInvites(tenantId);
    });

    // クラウド招待: 招待取消
    cloudHandler('cloud-revoke-invite', async (event, { inviteId }) => {
        let err;
        if ((err = validateUUID(inviteId, 'inviteId'))) return err;
        return await cloudAccessManager.revokeInvite(inviteId);
    });

    // クラウド: 自分のプロフィール取得（system_role含む）
    cloudHandler('cloud-get-my-profile', async () => {
        return await cloudAccessManager.getMyProfile();
    });

    // クラウド: ユーザーのシステムロール変更（system_adminのみ）
    cloudHandler('cloud-update-user-system-role', async (event, { userId, role }) => {
        let err;
        if ((err = validateUUID(userId, 'userId'))) return err;
        if ((err = validateEnum(role, 'システムロール', ['system_admin', 'tenant_creator', 'user']))) return err;
        return await cloudAccessManager.updateUserSystemRole(userId, role);
    });

    // クラウド: 全ユーザー一覧取得（system_admin用）
    cloudHandler('cloud-list-users', async () => {
        return await cloudAccessManager.listUsers();
    });

    // クラウド: テナント一覧取得
    cloudHandler('cloud-get-tenants', async () => {
        return await cloudAccessManager.getTenants();
    });

    // クラウド: テナント作成
    cloudHandler('cloud-create-tenant', async (event, { name, visibility }) => {
        let err;
        if ((err = validateString(name, 'テナント名', 100))) return err;
        if ((err = validateEnum(visibility, '公開範囲', ['private', 'internal']))) return err;
        return await cloudAccessManager.createTenant(name, visibility);
    });

    // クラウド: テナント公開範囲変更
    cloudHandler('cloud-update-tenant-visibility', async (event, { tenantId, visibility }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateEnum(visibility, '公開範囲', ['private', 'internal']))) return err;
        return await cloudAccessManager.updateTenantVisibility(tenantId, visibility);
    });

    // クラウド: テナント名でテナント情報取得
    cloudHandler('cloud-get-tenant-by-name', async (event, { name }) => {
        let err;
        if ((err = validateString(name, 'テナント名', 255))) return err;
        return await cloudAccessManager.getTenantByName(name);
    });

    // クラウド: テナント削除
    cloudHandler('cloud-delete-tenant', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return await cloudAccessManager.deleteTenant(tenantId);
    });

    // クラウド: 実身一覧取得
    cloudHandler('cloud-list-real-objects', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return await cloudAccessManager.listRealObjects(tenantId);
    });

    // クラウド: テナントメンバー一覧
    cloudHandler('cloud-list-tenant-members', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return await cloudAccessManager.listTenantMembers(tenantId);
    });

    // クラウド: テナントメンバー追加
    cloudHandler('cloud-add-tenant-member', async (event, { tenantId, email, role }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateString(email, 'メールアドレス', 254))) return err;
        if ((err = validateEnum(role, 'ロール', ['admin', 'member', 'readonly']))) return err;
        return await cloudAccessManager.addTenantMember(tenantId, email, role);
    });

    // クラウド: テナントメンバー削除
    cloudHandler('cloud-remove-tenant-member', async (event, { tenantId, userId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(userId, 'userId'))) return err;
        return await cloudAccessManager.removeTenantMember(tenantId, userId);
    });

    // クラウド: 実身アップロード
    cloudHandler('cloud-upload-real-object', async (event, { tenantId, realObject, files }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateRealObjectId(realObject))) return err;
        return await cloudAccessManager.uploadRealObject(tenantId, realObject, convertFilesToBuffers(files));
    });

    // クラウド: 楽観的排他制御付き実身アップロード
    cloudHandler('cloud-upload-real-object-versioned', async (event, { tenantId, realObject, files, expectedVersion }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateRealObjectId(realObject))) return err;
        if ((err = validateVersion(expectedVersion, 'expectedVersion', 0))) return err;
        return await cloudAccessManager.uploadRealObjectVersioned(tenantId, realObject, convertFilesToBuffers(files), expectedVersion);
    });

    // クラウド: 実身ダウンロード
    cloudHandler('cloud-download-real-object', async (event, { tenantId, realId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        return await cloudAccessManager.downloadRealObject(tenantId, realId);
    });

    // クラウド: 個別ファイルダウンロード
    cloudHandler('cloud-download-file', async (event, { tenantId, realId, fileName }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        if ((err = validateString(fileName, 'ファイル名'))) return err;
        return await cloudAccessManager.downloadFile(tenantId, realId, fileName);
    });

    // クラウド: 実身削除
    cloudHandler('cloud-delete-real-object', async (event, { tenantId, realId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        return await cloudAccessManager.deleteRealObject(tenantId, realId);
    });

    // クラウド: 複数実身メタデータ一括取得
    cloudHandler('cloud-get-real-objects-metadata', async (event, { tenantId, realIds }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if (!Array.isArray(realIds) || !realIds.every(isValidUUID)) {
            return { success: false, error: '無効なrealIds形式です' };
        }
        return await cloudAccessManager.getRealObjectsMetadata(tenantId, realIds);
    });

    // クラウド: 実身とその子孫を再帰的に削除
    cloudHandler('cloud-delete-real-object-with-children', async (event, { tenantId, realId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        return await cloudAccessManager.deleteRealObjectWithChildren(tenantId, realId);
    });

    // クラウド: 共有一覧取得
    cloudHandler('cloud-list-shares', async (event, { objectId }) => {
        let err;
        if ((err = validateUUID(objectId, 'objectId'))) return err;
        return await cloudAccessManager.listShares(objectId);
    });

    // クラウド: 共有作成
    cloudHandler('cloud-create-share', async (event, { objectId, email, permission }) => {
        let err;
        if ((err = validateUUID(objectId, 'objectId'))) return err;
        if ((err = validateString(email, 'メールアドレス', 254))) return err;
        if ((err = validateEnum(permission, '権限', ['read', 'write', 'admin']))) return err;
        return await cloudAccessManager.createShare(objectId, email, permission);
    });

    // クラウド: 共有削除
    cloudHandler('cloud-delete-share', async (event, { shareId }) => {
        let err;
        if ((err = validateUUID(shareId, 'shareId'))) return err;
        return await cloudAccessManager.deleteShare(shareId);
    });

    // クラウド: バージョン管理付き実身保存
    cloudHandler('cloud-save-real-object-with-version', async (event, { tenantId, realObject, files, expectedVersion }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateRealObjectId(realObject))) return err;
        if ((err = validateVersion(expectedVersion, 'expectedVersion', 0))) return err;
        return await cloudAccessManager.saveRealObjectWithVersion(tenantId, realObject, files, expectedVersion);
    });

    // クラウド: バージョン履歴取得
    cloudHandler('cloud-get-version-history', async (event, { tenantId, realId, limit }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        return await cloudAccessManager.getVersionHistory(tenantId, realId, limit);
    });

    // クラウド: バージョンファイルダウンロード（復元用）
    cloudHandler('cloud-download-version-files', async (event, { tenantId, realId, version }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        if ((err = validateVersion(version, 'バージョン番号', 1))) return err;
        return await cloudAccessManager.downloadVersionFiles(tenantId, realId, version);
    });

    // クラウド: バージョン差分取得
    cloudHandler('cloud-get-version-diff', async (event, { tenantId, realId, version }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        if ((err = validateUUID(realId, 'realId'))) return err;
        if ((err = validateVersion(version, 'バージョン番号', 1))) return err;
        return await cloudAccessManager.getVersionDiff(tenantId, realId, version);
    });

    // クラウド: テナント容量情報取得
    cloudHandler('cloud-get-tenant-quota', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return await cloudAccessManager.getTenantQuota(tenantId);
    });

    // クラウド: 自分に共有された実身一覧
    cloudHandler('cloud-list-shared-with-me', async () => {
        return await cloudAccessManager.listSharedWithMe();
    });

    // クラウド: リアルタイム購読
    cloudHandler('cloud-subscribe-tenant', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return cloudAccessManager.subscribeToTenant(tenantId, (payload) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) {
                win.webContents.send('cloud-realtime-event', payload);
            }
        });
    });

    // クラウド: リアルタイム購読解除
    cloudHandler('cloud-unsubscribe-tenant', async (event, { tenantId }) => {
        let err;
        if ((err = validateUUID(tenantId, 'tenantId'))) return err;
        return cloudAccessManager.unsubscribeFromTenant(tenantId);
    });
}

module.exports = { registerCloudIpcHandlers };
