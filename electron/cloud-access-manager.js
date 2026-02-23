/**
 * CloudAccessManager - Supabase クラウドアクセス管理
 * Net-BTRON クラウド実身共有機能のバックエンド通信を担当
 */

const crypto = require('crypto');
const DiffMatchPatch = require('diff-match-patch');
const { getLogger } = require('./logger.cjs');
const logger = getLogger('CloudAccessManager');

// M-8: ファイルアップロードサイズ上限（Supabaseバケット制限と同値）
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

class CloudAccessManager {
    constructor() {
        this._supabase = null;
        this._config = null;
        this._session = null;
        this._subscriptions = new Map();
        this._sessionFilePath = null;  // main.jsから設定される
        // M-7: クライアント側レートリミッター（ブルートフォース攻撃緩和）
        // LO-3: signIn/signUp/lookupUser のレートリミットキーを分離
        this._rateLimiter = {
            signIn: { count: 0, resetAt: 0, limit: 5, windowMs: 60000 },
            signUp: { count: 0, resetAt: 0, limit: 5, windowMs: 60000 },
            lookupUser: { count: 0, resetAt: 0, limit: 10, windowMs: 60000 }
        };
    }

    /**
     * M-7: レートリミットチェック
     * @param {string} key - レートリミットキー
     * @returns {boolean} 制限内ならtrue
     */
    _checkRateLimit(key) {
        const limiter = this._rateLimiter[key];
        if (!limiter) return true;
        const now = Date.now();
        if (now > limiter.resetAt) {
            limiter.count = 0;
            limiter.resetAt = now + limiter.windowMs;
        }
        limiter.count++;
        return limiter.count <= limiter.limit;
    }

    /**
     * Supabase Client を初期化
     * @param {Object} config - { url: string, anonKey: string }
     * @returns {{ success: boolean, error?: string }}
     */
    async initialize(config) {
        try {
            if (!config || !config.url || !config.anonKey) {
                return { success: false, error: '接続設定が不足しています (url, anonKey)' };
            }

            // @supabase/supabase-js を動的ロード
            const { createClient } = require('@supabase/supabase-js');

            // セッション永続化: safeStorage暗号化 + ファイルベースのカスタムストレージ
            const storage = this._createStorageAdapter();
            const persistSession = storage !== null;

            this._supabase = createClient(config.url, config.anonKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: persistSession,
                    flowType: 'implicit',
                    ...(storage ? { storage } : {})
                }
            });
            this._config = config;
            logger.info('Supabase Client 初期化完了:', config.url, 'persistSession:', persistSession);
            return { success: true };
        } catch (error) {
            logger.error('Supabase Client 初期化エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 接続状態を確認
     * @returns {boolean}
     */
    isConnected() {
        return this._supabase !== null;
    }

    // =========================================================
    // 認証
    // =========================================================

    /**
     * メールアドレスとパスワードでログイン
     * @param {string} email
     * @param {string} password
     * @returns {{ success: boolean, user?: Object, error?: string }}
     */
    async signIn(email, password) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です。先に initialize() を呼んでください' };
        }
        // M-7: レートリミットチェック
        if (!this._checkRateLimit('signIn')) {
            return { success: false, error: 'ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。' };
        }
        try {
            logger.info('signIn: ログイン開始, email:', email);
            const { data, error } = await this._supabase.auth.signInWithPassword({
                email,
                password
            });
            if (error) {
                logger.error('signIn: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            this._session = data.session;
            logger.info('ログイン成功:', data.user.email);
            return {
                success: true,
                user: {
                    id: data.user.id,
                    email: data.user.email
                }
            };
        } catch (error) {
            logger.error('ログインエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * OAuth認証用のURLを取得（ブラウザリダイレクトはスキップ）
     * @param {string} provider - OAuthプロバイダ名（'google'等）
     * @param {string} [redirectUrl] - カスタムリダイレクトURL（ローカルHTTPサーバー等）
     * @returns {{ success: boolean, url?: string, error?: string }}
     */
    async signInWithOAuth(provider, redirectUrl) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です。先に initialize() を呼んでください' };
        }
        // M-7: レートリミットチェック
        if (!this._checkRateLimit('signIn')) {
            return { success: false, error: 'ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。' };
        }
        try {
            const redirectTo = redirectUrl || (this._config.url + '/auth/v1/callback');
            const { data, error } = await this._supabase.auth.signInWithOAuth({
                provider,
                options: {
                    skipBrowserRedirect: true,
                    redirectTo
                }
            });
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, url: data.url };
        } catch (error) {
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * OAuthコールバックURLからトークンを抽出してセッションを確立
     * @param {string} accessToken - アクセストークン
     * @param {string} refreshToken - リフレッシュトークン
     * @returns {{ success: boolean, user?: Object, error?: string }}
     */
    async setSessionFromTokens(accessToken, refreshToken) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('setSessionFromTokens: セッション確立開始');
            const { data, error } = await this._supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
            if (error) {
                logger.error('setSessionFromTokens: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            this._session = data.session;
            logger.info('setSessionFromTokens: セッション確立成功:', data.user.email);
            return {
                success: true,
                user: {
                    id: data.user.id,
                    email: data.user.email
                }
            };
        } catch (error) {
            logger.error('セッション確立エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 新規ユーザー登録（メール/パスワード）
     * @param {string} email
     * @param {string} password
     * @returns {{ success: boolean, user?: Object, error?: string }}
     */
    async signUp(email, password) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です。先に initialize() を呼んでください' };
        }
        // LO-3: signUp専用のレートリミットキーを使用
        if (!this._checkRateLimit('signUp')) {
            return { success: false, error: '登録試行回数が上限に達しました。しばらく待ってから再試行してください。' };
        }
        try {
            logger.info('signUp: ユーザー登録開始, email:', email);
            const { data, error } = await this._supabase.auth.signUp({
                email,
                password
            });
            if (error) {
                logger.error('signUp: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            this._session = data.session;
            logger.info('ユーザー登録成功:', data.user.email);
            return {
                success: true,
                user: {
                    id: data.user.id,
                    email: data.user.email
                }
            };
        } catch (error) {
            logger.error('ユーザー登録エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * ログアウト
     * @returns {{ success: boolean, error?: string }}
     */
    async signOut() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            // 全リアルタイム購読を解除
            for (const [key, channel] of this._subscriptions) {
                this._supabase.removeChannel(channel);
            }
            this._subscriptions.clear();

            const { error } = await this._supabase.auth.signOut();
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }

            // セッションファイルの明示的削除
            this._cleanupSessionFiles();

            this._session = null;
            logger.info('ログアウト完了');
            return { success: true };
        } catch (error) {
            logger.error('ログアウトエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 現在のセッション情報を取得
     * @returns {{ success: boolean, session?: Object, user?: Object, error?: string }}
     */
    async getSession() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('getSession: セッション情報取得開始');
            const { data, error } = await this._supabase.auth.getSession();
            if (error) {
                logger.error('getSession: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            if (!data.session) {
                logger.info('getSession: セッションなし');
                return { success: true, session: null, user: null };
            }
            this._session = data.session;
            return {
                success: true,
                session: { authenticated: true },
                user: {
                    id: data.session.user.id,
                    email: data.session.user.email
                }
            };
        } catch (error) {
            logger.error('セッション取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // 招待管理
    // =========================================================

    /**
     * 招待を作成（テナントオーナー用）
     * @param {string} tenantId - テナントID
     * @param {string} email - 招待先メールアドレス（任意、空文字で制限なし）
     * @param {string} role - ロール（'admin'|'member'|'readonly'）
     * @returns {{ success: boolean, invite?: Object, error?: string }}
     */
    async createInvite(tenantId, email, role) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('createInvite: 招待作成開始, tenantId:', tenantId, 'email:', email, 'role:', role);
            const { data, error } = await this._supabase
                .rpc('create_invite', {
                    p_tenant_id: tenantId,
                    p_email: email || '',
                    p_role: role
                });
            if (error) {
                logger.error('createInvite: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            // HI-4: トークンをマスクしてログ出力（平文での記録を防止）
            logger.info('createInvite: 招待作成成功, token:', data.token ? data.token.substring(0, 8) + '...' : '(none)');
            return { success: true, invite: data };
        } catch (error) {
            logger.error('招待作成エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * トークンで招待情報を取得（未認証でも可能）
     * @param {string} token - 招待トークン
     * @returns {{ success: boolean, invite?: Object, error?: string }}
     */
    async getInviteByToken(token) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('getInviteByToken: 招待情報取得開始');
            const { data, error } = await this._supabase
                .rpc('get_invite_by_token', { p_token: token });
            if (error) {
                logger.error('getInviteByToken: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            if (!data || data.length === 0) {
                return { success: false, error: '招待が見つかりません' };
            }
            return { success: true, invite: data[0] };
        } catch (error) {
            logger.error('招待情報取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 招待を消費してテナントに参加
     * @param {string} token - 招待トークン
     * @returns {{ success: boolean, error?: string }}
     */
    async consumeInvite(token) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('consumeInvite: 招待消費開始');
            const { error } = await this._supabase
                .rpc('consume_invite', { p_token: token });
            if (error) {
                logger.error('consumeInvite: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('consumeInvite: 招待消費成功（テナント参加完了）');
            return { success: true };
        } catch (error) {
            logger.error('招待消費エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 招待一覧を取得（テナントオーナー用）
     * @param {string} tenantId - テナントID
     * @returns {{ success: boolean, invites?: Array, error?: string }}
     */
    async listInvites(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('listInvites: 招待一覧取得開始, tenantId:', tenantId);
            const { data, error } = await this._supabase
                .rpc('list_invites', { p_tenant_id: tenantId });
            if (error) {
                logger.error('listInvites: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('listInvites: 取得成功, 件数:', (data || []).length);
            return { success: true, invites: data || [] };
        } catch (error) {
            logger.error('招待一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 招待を取消（テナントオーナー用）
     * @param {string} inviteId - 招待ID
     * @returns {{ success: boolean, error?: string }}
     */
    async revokeInvite(inviteId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('revokeInvite: 招待取消開始, inviteId:', inviteId);
            const { error } = await this._supabase
                .rpc('revoke_invite', { p_invite_id: inviteId });
            if (error) {
                logger.error('revokeInvite: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('revokeInvite: 招待取消成功');
            return { success: true };
        } catch (error) {
            logger.error('招待取消エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // システムロール管理
    // =========================================================

    /**
     * 自分のプロフィール（system_role含む）を取得
     * @returns {{ success: boolean, profile?: Object, error?: string }}
     */
    async getMyProfile() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data: { user } } = await this._supabase.auth.getUser();
            if (!user) {
                return { success: false, error: '未認証です' };
            }
            const { data, error } = await this._supabase
                .from('profiles')
                .select('id, email, display_name, system_role')
                .eq('id', user.id)
                .single();
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, profile: data };
        } catch (error) {
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * ユーザーのシステムロールを変更（system_adminのみ）
     * @param {string} userId - 対象ユーザーID
     * @param {string} role - 新しいロール
     * @returns {{ success: boolean, error?: string }}
     */
    async updateUserSystemRole(userId, role) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { error } = await this._supabase
                .rpc('update_user_system_role', { p_user_id: userId, p_role: role });
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 全ユーザー一覧を取得（system_admin用）
     * @returns {{ success: boolean, users?: Array, error?: string }}
     */
    async listUsers() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data, error } = await this._supabase
                .from('profiles')
                .select('id, email, display_name, system_role')
                .order('email', { ascending: true });
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, users: data || [] };
        } catch (error) {
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // テナント操作
    // =========================================================

    /**
     * ユーザーが所属するテナント一覧を取得
     * @returns {{ success: boolean, tenants?: Array, error?: string }}
     */
    async getTenants() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('getTenants: テナント一覧取得開始');
            const { data, error } = await this._supabase
                .from('tenants')
                .select('id, name, owner_id, visibility, created_at');
            if (error) {
                logger.error('getTenants: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('getTenants: 取得成功, 件数:', (data || []).length);
            return { success: true, tenants: data };
        } catch (error) {
            logger.error('テナント一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントを作成（RPC関数で原子的にオーナーメンバー追加）
     * @param {string} name - テナント名
     * @param {string} [visibility='private'] - 公開範囲 ('private' or 'internal')
     * @returns {{ success: boolean, tenant?: Object, error?: string }}
     */
    async createTenant(name, visibility = 'private') {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('createTenant: テナント作成開始, name:', name, ', visibility:', visibility);
            const { data, error } = await this._supabase
                .rpc('create_tenant_with_owner', { p_name: name, p_visibility: visibility });
            if (error) {
                logger.error('createTenant: エラー:', error.message, error.code, error.details);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('createTenant: 作成成功, data:', JSON.stringify(data));
            return { success: true, tenant: data };
        } catch (error) {
            logger.error('テナント作成エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントの公開範囲を変更（オーナーのみ）
     * @param {string} tenantId - テナントID
     * @param {string} visibility - 公開範囲 ('private' or 'internal')
     * @returns {{ success: boolean, tenant?: Object, error?: string }}
     */
    async updateTenantVisibility(tenantId, visibility) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('updateTenantVisibility: 公開範囲変更, tenantId:', tenantId, ', visibility:', visibility);
            const { data, error } = await this._supabase
                .rpc('update_tenant_visibility', { p_tenant_id: tenantId, p_visibility: visibility });
            if (error) {
                logger.error('updateTenantVisibility: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('updateTenantVisibility: 変更成功');
            return { success: true, tenant: data };
        } catch (error) {
            logger.error('テナント公開範囲変更エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナント名でテナント情報を取得（匿名参照のVisibility確認用）
     * @param {string} name - テナント名
     * @returns {{ success: boolean, tenant?: Object, error?: string }}
     */
    async getTenantByName(name) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('getTenantByName: テナント名で検索, name:', name);
            const { data, error } = await this._supabase
                .from('tenants')
                .select('id, name, owner_id, visibility, created_at')
                .eq('name', name)
                .maybeSingle();
            if (error) {
                logger.error('getTenantByName: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            if (!data) {
                return { success: false, error: 'テナントが見つかりません' };
            }
            logger.info('getTenantByName: 取得成功, visibility:', data.visibility);
            return { success: true, tenant: data };
        } catch (error) {
            logger.error('テナント名検索エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // テナントメンバー管理
    // =========================================================

    /**
     * テナントメンバー一覧を取得
     * @param {string} tenantId
     * @returns {{ success: boolean, members?: Array, error?: string }}
     */
    async listTenantMembers(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('listTenantMembers: メンバー一覧取得開始, tenantId:', tenantId);
            const { data, error } = await this._supabase
                .from('tenant_members')
                .select('tenant_id, user_id, role, created_at')
                .eq('tenant_id', tenantId);
            if (error) {
                logger.error('listTenantMembers: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('listTenantMembers: 取得成功, 件数:', (data || []).length);

            // プロフィール情報を結合
            const userIds = data.map(m => m.user_id);
            const { data: profiles } = await this._supabase
                .from('profiles')
                .select('id, email, display_name')
                .in('id', userIds);

            const profileMap = new Map((profiles || []).map(p => [p.id, p]));
            const members = data.map(m => ({
                ...m,
                email: profileMap.get(m.user_id)?.email || '',
                display_name: profileMap.get(m.user_id)?.display_name || ''
            }));

            return { success: true, members };
        } catch (error) {
            logger.error('メンバー一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントにメンバーを追加
     * @param {string} tenantId
     * @param {string} email - 追加するユーザーのメールアドレス
     * @param {string} role - 'admin' | 'member' | 'readonly'
     * @returns {{ success: boolean, error?: string }}
     */
    async addTenantMember(tenantId, email, role) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        // M-7: レートリミットチェック（メールアドレス列挙攻撃の緩和）
        if (!this._checkRateLimit('lookupUser')) {
            return { success: false, error: '操作回数が上限に達しました。しばらく待ってから再試行してください。' };
        }
        try {
            // N-3: 招待/共有用の専用関数を使用（テナント外ユーザーも検索可能、admin権限必要）
            const { data: users, error: lookupError } = await this._supabase
                .rpc('lookup_user_for_invite', { p_email: email });
            if (lookupError) {
                // lookup_user_for_invite未デプロイ時はlookup_user_by_emailにフォールバック
                if (lookupError.message && (lookupError.message.includes('function') || lookupError.message.includes('rpc'))) {
                    logger.warn('lookup_user_for_invite未デプロイ、lookup_user_by_emailにフォールバック');
                    const { data: fallbackUsers, error: fbError } = await this._supabase
                        .rpc('lookup_user_by_email', { p_email: email });
                    if (fbError) {
                        return { success: false, error: this._sanitizeErrorMessage(fbError.message) };
                    }
                    if (!fallbackUsers || fallbackUsers.length === 0) {
                        return { success: false, error: 'メンバーの追加に失敗しました。メールアドレスを確認してください' };
                    }
                    const userId = fallbackUsers[0].user_id;
                    const { error } = await this._supabase
                        .from('tenant_members')
                        .insert({ tenant_id: tenantId, user_id: userId, role });
                    if (error) {
                        if (error.code === '23505') {
                            return { success: false, error: 'このユーザーは既にメンバーです' };
                        }
                        return { success: false, error: this._sanitizeErrorMessage(error.message) };
                    }
                    return { success: true };
                }
                return { success: false, error: this._sanitizeErrorMessage(lookupError.message) };
            }
            if (!users || users.length === 0) {
                // H-6: 統一レスポンス（メールアドレス列挙攻撃防止）
                return { success: false, error: 'メンバーの追加に失敗しました。メールアドレスを確認してください' };
            }

            const userId = users[0].user_id;
            const { error } = await this._supabase
                .from('tenant_members')
                .insert({ tenant_id: tenantId, user_id: userId, role });
            if (error) {
                if (error.code === '23505') {
                    return { success: false, error: 'このユーザーは既にメンバーです' };
                }
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true };
        } catch (error) {
            logger.error('メンバー追加エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントからメンバーを削除
     * @param {string} tenantId
     * @param {string} userId
     * @returns {{ success: boolean, error?: string }}
     */
    async removeTenantMember(tenantId, userId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { error } = await this._supabase
                .from('tenant_members')
                .delete()
                .eq('tenant_id', tenantId)
                .eq('user_id', userId);
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true };
        } catch (error) {
            logger.error('メンバー削除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // 実身操作（CRUD）
    // =========================================================

    /**
     * テナント内の実身一覧を取得
     * @param {string} tenantId
     * @returns {{ success: boolean, realObjects?: Array, error?: string }}
     */
    async listRealObjects(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('listRealObjects: 実身一覧取得開始, tenantId:', tenantId);
            const { data, error } = await this._supabase
                .from('real_objects')
                .select('id, tenant_id, owner_id, name, ref_count, record_count, metadata, version, created_at, updated_at')
                .eq('tenant_id', tenantId)
                .order('updated_at', { ascending: false });
            if (error) {
                logger.error('listRealObjects: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('listRealObjects: 取得成功, 件数:', (data || []).length);
            return { success: true, realObjects: data };
        } catch (error) {
            logger.error('実身一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身メタデータをアップロード（DB登録）
     * @param {string} tenantId
     * @param {Object} metadata - { id, name, refCount, recordCount, ... }
     * @returns {{ success: boolean, realObject?: Object, error?: string }}
     */
    async uploadRealObjectMetadata(tenantId, metadata) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('uploadRealObjectMetadata: メタデータアップロード開始, tenantId:', tenantId, 'name:', metadata.name);
            const { data: sessionData } = await this._supabase.auth.getSession();
            if (!sessionData.session) {
                return { success: false, error: '未ログインです' };
            }

            const metadataJsonb = {
                makeDate: metadata.makeDate,
                updateDate: metadata.updateDate,
                accessDate: metadata.accessDate,
                applist: metadata.applist,
                window: metadata.window
            };
            // 子実身の場合、parent_idを設定
            if (metadata.parent_id) {
                metadataJsonb.parent_id = metadata.parent_id;
            }

            const row = {
                id: metadata.id || metadata.realId,
                tenant_id: tenantId,
                owner_id: sessionData.session.user.id,
                name: metadata.name,
                ref_count: metadata.refCount || metadata.ref_count || 1,
                record_count: metadata.recordCount || metadata.record_count || 1,
                metadata: metadataJsonb
                // version は含めない: INSERT時はDB DEFAULT(1)、UPDATE時は既存値を維持
            };

            const { data, error } = await this._supabase
                .from('real_objects')
                .upsert(row, { onConflict: 'id' })
                .select()
                .single();
            if (error) {
                logger.error('uploadRealObjectMetadata: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('uploadRealObjectMetadata: 成功, id:', data.id);
            return { success: true, realObject: data };
        } catch (error) {
            logger.error('実身メタデータアップロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 楽観的排他制御付き実身メタデータ更新
     * @param {string} realId
     * @param {Object} metadata - { name, refCount, recordCount, ... }
     * @param {number} expectedVersion - 期待するバージョン番号
     * @returns {{ success: boolean, realObject?: Object, error?: string, conflict?: boolean }}
     */
    async updateRealObjectVersioned(realId, metadata, expectedVersion) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data, error } = await this._supabase
                .rpc('update_real_object_versioned', {
                    p_real_id: realId,
                    p_name: metadata.name,
                    p_ref_count: metadata.refCount || metadata.ref_count || 1,
                    p_record_count: metadata.recordCount || metadata.record_count || 1,
                    p_metadata: (() => {
                        const metaJsonb = {
                            makeDate: metadata.makeDate,
                            updateDate: metadata.updateDate || new Date().toISOString(),
                            accessDate: metadata.accessDate,
                            applist: metadata.applist,
                            window: metadata.window
                        };
                        if (metadata.parent_id) {
                            metaJsonb.parent_id = metadata.parent_id;
                        }
                        return metaJsonb;
                    })(),
                    p_expected_version: expectedVersion
                });
            if (error) {
                if (error.message && error.message.includes('VERSION_CONFLICT')) {
                    return { success: false, error: 'バージョン競合が発生しました', conflict: true };
                }
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            if (!data || data.length === 0) {
                return { success: false, error: 'バージョン競合が発生しました', conflict: true };
            }
            return { success: true, realObject: data[0] };
        } catch (error) {
            logger.error('実身バージョン管理更新エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身ファイルをStorage にアップロード
     * @param {string} tenantId
     * @param {string} realId
     * @param {string} fileName - ファイル名（例: "{realId}_0.xtad"）
     * @param {Buffer|Uint8Array} fileData - ファイルデータ
     * @param {string} contentType - MIME type
     * @returns {{ success: boolean, path?: string, error?: string }}
     */
    async uploadFile(tenantId, realId, fileName, fileData, contentType) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            // M-8: ファイルサイズチェック
            const dataSize = fileData ? (fileData.length || fileData.byteLength || 0) : 0;
            if (dataSize > MAX_FILE_SIZE) {
                return { success: false, error: `ファイルサイズが制限（${MAX_FILE_SIZE / 1024 / 1024}MB）を超えています` };
            }
            this._validatePathComponent(tenantId, 'tenantId');
            this._validatePathComponent(realId, 'realId');
            this._validatePathComponent(fileName, 'fileName');
            const storagePath = `${tenantId}/${realId}/current/${fileName}`;
            // プレーンArrayをBufferに変換（fetch APIがArray.toString()で文字列化するのを防止）
            const uploadData = Array.isArray(fileData) ? Buffer.from(fileData) : fileData;
            logger.info('uploadFile: アップロード開始, path:', storagePath, 'size:', uploadData ? uploadData.length : 0);
            const { data, error } = await this._supabase.storage
                .from('xtad-files')
                .upload(storagePath, uploadData, {
                    contentType: contentType || 'application/octet-stream',
                    upsert: true
                });
            if (error) {
                logger.error('uploadFile: エラー:', storagePath, error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('uploadFile: 成功, path:', data.path);
            return { success: true, path: data.path };
        } catch (error) {
            logger.error('ファイルアップロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身ファイルをStorageからダウンロード
     * @param {string} tenantId
     * @param {string} realId
     * @param {string} fileName
     * @returns {{ success: boolean, data?: ArrayBuffer, error?: string }}
     */
    async downloadFile(tenantId, realId, fileName) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            this._validatePathComponent(tenantId, 'tenantId');
            this._validatePathComponent(realId, 'realId');
            this._validatePathComponent(fileName, 'fileName');
            const storagePath = `${tenantId}/${realId}/current/${fileName}`;
            logger.info('downloadFile: ダウンロード開始, path:', storagePath);
            const { data, error } = await this._supabase.storage
                .from('xtad-files')
                .download(storagePath);
            if (error) {
                logger.error('downloadFile: エラー:', storagePath, error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('downloadFile: 成功, path:', storagePath);
            // Blob を ArrayBuffer に変換
            const arrayBuffer = await data.arrayBuffer();
            return { success: true, data: Array.from(new Uint8Array(arrayBuffer)) };
        } catch (error) {
            logger.error('ファイルダウンロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身を丸ごとアップロード（メタデータ + ファイル群）
     * @param {string} tenantId
     * @param {Object} realObject - { metadata, records }
     * @param {Object} files - { json: Buffer, xtad: Buffer, ico?: Buffer, images?: Array<{name, data}> }
     * @returns {{ success: boolean, realObject?: Object, error?: string }}
     */
    async uploadRealObject(tenantId, realObject, files) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const realId = realObject.metadata
                ? (realObject.metadata.realId || realObject.metadata.id)
                : (realObject.realId || realObject.id);
            logger.info('uploadRealObject: 実身アップロード開始, tenantId:', tenantId, 'realId:', realId);

            // 1. メタデータをDB登録
            const metaResult = await this.uploadRealObjectMetadata(tenantId,
                realObject.metadata || realObject);
            if (!metaResult.success) {
                return metaResult;
            }

            // 2. JSONファイルをアップロード
            if (files.json) {
                const jsonResult = await this.uploadFile(
                    tenantId, realId, `${realId}.json`, files.json, 'application/json'
                );
                if (!jsonResult.success) {
                    return jsonResult;
                }
            }

            // 3. XTADファイルをアップロード
            if (files.xtad) {
                const xtadResult = await this.uploadFile(
                    tenantId, realId, `${realId}_0.xtad`, files.xtad, 'application/xml'
                );
                if (!xtadResult.success) {
                    return xtadResult;
                }
            }

            // 4. アイコンファイルをアップロード（任意）
            if (files.ico) {
                const icoResult = await this.uploadFile(
                    tenantId, realId, `${realId}.ico`, files.ico, 'image/x-icon'
                );
                if (!icoResult.success) {
                    return icoResult;
                }
            }

            // 5. 画像ファイルをアップロード（任意）
            if (files.images && Array.isArray(files.images)) {
                for (const img of files.images) {
                    if (img.name && img.data) {
                        const imgResult = await this.uploadFile(
                            tenantId, realId, img.name, img.data, 'image/png'
                        );
                        if (!imgResult.success) {
                            logger.warn('画像アップロード失敗:', img.name, imgResult.error);
                        }
                    }
                }
            }

            return { success: true, realObject: metaResult.realObject };
        } catch (error) {
            logger.error('実身アップロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 楽観的排他制御付き実身アップロード
     * @param {string} tenantId
     * @param {Object} realObject - { id, name, ... }
     * @param {Object} files - { json, xtad, ico?, images? }
     * @param {number} expectedVersion - 期待するバージョン番号
     * @returns {{ success: boolean, realObject?: Object, error?: string, conflict?: boolean }}
     */
    async uploadRealObjectVersioned(tenantId, realObject, files, expectedVersion) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const realId = realObject.metadata
                ? (realObject.metadata.realId || realObject.metadata.id)
                : (realObject.realId || realObject.id);
            const metadata = realObject.metadata || realObject;

            // 1. バージョン管理付きメタデータ更新
            const metaResult = await this.updateRealObjectVersioned(
                realId, metadata, expectedVersion
            );
            if (!metaResult.success) {
                return metaResult;
            }

            // 2. ファイルアップロード（JSONは更新されたメタデータで再生成）
            if (files.xtad) {
                await this.uploadFile(tenantId, realId, `${realId}_0.xtad`, files.xtad, 'application/xml');
            }
            if (files.json) {
                await this.uploadFile(tenantId, realId, `${realId}.json`, files.json, 'application/json');
            }
            if (files.ico) {
                await this.uploadFile(tenantId, realId, `${realId}.ico`, files.ico, 'image/x-icon');
            }
            if (files.images && Array.isArray(files.images)) {
                for (const img of files.images) {
                    if (img.name && img.data) {
                        await this.uploadFile(tenantId, realId, img.name, img.data, 'image/png');
                    }
                }
            }

            return { success: true, realObject: metaResult.realObject };
        } catch (error) {
            logger.error('実身バージョン管理アップロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身を丸ごとダウンロード（メタデータ + ファイル群 + 画像）
     * @param {string} tenantId
     * @param {string} realId
     * @returns {{ success: boolean, metadata?: Object, files?: Object, error?: string }}
     */
    async downloadRealObject(tenantId, realId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('downloadRealObject: 実身ダウンロード開始, tenantId:', tenantId, 'realId:', realId);
            // 1. DBからメタデータ取得
            const { data: dbMeta, error: dbError } = await this._supabase
                .from('real_objects')
                .select('*')
                .eq('id', realId)
                .single();
            if (dbError) {
                logger.error('downloadRealObject: メタデータ取得エラー:', dbError.message);
                return { success: false, error: this._sanitizeErrorMessage(dbError.message) };
            }
            logger.info('downloadRealObject: メタデータ取得成功, name:', dbMeta.name);

            // 2. JSONファイルダウンロード
            const jsonResult = await this.downloadFile(tenantId, realId, `${realId}.json`);

            // 3. XTADファイルダウンロード
            const xtadResult = await this.downloadFile(tenantId, realId, `${realId}_0.xtad`);

            // 4. アイコンファイルダウンロード
            const icoResult = await this.downloadFile(tenantId, realId, `${realId}.ico`);

            // 5. 画像ファイルをリスト取得してダウンロード（current/ サブディレクトリから）
            const images = [];
            try {
                this._validatePathComponent(tenantId, 'tenantId');
                this._validatePathComponent(realId, 'realId');
                const storagePath = `${tenantId}/${realId}/current`;
                const { data: fileList } = await this._supabase.storage
                    .from('xtad-files')
                    .list(storagePath);
                if (fileList) {
                    const imageFiles = fileList.filter(f => f.name.endsWith('.png'));
                    for (const imgFile of imageFiles) {
                        const imgResult = await this.downloadFile(tenantId, realId, imgFile.name);
                        if (imgResult.success) {
                            images.push({ name: imgFile.name, data: imgResult.data });
                        }
                    }
                }
            } catch (imgError) {
                logger.warn('画像ファイルリスト取得失敗:', imgError.message);
            }

            return {
                success: true,
                metadata: dbMeta,
                files: {
                    json: jsonResult.success ? jsonResult.data : null,
                    xtad: xtadResult.success ? xtadResult.data : null,
                    ico: icoResult.success ? icoResult.data : null,
                    images: images
                }
            };
        } catch (error) {
            logger.error('実身ダウンロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身をサーバーから削除
     * @param {string} tenantId
     * @param {string} realId
     * @returns {{ success: boolean, error?: string }}
     */
    async deleteRealObject(tenantId, realId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('deleteRealObject: 実身削除開始, tenantId:', tenantId, 'realId:', realId);
            // 1. Storageからファイル削除（current/ + v{N}/ サブディレクトリ対応）
            const basePath = `${tenantId}/${realId}`;
            const { data: entries } = await this._supabase.storage
                .from('xtad-files')
                .list(basePath);

            if (entries && entries.length > 0) {
                const allFilePaths = [];
                for (const entry of entries) {
                    if (entry.id) {
                        // 直接ファイル（旧構造の互換用）
                        allFilePaths.push(`${basePath}/${entry.name}`);
                    } else {
                        // サブディレクトリ（current/, v1/, v2/, ...）
                        const { data: subFiles } = await this._supabase.storage
                            .from('xtad-files')
                            .list(`${basePath}/${entry.name}`);
                        if (subFiles && subFiles.length > 0) {
                            for (const sf of subFiles) {
                                allFilePaths.push(`${basePath}/${entry.name}/${sf.name}`);
                            }
                        }
                    }
                }
                if (allFilePaths.length > 0) {
                    await this._supabase.storage
                        .from('xtad-files')
                        .remove(allFilePaths);
                }
            }

            // 2. DBからメタデータ削除（sharesはCASCADEで自動削除）
            const { error } = await this._supabase
                .from('real_objects')
                .delete()
                .eq('id', realId);
            if (error) {
                logger.error('deleteRealObject: DB削除エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('deleteRealObject: 削除成功, realId:', realId);
            return { success: true };
        } catch (error) {
            logger.error('実身削除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントを削除する（Storage全ファイル + DB全関連データ）
     * @param {string} tenantId - 削除対象のテナントID
     * @returns {{ success: boolean, deleted?: number, error?: string }}
     */
    async deleteTenant(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('deleteTenant: テナント削除開始, tenantId:', tenantId);
            // 1. テナント内の全実身をリスト取得
            const listResult = await this.listRealObjects(tenantId);
            const realObjects = (listResult.success && listResult.realObjects) ? listResult.realObjects : [];
            logger.info('deleteTenant: 実身数:', realObjects.length);

            // 2. 各実身のStorageファイルを削除
            let storageDeleted = 0;
            for (const ro of realObjects) {
                const basePath = `${tenantId}/${ro.id}`;
                try {
                    const { data: entries } = await this._supabase.storage
                        .from('xtad-files')
                        .list(basePath);

                    if (entries && entries.length > 0) {
                        const allPaths = [];
                        for (const entry of entries) {
                            if (entry.id) {
                                allPaths.push(`${basePath}/${entry.name}`);
                            } else {
                                const { data: subFiles } = await this._supabase.storage
                                    .from('xtad-files')
                                    .list(`${basePath}/${entry.name}`);
                                if (subFiles && subFiles.length > 0) {
                                    for (const sf of subFiles) {
                                        allPaths.push(`${basePath}/${entry.name}/${sf.name}`);
                                    }
                                }
                            }
                        }
                        if (allPaths.length > 0) {
                            await this._supabase.storage
                                .from('xtad-files')
                                .remove(allPaths);
                            storageDeleted += allPaths.length;
                        }
                    }
                } catch (e) {
                    logger.warn('deleteTenant: Storage削除失敗 realId:', ro.id, e.message);
                }
            }

            // 3. real_object_versionsを先に削除（tenant_id FKにCASCADE未設定のため）
            const { error: versionsError } = await this._supabase
                .from('real_object_versions')
                .delete()
                .eq('tenant_id', tenantId);
            if (versionsError) {
                logger.warn('deleteTenant: real_object_versions削除エラー:', versionsError.message);
            }

            // 4. DBからテナント削除（CASCADE で残り関連レコード自動削除）
            const { error } = await this._supabase
                .from('tenants')
                .delete()
                .eq('id', tenantId);

            if (error) {
                logger.error('deleteTenant: DB削除エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }

            logger.info('deleteTenant: テナント削除完了, 実身:', realObjects.length, ', Storage:', storageDeleted);
            return { success: true, deleted: realObjects.length, storageDeleted };
        } catch (error) {
            logger.error('テナント削除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // 多階層実身操作
    // =========================================================

    /**
     * 複数実身のメタデータを一括取得（子実身のメタデータ読み込み用）
     * @param {string} tenantId
     * @param {string[]} realIds - 取得対象の実身ID配列
     * @returns {{ success: boolean, realObjects?: Array, error?: string }}
     */
    async getRealObjectsMetadata(tenantId, realIds) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        if (!realIds || realIds.length === 0) {
            return { success: true, realObjects: [] };
        }
        try {
            logger.info('getRealObjectsMetadata: 一括取得開始, tenantId:', tenantId, '件数:', realIds.length);
            const { data, error } = await this._supabase
                .from('real_objects')
                .select('*')
                .eq('tenant_id', tenantId)
                .in('id', realIds);
            if (error) {
                logger.error('getRealObjectsMetadata: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('getRealObjectsMetadata: 取得成功, 件数:', (data || []).length);
            return { success: true, realObjects: data || [] };
        } catch (error) {
            logger.error('一括メタデータ取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 親実身IDで子実身一覧を取得（metadata.parent_idで検索）
     * @param {string} tenantId
     * @param {string} parentRealId
     * @returns {{ success: boolean, childObjects?: Array, error?: string }}
     */
    async listChildRealObjects(tenantId, parentRealId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('listChildRealObjects: 子実身検索, parentId:', parentRealId);
            const { data, error } = await this._supabase
                .from('real_objects')
                .select('*')
                .eq('tenant_id', tenantId)
                .contains('metadata', { parent_id: parentRealId });
            if (error) {
                logger.error('listChildRealObjects: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('listChildRealObjects: 子実身', (data || []).length, '件');
            return { success: true, childObjects: data || [] };
        } catch (error) {
            logger.error('子実身一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身と全子孫を再帰的に削除（metadata.parent_idを使用）
     * @param {string} tenantId
     * @param {string} realId - 削除対象の親実身ID
     * @returns {{ success: boolean, deleted?: number, error?: string }}
     */
    async deleteRealObjectWithChildren(tenantId, realId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('deleteRealObjectWithChildren: カスケード削除開始, realId:', realId);

            // BFSで全子孫IDを収集
            const allDescendantIds = [];
            const processed = new Set();
            const queue = [realId];
            processed.add(realId);

            while (queue.length > 0) {
                const currentId = queue.shift();
                const childResult = await this.listChildRealObjects(tenantId, currentId);
                if (childResult.success && childResult.childObjects) {
                    for (const child of childResult.childObjects) {
                        if (!processed.has(child.id)) {
                            processed.add(child.id);
                            allDescendantIds.push(child.id);
                            queue.push(child.id);
                        }
                    }
                }
            }

            // 子孫を先に削除（葉から順に）
            let deleted = 0;
            for (const descendantId of allDescendantIds.reverse()) {
                const result = await this.deleteRealObject(tenantId, descendantId);
                if (result.success) deleted++;
            }

            // 最後に親を削除
            const parentResult = await this.deleteRealObject(tenantId, realId);
            if (parentResult.success) deleted++;

            logger.info('deleteRealObjectWithChildren: 削除完了, 合計', deleted, '件');
            return { success: true, deleted };
        } catch (error) {
            logger.error('カスケード削除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // バージョン管理
    // =========================================================

    /**
     * バージョン付きでファイルをStorageにアップロード（v{N}/ パスに保存）
     * @param {string} tenantId
     * @param {string} realId
     * @param {number} version - バージョン番号
     * @param {string} fileName
     * @param {Buffer|Uint8Array} fileData
     * @param {string} contentType
     * @returns {{ success: boolean, path?: string, error?: string }}
     */
    async uploadFileVersioned(tenantId, realId, version, fileName, fileData, contentType) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            // M-8: ファイルサイズチェック
            const dataSize = fileData ? (fileData.length || fileData.byteLength || 0) : 0;
            if (dataSize > MAX_FILE_SIZE) {
                return { success: false, error: `ファイルサイズが制限（${MAX_FILE_SIZE / 1024 / 1024}MB）を超えています` };
            }
            this._validatePathComponent(tenantId, 'tenantId');
            this._validatePathComponent(realId, 'realId');
            this._validatePathComponent(String(version), 'version');
            this._validatePathComponent(fileName, 'fileName');
            const storagePath = `${tenantId}/${realId}/v${version}/${fileName}`;
            // プレーンArrayをBufferに変換（fetch APIがArray.toString()で文字列化するのを防止）
            const uploadData = Array.isArray(fileData) ? Buffer.from(fileData) : fileData;
            const { data, error } = await this._supabase.storage
                .from('xtad-files')
                .upload(storagePath, uploadData, {
                    contentType: contentType || 'application/octet-stream',
                    upsert: true
                });
            if (error) {
                logger.error('uploadFileVersioned: エラー:', storagePath, error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, path: data.path };
        } catch (error) {
            logger.error('バージョンファイルアップロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * バージョン履歴付きで実身を保存
     * save_real_object_with_version RPC → current/ + v{N}/ の二重保存
     * @param {string} tenantId
     * @param {Object} realObject - { metadata }
     * @param {Object} files - { json, xtad, ico?, images? }
     * @param {number} expectedVersion - 期待するバージョン番号（0=新規）
     * @returns {{ success: boolean, realObject?: Object, newVersion?: number, error?: string, conflict?: boolean, quotaExceeded?: boolean }}
     */
    /**
     * ファイルデータのSHA-256ハッシュを計算
     * @param {Buffer|Uint8Array|Array} fileData
     * @returns {string} hex形式のハッシュ値
     */
    computeFileHash(fileData) {
        const buffer = Buffer.from(fileData);
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * 行単位の差分を計算（diff-match-patch使用）
     * @param {string} oldText - 旧テキスト
     * @param {string} newText - 新テキスト
     * @returns {string} JSON形式の差分データ [[op, text], ...]
     */
    computeLineDiff(oldText, newText) {
        const dmp = new DiffMatchPatch();
        // 行単位でdiffを計算
        const a = dmp.diff_linesToChars_(oldText, newText);
        const diffs = dmp.diff_main(a.chars1, a.chars2, false);
        dmp.diff_charsToLines_(diffs, a.lineArray);
        dmp.diff_cleanupSemantic(diffs);
        return JSON.stringify(diffs);
    }

    async saveRealObjectWithVersion(tenantId, realObject, files, expectedVersion) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const metadata = realObject.metadata || realObject;
            const realId = metadata.realId || metadata.id;

            // 1. ファイルリストとサイズとハッシュを計算
            const fileList = [];
            let totalSize = 0;
            const fileHashes = {};  // name → hash のマップ

            if (files.json) {
                const size = files.json.length || 0;
                const hash = this.computeFileHash(files.json);
                fileList.push({ name: `${realId}.json`, size, contentType: 'application/json', hash });
                fileHashes[`${realId}.json`] = hash;
                totalSize += size;
            }
            if (files.xtad) {
                const size = files.xtad.length || 0;
                const hash = this.computeFileHash(files.xtad);
                fileList.push({ name: `${realId}_0.xtad`, size, contentType: 'application/xml', hash });
                fileHashes[`${realId}_0.xtad`] = hash;
                totalSize += size;
            }
            if (files.ico) {
                const size = files.ico.length || 0;
                const hash = this.computeFileHash(files.ico);
                fileList.push({ name: `${realId}.ico`, size, contentType: 'image/x-icon', hash });
                fileHashes[`${realId}.ico`] = hash;
                totalSize += size;
            }
            if (files.images && Array.isArray(files.images)) {
                for (const img of files.images) {
                    if (img.name && img.data) {
                        const size = img.data.length || 0;
                        const hash = this.computeFileHash(img.data);
                        fileList.push({ name: img.name, size, contentType: 'image/png', hash });
                        fileHashes[img.name] = hash;
                        totalSize += size;
                    }
                }
            }

            // 1.5. 前バージョンのfile_listを取得（ハッシュベース重複排除用）
            let prevFileMap = {};  // name → { hash, version } のマップ
            try {
                const { data: prevVersions } = await this._supabase
                    .rpc('get_version_history', {
                        p_real_id: realId,
                        p_tenant_id: tenantId,
                        p_limit: 1
                    });
                if (prevVersions && prevVersions.length > 0) {
                    const prevVersion = prevVersions[0];
                    const prevList = prevVersion.file_list || [];
                    for (const pf of prevList) {
                        if (pf.hash) {
                            // ref_versionがある場合はそちらを使用（参照先バージョン）
                            prevFileMap[pf.name] = {
                                hash: pf.hash,
                                version: pf.ref_version || prevVersion.version
                            };
                        }
                    }
                }
            } catch (e) {
                // 前バージョン取得失敗は重複排除をスキップするだけ
            }

            // 1.6. ハッシュ比較してfile_listにref_versionを設定
            for (const entry of fileList) {
                const prev = prevFileMap[entry.name];
                if (prev && prev.hash === entry.hash) {
                    entry.ref_version = prev.version;  // 前バージョンを参照
                }
            }

            // 1.7. XTAD差分計算（前バージョンのXTADと比較）
            let xtadDiff = null;
            const xtadEntry = fileList.find(f => f.name.endsWith('.xtad'));
            if (files.xtad && xtadEntry && !xtadEntry.ref_version) {
                // XTADが変更された場合のみdiff計算
                try {
                    const prevXtadEntry = Object.keys(prevFileMap).find(name => name.endsWith('.xtad'));
                    if (prevXtadEntry) {
                        const prevVersion = prevFileMap[prevXtadEntry].version;
                        const prevPath = `${tenantId}/${realId}/v${prevVersion}/${prevXtadEntry}`;
                        const { data: prevBlob, error: prevDlErr } = await this._supabase.storage
                            .from('xtad-files')
                            .download(prevPath);
                        if (!prevDlErr && prevBlob) {
                            const prevText = await prevBlob.text();
                            const newText = Buffer.from(files.xtad).toString('utf-8');
                            xtadDiff = this.computeLineDiff(prevText, newText);
                        }
                    }
                } catch (diffErr) {
                    logger.warn('XTAD差分計算失敗（保存は継続）:', diffErr.message);
                }
            }

            // 2. save_real_object_with_version RPC 呼び出し
            const metaJsonb = {
                makeDate: metadata.makeDate,
                updateDate: metadata.updateDate || new Date().toISOString(),
                accessDate: metadata.accessDate,
                applist: metadata.applist,
                window: metadata.window
            };
            if (metadata.parent_id) {
                metaJsonb.parent_id = metadata.parent_id;
            }

            const { data: rpcData, error: rpcError } = await this._supabase
                .rpc('save_real_object_with_version', {
                    p_real_id: realId,
                    p_tenant_id: tenantId,
                    p_name: metadata.name,
                    p_ref_count: metadata.refCount || metadata.ref_count || 1,
                    p_record_count: metadata.recordCount || metadata.record_count || 1,
                    p_metadata: metaJsonb,
                    p_expected_version: expectedVersion || 0,
                    p_file_list: fileList,
                    p_total_size: totalSize,
                    p_xtad_diff: xtadDiff
                });

            if (rpcError) {
                if (rpcError.message && rpcError.message.includes('VERSION_CONFLICT')) {
                    return { success: false, error: 'バージョン競合が発生しました', conflict: true };
                }
                // N-11: CONFLICT:プレフィックスまたはPK違反(23505)の検出
                if ((rpcError.message && rpcError.message.includes('CONFLICT:')) || rpcError.code === '23505') {
                    return { success: false, error: '実身が既に存在します', conflict: true };
                }
                // RPC未デプロイ時: 既存のuploadRealObjectVersionedにフォールバック
                if (rpcError.message && (rpcError.message.includes('function') || rpcError.message.includes('rpc'))) {
                    logger.warn('save_real_object_with_version RPC未デプロイ、フォールバック');
                    return await this.uploadRealObjectVersioned(tenantId, realObject, files, expectedVersion);
                }
                return { success: false, error: this._sanitizeErrorMessage(rpcError.message) };
            }

            const rpcResult = (rpcData && rpcData.length > 0) ? rpcData[0] : null;
            if (!rpcResult) {
                // RPC未デプロイ時のフォールバック
                logger.warn('save_real_object_with_version RPC結果なし、フォールバック');
                return await this.uploadRealObjectVersioned(tenantId, realObject, files, expectedVersion);
            }

            // 容量超過チェック
            if (rpcResult.quota_exceeded) {
                return { success: false, error: '容量が不足しています', quotaExceeded: true };
            }

            const newVersion = rpcResult.new_version;
            const realObjectData = typeof rpcResult.real_object === 'string'
                ? JSON.parse(rpcResult.real_object)
                : rpcResult.real_object;

            // 3. ファイルを current/ にアップロード（並列実行）
            // N-6: アップロード結果をチェックし、失敗時に警告ログを記録
            let uploadFailures = 0;
            let uploadAttempts = 0;

            const currentUploads = [];
            if (files.xtad) {
                currentUploads.push({ name: 'XTAD', promise: this.uploadFile(tenantId, realId, `${realId}_0.xtad`, files.xtad, 'application/xml') });
            }
            if (files.json) {
                currentUploads.push({ name: 'JSON', promise: this.uploadFile(tenantId, realId, `${realId}.json`, files.json, 'application/json') });
            }
            if (files.ico) {
                currentUploads.push({ name: 'ICO', promise: this.uploadFile(tenantId, realId, `${realId}.ico`, files.ico, 'image/x-icon') });
            }
            if (files.images && Array.isArray(files.images)) {
                for (const img of files.images) {
                    if (img.name && img.data) {
                        currentUploads.push({ name: img.name, promise: this.uploadFile(tenantId, realId, img.name, img.data, 'image/png') });
                    }
                }
            }
            uploadAttempts += currentUploads.length;
            if (currentUploads.length > 0) {
                const currentResults = await Promise.all(currentUploads.map(u => u.promise));
                currentResults.forEach((res, i) => {
                    if (!res.success) { uploadFailures++; logger.error('N-6: current/ ' + currentUploads[i].name + 'アップロード失敗:', res.error); }
                });
            }

            // 4. ファイルを v{N}/ にアップロード（並列実行、ハッシュベース重複排除: 変更があったファイルのみ）
            const fileEntryMap = {};
            for (const entry of fileList) {
                fileEntryMap[entry.name] = entry;
            }

            const versionedUploads = [];
            if (files.xtad && !fileEntryMap[`${realId}_0.xtad`]?.ref_version) {
                versionedUploads.push({ name: 'XTAD', promise: this.uploadFileVersioned(tenantId, realId, newVersion, `${realId}_0.xtad`, files.xtad, 'application/xml') });
            }
            if (files.json && !fileEntryMap[`${realId}.json`]?.ref_version) {
                versionedUploads.push({ name: 'JSON', promise: this.uploadFileVersioned(tenantId, realId, newVersion, `${realId}.json`, files.json, 'application/json') });
            }
            if (files.ico && !fileEntryMap[`${realId}.ico`]?.ref_version) {
                versionedUploads.push({ name: 'ICO', promise: this.uploadFileVersioned(tenantId, realId, newVersion, `${realId}.ico`, files.ico, 'image/x-icon') });
            }
            if (files.images && Array.isArray(files.images)) {
                for (const img of files.images) {
                    if (img.name && img.data && !fileEntryMap[img.name]?.ref_version) {
                        versionedUploads.push({ name: img.name, promise: this.uploadFileVersioned(tenantId, realId, newVersion, img.name, img.data, 'image/png') });
                    }
                }
            }
            uploadAttempts += versionedUploads.length;
            if (versionedUploads.length > 0) {
                const versionedResults = await Promise.all(versionedUploads.map(u => u.promise));
                versionedResults.forEach((res, i) => {
                    if (!res.success) { uploadFailures++; logger.error('N-6: versioned/ ' + versionedUploads[i].name + 'アップロード失敗:', res.error); }
                });
            }

            // N-6: 全ファイルアップロード失敗時は幽霊バージョンの警告
            if (uploadAttempts > 0 && uploadFailures === uploadAttempts) {
                logger.error('N-6: 全Storageアップロード失敗 - 幽霊バージョンが発生（v' + newVersion + '）。DBにバージョンレコードが残っていますがStorageにファイルがありません。');
                return { success: false, error: 'ファイルのアップロードに失敗しました。保存を再試行してください。', ghostVersion: newVersion };
            } else if (uploadFailures > 0) {
                logger.warn('N-6: 一部Storageアップロード失敗（' + uploadFailures + '/' + uploadAttempts + '）- 部分的な幽霊バージョンの可能性があります');
            }

            // 5. 古いバージョンのクリーンアップ（保存時実行）
            try {
                const { data: cleanupData } = await this._supabase
                    .rpc('cleanup_old_versions', {
                        p_real_id: realId,
                        p_tenant_id: tenantId
                    });
                if (cleanupData && cleanupData.length > 0) {
                    // 削除されたバージョンのStorageファイルも削除
                    for (const deleted of cleanupData) {
                        try {
                            const prefix = deleted.storage_prefix;
                            const { data: vFiles } = await this._supabase.storage
                                .from('xtad-files')
                                .list(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
                            if (vFiles && vFiles.length > 0) {
                                const paths = vFiles.map(f =>
                                    `${prefix.endsWith('/') ? prefix : prefix + '/'}${f.name}`
                                );
                                await this._supabase.storage
                                    .from('xtad-files')
                                    .remove(paths);
                            }
                        } catch (e) {
                            logger.warn('バージョンストレージ削除失敗:', deleted.storage_prefix, e.message);
                        }
                    }
                    logger.info('古いバージョン削除:', cleanupData.length, '件');
                }
            } catch (cleanupError) {
                // クリーンアップ失敗は保存を妨げない
                logger.warn('バージョンクリーンアップ失敗:', cleanupError.message);
            }

            // アップロード後のquota検証（VUL-001対策）
            try {
                const quotaResult = await this.getTenantQuota(tenantId);
                if (quotaResult.success && quotaResult.quota) {
                    const q = quotaResult.quota;
                    if (q.storage_used > q.storage_limit) {
                        logger.warn('saveRealObjectWithVersion: quota超過検出, tenant:', tenantId,
                            'used:', q.storage_used, 'limit:', q.storage_limit);
                    }
                }
            } catch (quotaErr) {
                logger.warn('saveRealObjectWithVersion: quota検証スキップ:', quotaErr.message);
            }

            return { success: true, realObject: realObjectData, newVersion };
        } catch (error) {
            logger.error('バージョン管理付き保存エラー:', error.message);
            // RPC未デプロイ時のフォールバック
            if (error.message && (error.message.includes('function') || error.message.includes('rpc'))) {
                logger.warn('save_real_object_with_version 例外、フォールバック');
                return await this.uploadRealObjectVersioned(tenantId, realObject, files, expectedVersion);
            }
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身のバージョン履歴を取得
     * @param {string} tenantId
     * @param {string} realId
     * @param {number} [limit=20] - 取得件数上限
     * @returns {{ success: boolean, versions?: Array, error?: string }}
     */
    async getVersionHistory(tenantId, realId, limit = 20) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data, error } = await this._supabase.rpc('get_version_history', {
                p_real_id: realId,
                p_tenant_id: tenantId,
                p_limit: limit
            });

            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }

            return { success: true, versions: data || [] };
        } catch (error) {
            // RPC未デプロイ時
            if (error.message && (error.message.includes('function') || error.message.includes('rpc'))) {
                return { success: true, versions: [] };
            }
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 特定バージョンのファイル群をダウンロード（復元用）
     * file_listのref_versionを考慮して正しいパスからダウンロードする
     * @param {string} tenantId
     * @param {string} realId
     * @param {number} version - ダウンロードするバージョン番号
     * @returns {{ success: boolean, metadata?: Object, files?: Object, versionInfo?: Object, error?: string }}
     */
    async downloadVersionFiles(tenantId, realId, version) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            // 1. バージョンレコードを取得（file_list, metadata含む）
            const { data: versionRecord, error: vErr } = await this._supabase
                .from('real_object_versions')
                .select('version, name, metadata, file_list, storage_prefix')
                .eq('real_object_id', realId)
                .eq('version', version)
                .single();

            if (vErr || !versionRecord) {
                return { success: false, error: 'バージョン ' + version + ' が見つかりません' };
            }

            const fList = versionRecord.file_list || [];
            const result = { json: null, xtad: null, ico: null, images: [] };

            // 2. 各ファイルをダウンロード
            for (const fileEntry of fList) {
                // ref_versionがある場合はそのバージョンのパスからDL
                const dlVersion = fileEntry.ref_version || version;
                this._validatePathComponent(String(dlVersion), 'version');
                this._validatePathComponent(fileEntry.name, 'fileName');
                const storagePath = `${tenantId}/${realId}/v${dlVersion}/${fileEntry.name}`;

                try {
                    const { data, error } = await this._supabase.storage
                        .from('xtad-files')
                        .download(storagePath);

                    if (error) {
                        logger.warn('downloadVersionFiles: ファイルDL失敗:', storagePath, error.message);
                        continue;
                    }

                    const arrayBuffer = await data.arrayBuffer();
                    const fileData = Array.from(new Uint8Array(arrayBuffer));

                    // ファイルタイプを判定して振り分け
                    if (fileEntry.name.endsWith('.json')) {
                        result.json = fileData;
                    } else if (fileEntry.name.endsWith('.xtad')) {
                        result.xtad = fileData;
                    } else if (fileEntry.name.endsWith('.ico')) {
                        result.ico = fileData;
                    } else {
                        result.images.push({ name: fileEntry.name, data: fileData });
                    }
                } catch (dlErr) {
                    logger.warn('downloadVersionFiles: ファイルDL例外:', storagePath, dlErr.message);
                }
            }

            return {
                success: true,
                metadata: versionRecord.metadata,
                versionInfo: {
                    version: versionRecord.version,
                    name: versionRecord.name
                },
                files: result
            };
        } catch (error) {
            logger.error('バージョンファイルダウンロードエラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 特定バージョンのXTAD差分とファイル変更情報を取得
     * @param {string} tenantId
     * @param {string} realId
     * @param {number} version - 対象バージョン番号
     * @returns {{ success: boolean, xtadDiff?: Array, fileChanges?: Array, error?: string }}
     */
    async getVersionDiff(tenantId, realId, version) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            // 1. 対象バージョンのレコードを取得（xtad_diff, file_list）
            const { data: currentVer, error: err1 } = await this._supabase
                .from('real_object_versions')
                .select('version, xtad_diff, file_list')
                .eq('real_object_id', realId)
                .eq('version', version)
                .single();

            if (err1 || !currentVer) {
                return { success: false, error: 'バージョン ' + version + ' が見つかりません' };
            }

            // 2. XTAD差分をパース
            let xtadDiff = null;
            if (currentVer.xtad_diff) {
                try {
                    xtadDiff = JSON.parse(currentVer.xtad_diff);
                } catch (e) {
                    xtadDiff = null;
                }
            }

            // 3. 前バージョンのfile_listを取得してファイル変更一覧を算出
            let fileChanges = [];
            const { data: prevVer } = await this._supabase
                .from('real_object_versions')
                .select('version, file_list')
                .eq('real_object_id', realId)
                .eq('version', version - 1)
                .single();

            const currentFiles = currentVer.file_list || [];
            const prevFiles = prevVer ? (prevVer.file_list || []) : [];

            // 前バージョンのファイルマップ
            const prevMap = {};
            for (const f of prevFiles) {
                prevMap[f.name] = f;
            }

            // 現バージョンのファイルを走査
            const currentNames = new Set();
            for (const f of currentFiles) {
                currentNames.add(f.name);
                const prev = prevMap[f.name];
                if (!prev) {
                    fileChanges.push({ name: f.name, status: 'added', size: f.size });
                } else if (f.ref_version) {
                    fileChanges.push({ name: f.name, status: 'unchanged', size: f.size });
                } else if (f.hash && prev.hash && f.hash !== prev.hash) {
                    fileChanges.push({ name: f.name, status: 'modified', size: f.size, prevSize: prev.size });
                } else if (!f.hash || !prev.hash) {
                    fileChanges.push({ name: f.name, status: 'modified', size: f.size, prevSize: prev.size });
                } else {
                    fileChanges.push({ name: f.name, status: 'unchanged', size: f.size });
                }
            }

            // 削除されたファイル（前バージョンにあって現バージョンにない）
            for (const f of prevFiles) {
                if (!currentNames.has(f.name)) {
                    fileChanges.push({ name: f.name, status: 'deleted', prevSize: f.size });
                }
            }

            return { success: true, xtadDiff, fileChanges };
        } catch (error) {
            logger.error('バージョン差分取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // 容量管理
    // =========================================================

    /**
     * テナントの容量情報を取得
     * @param {string} tenantId - テナントID
     * @returns {{ success: boolean, quota?: Object, error?: string }}
     */
    async getTenantQuota(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data, error } = await this._supabase.rpc('get_tenant_quota', {
                p_tenant_id: tenantId
            });

            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }

            // RPC関数はTABLE返却なので配列で返る
            const quota = (data && data.length > 0) ? data[0] : null;
            if (!quota) {
                // RPC関数未デプロイ時のフォールバック: デフォルト値を返す
                return {
                    success: true,
                    quota: {
                        storage_limit: 104857600,
                        storage_used: 0,
                        storage_pct: 0,
                        db_used: 0,
                        object_count: 0,
                        version_count: 0,
                        max_versions: 100,
                        retention_days: 90
                    }
                };
            }

            return { success: true, quota };
        } catch (error) {
            // RPC関数未デプロイ時はフォールバック
            if (error.message && (error.message.includes('function') || error.message.includes('rpc'))) {
                return {
                    success: true,
                    quota: {
                        storage_limit: 104857600,
                        storage_used: 0,
                        storage_pct: 0,
                        db_used: 0,
                        object_count: 0,
                        version_count: 0,
                        max_versions: 100,
                        retention_days: 90
                    }
                };
            }
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // 共有管理
    // =========================================================

    /**
     * 実身の共有先一覧を取得
     * @param {string} objectId - 実身ID
     * @returns {{ success: boolean, shares?: Array, error?: string }}
     */
    async listShares(objectId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('listShares: 共有一覧取得開始, objectId:', objectId);
            const { data, error } = await this._supabase
                .from('shares')
                .select('id, object_id, shared_with, permission, created_at')
                .eq('object_id', objectId);
            if (error) {
                logger.error('listShares: エラー:', error.message);
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            logger.info('listShares: 取得成功, 件数:', (data || []).length);

            // プロフィール情報を結合
            const userIds = data.map(s => s.shared_with);
            const { data: profiles } = await this._supabase
                .from('profiles')
                .select('id, email, display_name')
                .in('id', userIds);

            const profileMap = new Map((profiles || []).map(p => [p.id, p]));
            const shares = data.map(s => ({
                ...s,
                email: profileMap.get(s.shared_with)?.email || '',
                display_name: profileMap.get(s.shared_with)?.display_name || ''
            }));

            return { success: true, shares };
        } catch (error) {
            logger.error('共有一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 実身を他ユーザーに共有
     * @param {string} objectId - 実身ID
     * @param {string} email - 共有先メールアドレス
     * @param {string} permission - 'read' | 'write' | 'admin'
     * @returns {{ success: boolean, share?: Object, error?: string }}
     */
    async createShare(objectId, email, permission) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        // M-7: レートリミットチェック（メールアドレス列挙攻撃の緩和）
        if (!this._checkRateLimit('lookupUser')) {
            return { success: false, error: '操作回数が上限に達しました。しばらく待ってから再試行してください。' };
        }
        try {
            logger.info('createShare: 共有作成開始, objectId:', objectId, 'email:', email, 'permission:', permission);
            // N-3: 招待/共有用の専用関数を使用（テナント外ユーザーも検索可能、admin権限必要）
            const { data: users, error: lookupError } = await this._supabase
                .rpc('lookup_user_for_invite', { p_email: email });
            if (lookupError) {
                // lookup_user_for_invite未デプロイ時はlookup_user_by_emailにフォールバック
                if (lookupError.message && (lookupError.message.includes('function') || lookupError.message.includes('rpc'))) {
                    logger.warn('lookup_user_for_invite未デプロイ、lookup_user_by_emailにフォールバック');
                    const { data: fallbackUsers, error: fbError } = await this._supabase
                        .rpc('lookup_user_by_email', { p_email: email });
                    if (fbError) {
                        return { success: false, error: this._sanitizeErrorMessage(fbError.message) };
                    }
                    if (!fallbackUsers || fallbackUsers.length === 0) {
                        return { success: false, error: '共有の設定に失敗しました。メールアドレスを確認してください' };
                    }
                    const userId = fallbackUsers[0].user_id;
                    const { data, error } = await this._supabase
                        .from('shares')
                        .insert({ object_id: objectId, shared_with: userId, permission })
                        .select()
                        .single();
                    if (error) {
                        if (error.code === '23505') {
                            return { success: false, error: 'このユーザーには既に共有されています' };
                        }
                        return { success: false, error: this._sanitizeErrorMessage(error.message) };
                    }
                    return { success: true, share: data };
                }
                return { success: false, error: this._sanitizeErrorMessage(lookupError.message) };
            }
            if (!users || users.length === 0) {
                // H-6: 統一レスポンス（メールアドレス列挙攻撃防止）
                return { success: false, error: '共有の設定に失敗しました。メールアドレスを確認してください' };
            }

            const userId = users[0].user_id;
            const { data, error } = await this._supabase
                .from('shares')
                .insert({ object_id: objectId, shared_with: userId, permission })
                .select()
                .single();
            if (error) {
                if (error.code === '23505') {
                    return { success: false, error: 'このユーザーには既に共有されています' };
                }
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, share: data };
        } catch (error) {
            logger.error('共有作成エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 共有を解除
     * @param {string} shareId
     * @returns {{ success: boolean, error?: string }}
     */
    async deleteShare(shareId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            logger.info('deleteShare: 共有解除開始, shareId:', shareId);
            const { error } = await this._supabase
                .from('shares')
                .delete()
                .eq('id', shareId);
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true };
        } catch (error) {
            logger.error('共有解除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * 自分に共有された実身一覧を取得
     * @returns {{ success: boolean, sharedObjects?: Array, error?: string }}
     */
    async listSharedWithMe() {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const { data: sessionData } = await this._supabase.auth.getSession();
            if (!sessionData.session) {
                return { success: false, error: '未ログインです' };
            }

            const { data, error } = await this._supabase
                .from('shares')
                .select(`
                    id, permission, created_at,
                    real_objects:object_id (id, tenant_id, owner_id, name, ref_count, record_count, version, updated_at)
                `)
                .eq('shared_with', sessionData.session.user.id);
            if (error) {
                return { success: false, error: this._sanitizeErrorMessage(error.message) };
            }
            return { success: true, sharedObjects: data };
        } catch (error) {
            logger.error('共有実身一覧取得エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // リアルタイム通知
    // =========================================================

    /**
     * テナントの実身変更をリアルタイム購読
     * @param {string} tenantId
     * @param {Function} callback - (event) => void
     * @returns {{ success: boolean, error?: string }}
     */
    subscribeToTenant(tenantId, callback) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const channelKey = `tenant-${tenantId}`;
            if (this._subscriptions.has(channelKey)) {
                this._supabase.removeChannel(this._subscriptions.get(channelKey));
            }

            const channel = this._supabase
                .channel(channelKey)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'real_objects',
                    filter: `tenant_id=eq.${tenantId}`
                }, (payload) => {
                    if (callback) callback(payload);
                })
                .subscribe();

            this._subscriptions.set(channelKey, channel);
            return { success: true };
        } catch (error) {
            logger.error('リアルタイム購読エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    /**
     * テナントのリアルタイム購読を解除
     * @param {string} tenantId
     * @returns {{ success: boolean, error?: string }}
     */
    unsubscribeFromTenant(tenantId) {
        if (!this._supabase) {
            return { success: false, error: '未初期化です' };
        }
        try {
            const channelKey = `tenant-${tenantId}`;
            const channel = this._subscriptions.get(channelKey);
            if (channel) {
                this._supabase.removeChannel(channel);
                this._subscriptions.delete(channelKey);
            }
            return { success: true };
        } catch (error) {
            logger.error('リアルタイム購読解除エラー:', error.message);
            return { success: false, error: this._sanitizeErrorMessage(error.message) };
        }
    }

    // =========================================================
    // セッション永続化（safeStorage暗号化ファイルストレージ）
    // =========================================================

    /**
     * Supabase SDK用カスタムストレージアダプタを生成
     * safeStorageが利用可能な場合のみファイルベースの暗号化ストレージを返す
     * @returns {Object|null} getItem/setItem/removeItemを持つストレージオブジェクト、または null
     */
    _createStorageAdapter() {
        const fs = require('fs');
        const path = require('path');
        const { safeStorage } = require('electron');

        if (!safeStorage.isEncryptionAvailable()) {
            logger.info('safeStorage暗号化が利用不可 - セッション永続化なし');
            return null;
        }

        const sessionDir = this._getSessionDir();

        // セッションディレクトリを確保
        try {
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
        } catch (e) {
            logger.warn('セッションディレクトリ作成失敗:', e.message);
            return null;
        }

        const self = this;
        return {
            getItem: (key) => {
                try {
                    const filePath = path.join(sessionDir, self._sanitizeKey(key));
                    if (!fs.existsSync(filePath)) return null;
                    const encrypted = fs.readFileSync(filePath);
                    return safeStorage.decryptString(encrypted);
                } catch (e) {
                    return null;
                }
            },
            setItem: (key, value) => {
                try {
                    const filePath = path.join(sessionDir, self._sanitizeKey(key));
                    const encrypted = safeStorage.encryptString(value);
                    fs.writeFileSync(filePath, encrypted);
                } catch (e) {
                    // 保存失敗は無視（次回再ログインになるだけ）
                }
            },
            removeItem: (key) => {
                try {
                    const filePath = path.join(sessionDir, self._sanitizeKey(key));
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    // 削除失敗は無視
                }
            }
        };
    }

    /**
     * セッションファイル保存ディレクトリを取得
     * @returns {string}
     */
    _getSessionDir() {
        const path = require('path');
        if (this._sessionFilePath) {
            return this._sessionFilePath;
        }
        const { app } = require('electron');
        return path.join(app.getPath('userData'), 'net-btron-session');
    }

    /**
     * ストレージパスコンポーネントのバリデーション（パストラバーサル防止: H-4）
     * @param {string} component - パスの各部分（tenantId, realId, fileName等）
     * @param {string} label - エラーメッセージ用ラベル
     * @throws {Error} 不正な文字が含まれる場合
     */
    _validatePathComponent(component, label) {
        if (!component || typeof component !== 'string') {
            throw new Error(`無効な${label}: 空または文字列でない`);
        }
        // URLエンコード形式のパストラバーサル検出（%2e='.', %2f='/', %5c='\'）
        if (/%(?:2[ef]|5c)/i.test(component)) {
            throw new Error(`無効な${label}: URLエンコードされた不正文字を含む`);
        }
        if (/[\/\\]/.test(component) || component.includes('..')) {
            throw new Error(`無効な${label}: パストラバーサル文字を含む`);
        }
        // 制御文字チェック（null byte, CR, LF等）
        if (/[\x00-\x1f]/.test(component)) {
            throw new Error(`無効な${label}: 制御文字を含む`);
        }
    }

    /**
     * ストレージキーをファイル名に変換（安全な文字のみ）
     * @param {string} key
     * @returns {string}
     */
    _sanitizeKey(key) {
        return key.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /**
     * セッションファイルを全て削除（ログアウト時）
     */
    /**
     * エラーメッセージのサニタイズ（HTMLタグ検出時に短縮）
     * Supabase 502/503等のサーバーエラーでCloudflareがHTML全文を返す場合の対策
     * @param {string} message - エラーメッセージ
     * @returns {string} サニタイズ済みメッセージ
     */
    _sanitizeErrorMessage(message) {
        if (!message || typeof message !== 'string') return message || '不明なエラー';
        // HTMLタグを検出
        if (/<\/?[a-z][\s\S]*>/i.test(message)) {
            // HTTPステータスコードを抽出（例: 502, 503, 504）
            const statusMatch = message.match(/\b(5\d{2}|4\d{2})\b/);
            const statusCode = statusMatch ? statusMatch[1] : '';
            if (statusCode) {
                return `サーバーエラー (HTTP ${statusCode})`;
            }
            return 'サーバーエラー（HTML応答を受信）';
        }
        // M-4: PostgreSQL/PostgRESTの内部情報を除去
        message = message.replace(/\bCONTEXT:[\s\S]*$/i, '').trim();
        message = message.replace(/\bDETAIL:[\s\S]*$/i, '').trim();
        message = message.replace(/\bHINT:[\s\S]*$/i, '').trim();
        // スキーマ名・テーブル名・カラム名の漏洩を防止
        message = message.replace(/\b(public|auth|storage)\.\w+/g, '[table]');
        message = message.replace(/\bcolumn\s+"?\w+"?/gi, 'column [hidden]');
        return message;
    }

    _cleanupSessionFiles() {
        try {
            const fs = require('fs');
            const path = require('path');
            const sessionDir = this._getSessionDir();
            if (fs.existsSync(sessionDir)) {
                const files = fs.readdirSync(sessionDir);
                files.forEach(f => {
                    try { fs.unlinkSync(path.join(sessionDir, f)); } catch (e) {}
                });
            }
        } catch (e) {
            // クリーンアップ失敗は無視
        }
    }
}

module.exports = { CloudAccessManager };
