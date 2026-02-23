/**
 * netbtron-object-list ダイアログテンプレート
 * showCustomDialog() に渡すHTMLテンプレートを関数として定義
 */

/**
 * 整頓ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {number} params.selectedCount - 選択数
 * @param {string} params.disabledClass - 無効状態のCSSクラス（'disabled' or ''）
 * @param {string} params.disabledAttr - 無効状態のHTML属性（'disabled' or ''）
 * @returns {string} HTMLテンプレート文字列
 */
function buildArrangeDialogHtml(params) {
    const { selectedCount, disabledClass, disabledAttr } = params;

    return `
<div class="arrange-dialog" style="font-size:11px">
    <div style="margin:0 0 8px 0;padding:0">選択: ${selectedCount}個</div>
    <div style="display:flex;gap:12px;margin:0;padding:0">
        <!-- 第1列: 横、縦、段組数 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">横</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="left" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左揃え</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="right" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>右揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="horizontal" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">縦</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="compact" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>詰める</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="align" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="vertical" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組数</span>
                <input type="number" id="columnCount" min="1" value="1" style="width:40px;font-size:11px" ${disabledAttr}>
            </div>
        </div>
        <!-- 第2列: 段組、幅調整 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="single" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>1段</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-horizontal" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左右</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-vertical" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上下</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="column" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">幅調整</span>
                <div class="radio-group-vertical">
                    <label class="radio-label">
                        <input type="radio" name="length" value="first">
                        <span class="radio-indicator"></span>
                        <span>最初</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="full">
                        <span class="radio-indicator"></span>
                        <span>全項目</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="icon-name">
                        <span class="radio-indicator"></span>
                        <span>名前まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="with-relation">
                        <span class="radio-indicator"></span>
                        <span>続柄まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="without-date">
                        <span class="radio-indicator"></span>
                        <span>日付除く</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
        </div>
        <!-- 第3列: 整列順、順序 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">整列順</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="name" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>名前</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="created" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>作成日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="updated" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>更新日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="size" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>サイズ</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="sortBy" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">順序</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="asc" checked ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>昇順</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="desc" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>降順</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</div>`;
}

/**
 * テナント作成ダイアログのHTMLテンプレートを生成
 * @returns {string} HTMLテンプレート文字列
 */
function buildCreateTenantHtml() {
    return `
<div style="font-size:11px">
    <div class="form-group" style="margin-bottom:8px">
        <label for="create-tenant-name">テナント名:</label>
        <input type="text" id="create-tenant-name" placeholder="テナント名を入力" style="padding:3px 6px;font-size:11px;font-family:inherit;border:1px inset #c0c0c0;background:#ffffff">
    </div>
    <div style="margin-bottom:4px;font-weight:bold">公開範囲:</div>
    <div class="radio-group-vertical" style="margin-left:8px">
        <label class="radio-label" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;cursor:pointer">
            <input type="radio" name="tenant-visibility" value="private" checked>
            <span class="radio-indicator"></span>
            <span>非公開（Private）</span>
        </label>
        <div style="margin-left:22px;margin-bottom:6px;color:#606060;font-size:10px">メンバーのみがアクセスできます</div>
        <label class="radio-label" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;cursor:pointer">
            <input type="radio" name="tenant-visibility" value="internal">
            <span class="radio-indicator"></span>
            <span>内部公開（Internal）</span>
        </label>
        <div style="margin-left:22px;color:#606060;font-size:10px">全ユーザーが閲覧できます</div>
    </div>
</div>`;
}

/**
 * テナント設定ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {string} params.tenantName - 現在のテナント名
 * @param {string} params.visibility - 現在の公開範囲 ('private' or 'internal')
 * @returns {string} HTMLテンプレート文字列
 */
function buildTenantSettingsHtml(params) {
    const { tenantName, visibility, escapeHtml } = params;
    const isPrivate = visibility === 'private';
    const isInternal = visibility === 'internal';
    // visibility値をホワイトリスト検証（scriptインジェクション防止: M-2）
    const safeVisibility = (visibility === 'private' || visibility === 'internal') ? visibility : 'private';

    return `
<div style="font-size:11px">
    <div style="margin-bottom:8px">
        <span style="font-weight:bold">テナント名:</span> ${escapeHtml(tenantName)}
    </div>
    <div style="margin-bottom:4px;font-weight:bold">公開範囲:</div>
    <div class="radio-group-vertical" style="margin-left:8px">
        <label class="radio-label" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;cursor:pointer">
            <input type="radio" name="tenant-visibility" value="private" ${isPrivate ? 'checked' : ''}>
            <span class="radio-indicator"></span>
            <span>非公開（Private）</span>
        </label>
        <div style="margin-left:22px;margin-bottom:6px;color:#606060;font-size:10px">メンバーのみがアクセスできます</div>
        <label class="radio-label" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;cursor:pointer">
            <input type="radio" name="tenant-visibility" value="internal" ${isInternal ? 'checked' : ''}>
            <span class="radio-indicator"></span>
            <span>内部公開（Internal）</span>
        </label>
        <div style="margin-left:22px;margin-bottom:6px;color:#606060;font-size:10px">全ユーザーが閲覧できます</div>
    </div>
    <div id="visibility-warning" style="display:none;margin-top:8px;padding:6px;background:#fff3cd;border:1px solid #ffc107;font-size:10px;color:#856404">
        内部公開に変更すると、全ユーザーがこのテナントの実身を閲覧できるようになります。
    </div>
</div>
<script>
(function() {
    var origVis = '${safeVisibility}';
    var radios = document.querySelectorAll('input[name="tenant-visibility"]');
    var warning = document.getElementById('visibility-warning');
    if (radios && warning) {
        radios.forEach(function(radio) {
            radio.addEventListener('change', function() {
                var checked = document.querySelector('input[name="tenant-visibility"]:checked');
                if (checked && checked.value === 'internal' && origVis !== 'internal') {
                    warning.style.display = '';
                } else {
                    warning.style.display = 'none';
                }
            });
        });
    }
})();
</script>`;
}

/**
 * メンバー管理ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {Array} params.members - メンバー一覧（{display_name, email, user_id, role}）
 * @param {function} params.escapeHtml - HTMLエスケープ関数
 * @returns {string} HTMLテンプレート文字列
 */
function buildMemberManagementHtml(params) {
    const { members, escapeHtml } = params;

    let html = '<div class="dialog-list" id="member-list">';
    if (members.length === 0) {
        html += '<div class="dialog-list-empty">メンバーがいません</div>';
    } else {
        members.forEach(m => {
            const displayName = m.display_name || m.email || m.user_id;
            const roleLabel = m.role === 'admin' ? '管理者' : m.role === 'member' ? 'メンバー' : '読取専用';
            html += '<div class="dialog-list-item">'
                + '<label style="display:flex;align-items:center;gap:4px;flex:1;cursor:pointer">'
                + '<input type="radio" name="selected-member" value="' + escapeHtml(m.user_id) + '">'
                + '<span class="item-info">' + escapeHtml(displayName) + '</span>'
                + '<span class="item-role">' + roleLabel + '</span>'
                + '</label>'
                + '</div>';
        });
    }
    html += '</div>';
    html += '<div class="dialog-form-row">'
        + '<input type="text" id="new-member-email" placeholder="メールアドレス">'
        + '<select id="new-member-role">'
        + '<option value="member">メンバー</option>'
        + '<option value="readonly">読取専用</option>'
        + '<option value="admin">管理者</option>'
        + '</select>'
        + '</div>';

    return html;
}

/**
 * 共有管理ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {string} params.objName - 対象オブジェクト名
 * @param {Array} params.shares - 共有一覧（{id, display_name, email, shared_with, permission}）
 * @param {function} params.escapeHtml - HTMLエスケープ関数
 * @returns {string} HTMLテンプレート文字列
 */
function buildShareDialogHtml(params) {
    const { objName, shares, escapeHtml } = params;

    let html = '<div style="margin-bottom:6px;font-weight:bold;">「' + escapeHtml(objName) + '」の共有設定</div>';
    html += '<div class="dialog-list" id="share-list">';
    if (shares.length === 0) {
        html += '<div class="dialog-list-empty">共有先がありません</div>';
    } else {
        shares.forEach(s => {
            const displayName = s.display_name || s.email || s.shared_with;
            const permLabel = s.permission === 'admin' ? '管理者' : s.permission === 'write' ? '書込' : '読取';
            html += '<div class="dialog-list-item">'
                + '<label style="display:flex;align-items:center;gap:4px;flex:1;cursor:pointer">'
                + '<input type="radio" name="selected-share" value="' + escapeHtml(s.id) + '">'
                + '<span class="item-info">' + escapeHtml(displayName) + '</span>'
                + '<span class="item-role">' + permLabel + '</span>'
                + '</label>'
                + '</div>';
        });
    }
    html += '</div>';
    html += '<div class="dialog-form-row">'
        + '<input type="text" id="share-email" placeholder="共有先メールアドレス">'
        + '<select id="share-permission">'
        + '<option value="read">読取</option>'
        + '<option value="write">書込</option>'
        + '<option value="admin">管理者</option>'
        + '</select>'
        + '</div>';

    return html;
}

/**
 * 招待管理ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {Array} params.invites - 招待一覧
 * @param {Function} params.escapeHtml - HTMLエスケープ関数
 * @returns {string} HTMLテンプレート文字列
 */
function buildInviteManagementHtml(params) {
    const { invites, escapeHtml } = params;

    let html = '<div class="dialog-list" id="invite-list">';
    if (invites.length === 0) {
        html += '<div class="dialog-list-empty">招待がありません</div>';
    } else {
        invites.forEach(inv => {
            const statusLabel = inv.status === 'pending' ? '待機中'
                : inv.status === 'accepted' ? '承認済' : '期限切れ';
            const roleLabel = inv.role === 'admin' ? '管理者'
                : inv.role === 'member' ? 'メンバー' : '読取専用';
            const emailInfo = inv.email ? escapeHtml(inv.email) : '（制限なし）';
            const expiresAt = new Date(inv.expires_at).toLocaleDateString('ja-JP');
            const isExpired = new Date(inv.expires_at) < new Date();
            const statusClass = inv.status === 'pending' && !isExpired ? '' : ' style="opacity:0.5"';

            html += '<div class="dialog-list-item"' + statusClass + '>'
                + '<label style="display:flex;align-items:center;gap:4px;flex:1;cursor:pointer">'
                + '<input type="radio" name="selected-invite" value="' + escapeHtml(inv.id) + '"'
                + (inv.status !== 'pending' ? ' disabled' : '') + '>'
                + '<span class="item-info" style="flex:1">'
                + emailInfo + ' (' + roleLabel + ')'
                + '</span>'
                + '<span class="item-role" style="font-size:9px">'
                + statusLabel + ' / ' + expiresAt
                + '</span>';

            // pending状態のみコピーボタン表示
            if (inv.status === 'pending' && !isExpired) {
                html += '<button class="btn btn-small invite-copy-btn" data-token="' + escapeHtml(inv.token) + '" '
                    + 'style="margin-left:4px;font-size:9px" type="button">コピー</button>';
            }

            html += '</label></div>';
        });
    }
    html += '</div>';

    // 新規招待作成フォーム
    html += '<div class="dialog-form-row">'
        + '<input type="text" id="new-invite-email" placeholder="メールアドレス（任意）">'
        + '<select id="new-invite-role">'
        + '<option value="member">メンバー</option>'
        + '<option value="readonly">読取専用</option>'
        + '<option value="admin">管理者</option>'
        + '</select>'
        + '</div>';

    return html;
}

/**
 * 新規登録フォームのHTMLテンプレートを生成（招待コードで登録画面）
 * @param {Object} params - テンプレートパラメータ
 * @param {Object} params.invite - 招待情報
 * @param {Function} params.escapeHtml - HTMLエスケープ関数
 * @returns {string} HTMLテンプレート文字列
 */
function buildSignupFormHtml(params) {
    const { invite, escapeHtml } = params;
    const roleLabel = invite.role === 'admin' ? '管理者'
        : invite.role === 'member' ? 'メンバー' : '読取専用';
    const expiresAt = new Date(invite.expires_at).toLocaleDateString('ja-JP');

    let html = '<div style="font-size:11px">';

    // 招待情報表示
    html += '<div style="background:#e8f4fd;border:1px solid #b8daff;padding:6px 8px;margin-bottom:8px;font-size:10px;line-height:1.4">'
        + '<div><b>テナント:</b> ' + escapeHtml(invite.tenant_name) + '</div>'
        + '<div><b>ロール:</b> ' + roleLabel + '</div>'
        + '<div><b>有効期限:</b> ' + expiresAt + '</div>'
        + '</div>';

    // メール/パスワード登録フォーム
    html += '<div style="margin-bottom:6px;font-weight:bold">メール/パスワードで登録</div>'
        + '<div class="dialog-form-row" style="flex-direction:column;gap:4px">'
        + '<input type="email" id="signup-email" placeholder="メールアドレス"'
        + (invite.email ? ' value="' + escapeHtml(invite.email) + '" readonly' : '') + '>'
        + '<input type="password" id="signup-password" placeholder="パスワード（6文字以上）">'
        + '<input type="password" id="signup-password-confirm" placeholder="パスワード（確認）">'
        + '</div>';

    html += '</div>';
    return html;
}

/**
 * ユーザー管理ダイアログのHTML生成（system_admin用）
 * @param {Object} params - { users, currentUserId, escapeHtml }
 */
function buildUserManagementHtml(params) {
    const { users, currentUserId, escapeHtml } = params;
    const roleLabels = { system_admin: 'システム管理者', tenant_creator: 'テナント作成者', user: '一般ユーザー' };

    let html = '<div class="user-management-list" style="max-height:200px;overflow-y:auto;">';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<tr style="background:#e0e0e0;"><th style="width:24px;"></th><th style="text-align:left;padding:2px 4px;">メール</th><th style="text-align:left;padding:2px 4px;">表示名</th><th style="text-align:left;padding:2px 4px;">ロール</th></tr>';
    users.forEach(u => {
        const isSelf = u.id === currentUserId;
        const roleLabel = roleLabels[u.system_role] || u.system_role;
        html += '<tr style="border-bottom:1px solid #c0c0c0;">';
        html += '<td style="padding:2px;"><input type="radio" name="selected-user" value="' + escapeHtml(u.id) + '"' + (isSelf ? ' disabled' : '') + '></td>';
        html += '<td style="padding:2px 4px;">' + escapeHtml(u.email) + (isSelf ? ' (自分)' : '') + '</td>';
        html += '<td style="padding:2px 4px;">' + escapeHtml(u.display_name || '') + '</td>';
        html += '<td style="padding:2px 4px;">' + escapeHtml(roleLabel) + '</td>';
        html += '</tr>';
    });
    html += '</table></div>';

    html += '<div style="margin-top:8px;">';
    html += '<label style="font-size:11px;">新しいロール: </label>';
    html += '<select id="new-system-role" style="font-size:11px;">';
    html += '<option value="user">一般ユーザー</option>';
    html += '<option value="tenant_creator">テナント作成者</option>';
    html += '<option value="system_admin">システム管理者</option>';
    html += '</select>';
    html += '</div>';

    return html;
}
