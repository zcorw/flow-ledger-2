(() => {
  'use strict';

  const pageMeta = {
    dashboard: { title: '首页看板', crumb: '首页看板' },
    snapshots: { title: '月度快照', crumb: '月度快照' },
    institutions: { title: '机构与账户', crumb: '机构与账户' },
    debts: { title: '债权债务', crumb: '债权债务' },
    settings: { title: '设置', crumb: '设置' }
  };

  const appShell = document.getElementById('appShell');
  const pageTitle = document.getElementById('pageTitle');
  const crumbText = document.getElementById('crumbText');
  const profileMenu = document.getElementById('profileMenu');
  const userMenuButton = document.getElementById('userMenuButton');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  const modalLayer = document.getElementById('modalLayer');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalConfirm = document.getElementById('modalConfirm');
  const modalFoot = document.getElementById('modalFoot');
  const authPreview = document.getElementById('authPreview');
  let toastTimer;
  let currentModal = null;

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function navigate(page) {
    if (!pageMeta[page]) return;
    document.querySelectorAll('[data-page-panel]').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.pagePanel === page);
    });
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('is-active', item.dataset.page === page);
    });
    pageTitle.textContent = pageMeta[page].title;
    crumbText.textContent = pageMeta[page].crumb;
    document.title = `${pageMeta[page].title} · Flow Ledger`;
    appShell.classList.remove('sidebar-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('[data-page]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });
  document.querySelectorAll('[data-page-link]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.pageLink));
  });

  document.getElementById('menuButton').addEventListener('click', () => appShell.classList.add('sidebar-open'));
  document.getElementById('sidebarClose').addEventListener('click', () => appShell.classList.remove('sidebar-open'));
  document.getElementById('sidebarScrim').addEventListener('click', () => appShell.classList.remove('sidebar-open'));

  function showToast(message, title = '操作已完成') {
    toast.querySelector('strong').textContent = title;
    toastMessage.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  document.getElementById('toastClose').addEventListener('click', () => toast.classList.remove('is-visible'));
  document.querySelectorAll('[data-toast]').forEach(button => {
    button.addEventListener('click', () => showToast(button.dataset.toast));
  });

  userMenuButton.addEventListener('click', event => {
    event.stopPropagation();
    const open = profileMenu.classList.toggle('is-open');
    userMenuButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (!profileMenu.contains(event.target) && event.target !== userMenuButton) {
      profileMenu.classList.remove('is-open');
      userMenuButton.setAttribute('aria-expanded', 'false');
    }
  });

  const modalDefinitions = {
    'quick-entry': {
      title: '快速录入',
      confirm: '进入月度快照',
      body: () => `
        <div class="form-grid">
          <label class="form-field full"><span>录入类型</span><select><option>月度资产快照</option><option>债权债务事件</option></select></label>
          <label class="form-field"><span>快照日期</span><input type="date" value="2026-07-31"></label>
          <label class="form-field"><span>基准币种</span><input value="CNY" disabled></label>
        </div>`,
      action: () => { closeModal(); navigate('snapshots'); showToast('已进入 2026-07-31 月度快照'); }
    },
    institution: {
      title: '新建机构',
      confirm: '创建机构',
      body: () => `
        <div class="form-grid">
          <label class="form-field full"><span>机构名称</span><input placeholder="例如：招商银行"></label>
          <label class="form-field"><span>机构类型</span><select><option>银行</option><option>券商</option><option>现金</option><option>个人</option><option>其他</option></select></label>
          <label class="form-field"><span>显示颜色</span><select><option>青绿色</option><option>蓝灰色</option><option>珊瑚色</option><option>琥珀色</option></select></label>
          <label class="form-field full"><span>状态</span><select><option>启用</option><option>停用</option></select></label>
        </div>`,
      action: () => completeModal('机构已创建，演示数据不会永久保存')
    },
    account: {
      title: '添加账户',
      confirm: '添加账户',
      body: () => `
        <div class="form-grid">
          <label class="form-field full"><span>所属机构</span><select><option>招商银行</option><option>盈透证券</option><option>中国银行</option><option>现金</option></select></label>
          <label class="form-field"><span>账户名称</span><input placeholder="例如：储蓄卡"></label>
          <label class="form-field"><span>账户类型</span><select><option>储蓄账户</option><option>理财账户</option><option>证券账户</option><option>现金钱包</option></select></label>
          <label class="form-field full"><span>脱敏标识</span><input placeholder="仅填写尾号或自定义简称，如：尾号 8842"></label>
        </div>`,
      action: () => completeModal('账户已添加，完整账号不会被保存')
    },
    project: {
      title: '添加资产项目',
      confirm: '添加项目',
      body: () => `
        <div class="form-grid">
          <label class="form-field full"><span>项目名称</span><input placeholder="例如：活期余额、季季宝、美股组合"></label>
          <label class="form-field"><span>资产类型</span><select><option>银行存款</option><option>现金</option><option>证券资产</option></select></label>
          <label class="form-field"><span>币种</span><select><option>CNY</option><option>USD</option><option>JPY</option><option>HKD</option></select></label>
          <label class="form-field"><span>默认流动性</span><select><option>T+0</option><option>7 日内</option><option>30 日内</option><option>90 日内</option><option>锁定或未知</option></select></label>
          <label class="form-field"><span>默认风险</span><select><option>低</option><option>中</option><option>高</option></select></label>
          <label class="form-field full"><span>备注</span><textarea placeholder="选填"></textarea></label>
        </div>`,
      action: () => completeModal('资产项目已添加')
    },
    debt: {
      title: '新增债权债务',
      confirm: '创建账本项目',
      body: () => `
        <div class="form-grid">
          <label class="form-field"><span>类型</span><select><option>债权 / 应收</option><option>债务 / 应付</option></select></label>
          <label class="form-field"><span>币种</span><select><option>CNY</option><option>USD</option><option>JPY</option><option>HKD</option></select></label>
          <label class="form-field full"><span>交易对手</span><input placeholder="个人或机构名称"></label>
          <label class="form-field full"><span>备注</span><textarea placeholder="说明借款背景或约定，选填"></textarea></label>
        </div>`,
      action: () => completeModal('债权债务项目已创建')
    },
    'debt-event': {
      title: '添加债权事件',
      confirm: '保存事件',
      body: () => `
        <div class="form-grid">
          <label class="form-field"><span>事件类型</span><select><option>收到还款</option><option>新增借出</option><option>调整</option><option>结清</option></select></label>
          <label class="form-field"><span>发生日期</span><input type="date" value="2026-08-01"></label>
          <label class="form-field"><span>金额</span><input inputmode="decimal" placeholder="0.00"></label>
          <label class="form-field"><span>交易对手</span><input value="林先生"></label>
          <label class="form-field full"><span>备注</span><textarea placeholder="选填"></textarea></label>
        </div>`,
      action: () => completeModal('事件已添加，未偿本金已重新计算')
    },
    password: {
      title: '修改登录密码',
      confirm: '更新密码',
      body: () => `
        <div class="form-grid">
          <label class="form-field full"><span>当前密码</span><input type="password" placeholder="输入当前密码"></label>
          <label class="form-field full"><span>新密码</span><input type="password" placeholder="至少 12 位字符"></label>
          <label class="form-field full"><span>确认新密码</span><input type="password" placeholder="再次输入新密码"></label>
        </div>`,
      action: () => completeModal('密码已更新，其他会话将被退出')
    },
    restore: {
      title: '恢复完整备份',
      confirm: '验证并恢复',
      danger: true,
      body: () => `
        <div class="modal-warning">${icon('alert')}<div><strong>此操作会全量替换当前业务数据</strong><small>系统会先自动导出当前数据作为预恢复备份，然后再执行替换。</small></div></div>
        <div class="form-grid">
          <label class="form-field full"><span>备份文件</span><input type="file" accept=".zip,.json,.backup"></label>
          <label class="form-field full"><span>当前登录密码</span><input type="password" placeholder="重新输入密码以确认身份"></label>
        </div>`,
      action: () => completeModal('原型已演示恢复确认流程，未改动任何数据')
    },
    'snapshot-import': { title: '导入月度快照', confirm: '开始校验', upload: '月度快照模板', action: () => completeModal('模板校验完成：12 行通过，0 个冲突') },
    'institution-import': { title: '导入基础数据', confirm: '开始校验', upload: '机构 / 账户 / 项目模板', action: () => completeModal('模板校验完成：8 行通过，0 个冲突') },
    'debt-import': { title: '导入债权债务事件', confirm: '开始校验', upload: '债权债务事件模板', action: () => completeModal('模板校验完成：3 行通过，0 个冲突') }
  };

  function uploadBody(label) {
    return `<div class="upload-zone"><div><span>${icon('upload')}</span><strong>拖放 ${label} 到这里</strong><p>支持 .xlsx 或 .csv，单次不超过 10 MB</p><button class="quiet-button" type="button">选择文件</button></div></div>`;
  }

  function openModal(type) {
    const definition = modalDefinitions[type];
    if (!definition) return;
    currentModal = definition;
    modalTitle.textContent = definition.title;
    modalBody.innerHTML = definition.upload ? uploadBody(definition.upload) : definition.body();
    modalConfirm.textContent = definition.confirm || '确认';
    modalConfirm.className = definition.danger ? 'danger-button' : 'primary-button';
    modalFoot.style.display = 'flex';
    modalLayer.classList.add('is-open');
    modalLayer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modalBody.querySelector('input, select, button')?.focus(), 50);
  }

  function closeModal() {
    modalLayer.classList.remove('is-open');
    modalLayer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentModal = null;
  }

  function completeModal(message) {
    closeModal();
    showToast(message);
  }

  document.querySelectorAll('[data-modal]').forEach(button => {
    button.addEventListener('click', () => openModal(button.dataset.modal));
  });
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  modalConfirm.addEventListener('click', () => currentModal?.action?.());

  function updateSnapshotRow(input) {
    const row = input.closest('tr');
    const converted = row.querySelector('.converted');
    const wrapper = input.closest('.money-input');
    const raw = input.value.replace(/,/g, '');
    const amount = Number(raw);
    if (!raw || Number.isNaN(amount)) {
      converted.textContent = '—';
      converted.classList.add('muted');
      wrapper.classList.add('invalid');
    } else {
      const result = amount * Number(input.dataset.rate || 1);
      converted.textContent = `¥${result.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      converted.classList.remove('muted');
      wrapper.classList.remove('invalid');
      row.classList.remove('missing-row');
    }
    refreshSnapshotNotice();
  }

  function refreshSnapshotNotice() {
    const inputs = [...document.querySelectorAll('.snapshot-table .money-input input')];
    const missing = inputs.filter(input => !input.value.trim());
    const notice = document.getElementById('snapshotNotice');
    const entered = document.getElementById('enteredCount');
    entered.textContent = String(12 - missing.length);
    if (missing.length === 0) {
      notice.classList.remove('warning-notice');
      notice.innerHTML = `${icon('check')}<div><strong>快照项目已全部填写</strong><span>仍有 2 个金额变化较大的项目，建议确认备注后再保存。</span></div><button class="text-button" data-toast="已筛选出变化较大的项目">查看变化项</button>`;
      notice.querySelector('[data-toast]').addEventListener('click', event => showToast(event.currentTarget.dataset.toast));
    }
  }

  document.querySelectorAll('.snapshot-table .money-input input').forEach(input => {
    input.addEventListener('input', () => updateSnapshotRow(input));
  });
  document.getElementById('focusMissing').addEventListener('click', () => {
    document.getElementById('missingRow').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.querySelector('#missingRow input')?.focus(), 350);
  });
  document.getElementById('copyPrevious').addEventListener('click', () => {
    const input = document.querySelector('#missingRow .money-input input');
    input.value = '23480.00';
    updateSnapshotRow(input);
    showToast('已复制 2026-06-30 的项目清单和金额，可继续修改');
  });
  document.getElementById('saveSnapshots').addEventListener('click', () => {
    const missing = [...document.querySelectorAll('.snapshot-table .money-input input')].filter(input => !input.value.trim());
    if (missing.length) {
      showToast('请先填写“人民币现金”的原币金额', '快照尚未保存');
      missing[0].closest('tr').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => missing[0].focus(), 300);
      return;
    }
    showToast('2026-07-31 快照已保存，并记录到操作日志');
  });
  document.querySelectorAll('.segmented button').forEach(button => {
    button.addEventListener('click', () => {
      button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('is-active'));
      button.classList.add('is-active');
      showToast(`已切换为“${button.childNodes[0].textContent.trim()}”视图`);
    });
  });

  const institutionData = {
    cmb: { name: '招商银行', meta: '银行 · 2 个账户 · 4 个项目', value: '¥536,800.00', initial: '招', cls: 'cmb' },
    ib: { name: '盈透证券', meta: '券商 · 1 个账户 · 2 个项目', value: '¥412,500.00', initial: 'IB', cls: 'ib' },
    boc: { name: '中国银行', meta: '银行 · 1 个账户 · 2 个项目', value: '¥241,600.00', initial: '中', cls: 'boc' },
    cash: { name: '现金', meta: '现金 · 2 个钱包 · 2 个项目', value: '¥103,000.00', initial: '现', cls: 'cash' },
    person: { name: '个人债权', meta: '个人 · 来自债权账本', value: '¥86,000.00', initial: '林', cls: 'person' }
  };

  document.querySelectorAll('[data-institution]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('[data-institution]').forEach(node => node.classList.remove('is-active'));
      item.classList.add('is-active');
      const data = institutionData[item.dataset.institution];
      document.getElementById('institutionName').textContent = data.name;
      document.getElementById('institutionMeta').textContent = data.meta;
      document.getElementById('institutionValue').textContent = data.value;
      const logo = document.querySelector('.institution-hero .institution-logo');
      logo.className = `institution-logo large ${data.cls}`;
      logo.textContent = data.initial;
      showToast(`已切换到 ${data.name}，账户列表为原型示意`);
    });
  });
  document.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.account-card').forEach(item => item.classList.remove('is-active'));
      card.classList.add('is-active');
      document.querySelector('.project-panel .panel-head h2').textContent = `${card.querySelector('strong').textContent} · 项目`;
    });
  });

  const debtRows = {
    receivable: `
      <tr class="is-selected" data-debt="lin"><td><strong>林先生</strong><small>个人周转借款</small></td><td><strong>CNY</strong></td><td class="align-right">¥50,000.00</td><td class="align-right"><strong>¥50,000.00</strong></td><td><span class="status-pill warning compact"><i></i>部分偿还</span></td><td>2026-07-26</td></tr>
      <tr data-debt="studio"><td><strong>North Studio</strong><small>项目垫付款</small></td><td><strong>USD</strong></td><td class="align-right">$5,009.65</td><td class="align-right"><strong>¥36,000.00</strong></td><td><span class="status-pill success compact"><i></i>进行中</span></td><td>2026-07-18</td></tr>`,
    payable: `
      <tr class="is-selected" data-debt="family"><td><strong>家庭备用借款</strong><small>短期资金周转</small></td><td><strong>CNY</strong></td><td class="align-right">¥142,480.00</td><td class="align-right"><strong>¥142,480.00</strong></td><td><span class="status-pill warning compact"><i></i>部分偿还</span></td><td>2026-07-20</td></tr>`
  };
  const debtDetails = {
    lin: { name: '林先生', note: '个人周转借款 · CNY', value: '¥50,000.00' },
    studio: { name: 'North Studio', note: '项目垫付款 · USD', value: '$5,009.65' },
    family: { name: '家庭备用借款', note: '短期资金周转 · CNY', value: '¥142,480.00' }
  };

  function selectDebt(row) {
    row.closest('tbody').querySelectorAll('tr').forEach(item => item.classList.remove('is-selected'));
    row.classList.add('is-selected');
    const data = debtDetails[row.dataset.debt];
    document.getElementById('debtDetailName').textContent = data.name;
    document.getElementById('debtDetailNote').textContent = data.note;
    document.getElementById('debtDetailValue').textContent = data.value;
  }

  function bindDebtRows() {
    document.querySelectorAll('#debtTableBody tr').forEach(row => row.addEventListener('click', () => selectDebt(row)));
  }
  bindDebtRows();
  document.querySelectorAll('[data-debt-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-debt-tab]').forEach(item => item.classList.remove('is-active'));
      tab.classList.add('is-active');
      const type = tab.dataset.debtTab;
      document.getElementById('debtTableBody').innerHTML = debtRows[type];
      document.getElementById('debtSummaryLabel').textContent = type === 'receivable' ? '债权未偿本金' : '债务未偿本金';
      document.getElementById('debtSummaryValue').textContent = type === 'receivable' ? '¥86,000.00' : '¥142,480.00';
      document.querySelector('.debt-detail .detail-type').textContent = type === 'receivable' ? '债权详情' : '债务详情';
      bindDebtRows();
      selectDebt(document.querySelector('#debtTableBody tr'));
    });
  });

  document.querySelectorAll('[data-settings-target]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-settings-target]').forEach(item => item.classList.remove('is-active'));
      button.classList.add('is-active');
      document.getElementById(button.dataset.settingsTarget).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('.currency-toggle input:not([disabled])').forEach(input => {
    input.addEventListener('change', () => {
      const enabled = document.querySelectorAll('.currency-toggle input:checked').length;
      if (enabled > 5) {
        input.checked = false;
        showToast('最多只能启用 5 个币种', '无法启用币种');
        return;
      }
      document.querySelector('.limit-badge').textContent = `已启用 ${enabled} / 5`;
      showToast(`币种设置已更新：当前启用 ${enabled} 个币种`);
    });
  });
  document.getElementById('syncRates').addEventListener('click', event => {
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.innerHTML = `${icon('refresh')}同步中…`;
    button.disabled = true;
    setTimeout(() => {
      button.innerHTML = original;
      button.disabled = false;
      showToast('汇率同步成功，JPY 仍使用 07-30 最近可用汇率');
    }, 900);
  });

  function openAuthPreview(type) {
    profileMenu.classList.remove('is-open');
    authPreview.querySelectorAll('[data-auth-panel]').forEach(panel => {
      panel.hidden = panel.dataset.authPanel !== type;
    });
    authPreview.classList.add('is-open');
    authPreview.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthPreview() {
    authPreview.classList.remove('is-open');
    authPreview.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-auth-preview]').forEach(button => {
    button.addEventListener('click', () => openAuthPreview(button.dataset.authPreview));
  });
  document.getElementById('authBack').addEventListener('click', closeAuthPreview);
  document.getElementById('fakeLogin').addEventListener('click', () => { closeAuthPreview(); showToast('登录成功，欢迎回来'); });
  document.getElementById('fakeSetup').addEventListener('click', () => { closeAuthPreview(); showToast('管理员已创建，默认币种和现金机构已初始化'); });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (modalLayer.classList.contains('is-open')) closeModal();
    else if (authPreview.classList.contains('is-open')) closeAuthPreview();
    else if (appShell.classList.contains('sidebar-open')) appShell.classList.remove('sidebar-open');
    profileMenu.classList.remove('is-open');
  });
})();
