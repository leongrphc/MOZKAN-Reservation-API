(() => {
  'use strict';
  const API = '/api/v1';
  const PAGE = 20;
  const state = {
    token: null,
    user: null,
    organizations: [],
    org: null,
    revision: 0,
    eventPage: 0,
    reservationPage: 0,
    managementReservationPage: 0,
    auditPage: 0,
    events: new Map(),
    pendingKeys: new Map(),
    busy: false,
  };
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const errorNames = {
    INVALID_CREDENTIALS: 'E-posta veya şifre hatalı.',
    VALIDATION_ERROR: 'Bilgileri kontrol edin.',
    UNAUTHORIZED: 'Oturumunuz sona erdi; lütfen yeniden giriş yapın.',
    FORBIDDEN: 'Bu işlem için yetkiniz yok.',
    NOT_FOUND: 'Kayıt bulunamadı.',
    ALREADY_EXISTS: 'Bu kayıt zaten mevcut.',
    INSUFFICIENT_CAPACITY: 'Yeterli boş koltuk yok.',
    CAPACITY_EXCEEDED: 'Yeterli boş koltuk yok.',
    INVALID_EVENT_TIME: 'Başlangıç gelecekte, bitiş başlangıçtan sonra olmalı.',
    RATE_LIMITED: 'Çok fazla istek gönderildi. Biraz sonra tekrar deneyin.',
    CONFLICT: 'İşlem mevcut kayıtla çakışıyor.',
    IDEMPOTENCY_CONFLICT:
      'Aynı işlem anahtarı farklı bilgilerle kullanıldı. Yeni bir deneme yapın.',
    HOLD_EXPIRED: 'Rezervasyon bekletme süresi doldu.',
    RESERVATION_EXPIRED: 'Rezervasyonun süresi doldu.',
    RESERVATION_NOT_ACTIVE: 'Rezervasyon artık aktif değil.',
    EVENT_STARTED: 'Etkinlik başladı.',
  };
  const showStatus = (message, kind = 'message') => {
    status.replaceChildren();
    if (message) {
      if (kind === 'error') status.setAttribute('role', 'alert');
      else status.setAttribute('role', 'status');
      status.append(el('div', message, `status-${kind}`));
    }
  };
  const formatDate = (value) => {
    try {
      return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      );
    } catch {
      return value;
    }
  };
  const roleName = (role) => ({ OWNER: 'Sahip', MANAGER: 'Yönetici', MEMBER: 'Üye' })[role] || role;
  const statusName = (value) =>
    ({
      HELD: 'Beklemede',
      CONFIRMED: 'Onaylandı',
      CANCELLED: 'İptal edildi',
      EXPIRED: 'Süresi doldu',
    })[value] || value;
  const auditActionName = (value) =>
    ({
      RESERVATION_CREATED: 'Rezervasyon oluşturuldu',
      RESERVATION_CONFIRMED: 'Rezervasyon onaylandı',
      RESERVATION_CANCELLED: 'Rezervasyon iptal edildi',
      RESERVATION_EXPIRED: 'Rezervasyonun süresi doldu',
    })[value] || 'Rezervasyon işlemi';
  const setBusy = (busy) => {
    state.busy = busy;
    document.querySelectorAll('button, input, select').forEach((node) => {
      node.disabled = busy || node.dataset.unavailable === 'true';
    });
    $('app-view').setAttribute('aria-busy', String(busy));
  };
  const unavailable = (node, value = false) => {
    node.dataset.unavailable = String(value);
    node.disabled = state.busy || value;
  };
  const run = async (fn) => {
    if (state.busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };
  const api = async (path, options = {}) => {
    const headers = {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    };
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers });
    } catch {
      throw new Error('NETWORK');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new Error('NETWORK');
    }
    if (!response.ok) {
      const code = payload?.error?.code || 'UNKNOWN';
      const error = new Error(
        errorNames[code] || payload?.error?.message || 'İstek tamamlanamadı.',
      );
      error.code = code;
      error.httpStatus = response.status;
      error.authenticated = Boolean(state.token);
      throw error;
    }
    return payload;
  };
  const handleError = (error) => {
    if ((error.httpStatus === 401 || error.code === 'UNAUTHORIZED') && error.authenticated) {
      logout('Oturumunuz sona erdi; lütfen yeniden giriş yapın.');
      return;
    }
    showStatus(
      error.message === 'NETWORK'
        ? 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.'
        : error.message,
      'error',
    );
  };
  const authView = (loggedIn) => {
    $('auth-view').hidden = loggedIn;
    $('app-view').hidden = !loggedIn;
  };
  const resetOrgUi = () => {
    $('workspace').hidden = !state.org;
    $('no-org').hidden = !!state.org;
    $('event-form').hidden = !state.org || !['OWNER', 'MANAGER'].includes(state.org.role);
    $('member-form').hidden = !state.org || state.org.role !== 'OWNER';
    $('management-sections').hidden = !state.org || !['OWNER', 'MANAGER'].includes(state.org.role);
  };
  const renderOrganizations = () => {
    const select = $('organization-select');
    select.replaceChildren();
    const placeholder = el('option', 'Kuruluş seçin');
    placeholder.value = '';
    select.append(placeholder);
    state.organizations.forEach((org) => {
      const option = el('option', `${org.name} (${roleName(org.role)})`);
      option.value = org.id;
      select.append(option);
    });
    if (state.org) select.value = state.org.id;
    resetOrgUi();
  };
  const loadOrganizations = async () => {
    const result = await api('/organizations?limit=100&offset=0');
    state.organizations = result.data || [];
    if (!state.organizations.length) {
      state.org = null;
      renderOrganizations();
      return;
    }
    const chosen =
      state.organizations.find((org) => org.id === state.org?.id) || state.organizations[0];
    await selectOrganization(chosen.id, false);
  };
  const selectOrganization = async (id, announce = true) => {
    const org = state.organizations.find((item) => item.id === id);
    if (!org) {
      renderOrganizations();
      return;
    }
    state.revision += 1;
    const rev = state.revision;
    state.org = org;
    state.eventPage = 0;
    state.reservationPage = 0;
    state.managementReservationPage = 0;
    state.auditPage = 0;
    state.events.clear();
    $('events-list').replaceChildren(el('p', 'Etkinlikler yükleniyor…', 'muted'));
    $('reservations-list').replaceChildren(el('p', 'Rezervasyonlar yükleniyor…', 'muted'));
    $('events-pages').replaceChildren();
    $('reservations-pages').replaceChildren();
    $('management-reservations-list').replaceChildren(
      el('p', 'İşletme rezervasyonları yükleniyor…', 'muted'),
    );
    $('audit-list').replaceChildren(el('p', 'İşlem geçmişi yükleniyor…', 'muted'));
    $('management-reservations-pages').replaceChildren();
    $('audit-pages').replaceChildren();
    renderOrganizations();
    if (announce) showStatus(`${org.name} seçildi.`);
    await loadWorkspace(rev);
  };
  const loadWorkspace = async (rev = state.revision) => {
    if (!state.org) return;
    const orgId = state.org.id;
    await loadEvents(rev, orgId);
    if (rev === state.revision) await loadReservations(rev, orgId);
    if (rev === state.revision && ['OWNER', 'MANAGER'].includes(state.org.role)) {
      await Promise.all([loadManagementReservations(rev, orgId), loadAuditLogs(rev, orgId)]);
    }
  };
  const makeTable = (headers) => {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const row = document.createElement('tr');
    headers.forEach((name) => row.append(el('th', name)));
    head.append(row);
    table.append(head, document.createElement('tbody'));
    return table;
  };
  const renderPager = (container, page, hasNext, onChange) => {
    container.replaceChildren();
    const prev = el('button', 'Önceki');
    prev.type = 'button';
    unavailable(prev, page === 0);
    prev.addEventListener('click', () => run(() => onChange(page - 1)));
    const next = el('button', 'Sonraki');
    next.type = 'button';
    unavailable(next, !hasNext);
    next.addEventListener('click', () => run(() => onChange(page + 1)));
    container.append(prev, el('span', `Sayfa ${page + 1}`), next);
  };
  const loadEvents = async (rev = state.revision, orgId = state.org?.id) => {
    if (!orgId) return;
    const result = await api(
      `/organizations/${orgId}/events?limit=${PAGE}&offset=${state.eventPage * PAGE}`,
    );
    if (rev !== state.revision) return;
    const data = result.data || [];
    if (!data.length && state.eventPage > 0) {
      state.eventPage -= 1;
      return loadEvents(rev, orgId);
    }
    data.forEach((event) => state.events.set(event.id, event));
    renderEvents(data, data.length === PAGE);
  };
  const renderEvents = (events, hasNext) => {
    const wrap = $('events-list');
    wrap.replaceChildren();
    $('events-help').textContent = events.length
      ? 'Güncel müsaitlik bilgisi gösterilir.'
      : ['OWNER', 'MANAGER'].includes(state.org.role)
        ? 'Yukarıdaki formdan ilk etkinliğinizi oluşturun.'
        : 'Henüz etkinlik yok. İşletme yöneticiniz etkinlik oluşturduğunda burada görünür.';
    if (!events.length) {
      wrap.append(el('p', 'Bu sayfada etkinlik yok.', 'muted'));
    } else {
      const table = makeTable(['Etkinlik', 'Başlangıç', 'Bitiş', 'Kapasite', 'Müsait', 'İşlem']);
      const body = table.querySelector('tbody');
      events.forEach((event) => {
        const row = document.createElement('tr');
        row.append(
          el('td', event.title),
          el('td', formatDate(event.startsAt)),
          el('td', formatDate(event.endsAt)),
          el('td', event.capacity),
          el('td', event.availableSeats),
        );
        const action = el('td', undefined, 'table-action');
        const seats = document.createElement('input');
        seats.type = 'number';
        seats.min = '1';
        seats.max = String(event.availableSeats);
        seats.value = event.availableSeats > 0 ? '1' : '0';
        seats.setAttribute('aria-label', `${event.title} koltuk sayısı`);
        seats.className = 'seat-input';
        const closed = event.availableSeats < 1 || Date.parse(event.startsAt) <= Date.now();
        unavailable(seats, closed);
        const button = el('button', 'Koltuk ayır', 'primary');
        button.type = 'button';
        unavailable(button, closed);
        button.addEventListener('click', () => run(() => reserve(event, seats)));
        action.append(seats, button);
        row.append(action);
        body.append(row);
      });
      wrap.append(table);
    }
    renderPager($('events-pages'), state.eventPage, hasNext, async (page) => {
      state.eventPage = page;
      await loadEvents(state.revision, state.org.id);
    });
  };
  const reserve = async (event, seatsInput) => {
    const seats = Number(seatsInput.value);
    if (!Number.isInteger(seats) || seats < 1 || seats > event.availableSeats) {
      showStatus('Koltuk sayısı mevcut kapasite içinde olmalı.', 'error');
      return;
    }
    const key = `${state.org.id}:${event.id}:${seats}`;
    let idempotency = state.pendingKeys.get(key);
    if (!idempotency) {
      idempotency = `web-${crypto.randomUUID()}`;
      state.pendingKeys.set(key, idempotency);
    }
    const rev = state.revision;
    try {
      const reservation = await api(`/organizations/${state.org.id}/reservations`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotency },
        body: JSON.stringify({ eventId: event.id, seats }),
      });
      state.pendingKeys.delete(key);
      if (rev !== state.revision) return;
      state.reservationPage = 0;
      showStatus(
        reservation.status === 'HELD'
          ? 'Rezervasyon oluşturuldu. Onaylamak için rezervasyonlarınızı kontrol edin.'
          : `Önceki rezervasyonunuz: ${statusName(reservation.status).toLowerCase()}. Yeni yer ayırmak için tekrar deneyebilirsiniz.`,
        reservation.status === 'HELD' ? 'success' : 'message',
      );
      await loadWorkspace(rev);
    } catch (error) {
      if (error.httpStatus >= 400 && error.httpStatus < 500) state.pendingKeys.delete(key);
      if (rev === state.revision) handleError(error);
    }
  };
  const loadReservations = async (rev = state.revision, orgId = state.org?.id) => {
    if (!orgId) return;
    const result = await api(
      `/organizations/${orgId}/reservations?limit=${PAGE}&offset=${state.reservationPage * PAGE}`,
    );
    if (rev !== state.revision) return;
    const data = result.data || [];
    if (!data.length && state.reservationPage > 0) {
      state.reservationPage -= 1;
      return loadReservations(rev, orgId);
    }
    const missingEvents = [...new Set(data.map((reservation) => reservation.eventId))].filter(
      (id) => !state.events.has(id),
    );
    for (const id of missingEvents) {
      const event = await api(`/organizations/${orgId}/events/${id}`);
      if (rev !== state.revision) return;
      state.events.set(id, event);
    }
    renderReservations(data, data.length === PAGE);
  };
  const renderReservations = (reservations, hasNext) => {
    const wrap = $('reservations-list');
    wrap.replaceChildren();
    if (!reservations.length) wrap.append(el('p', 'Henüz rezervasyonunuz yok.', 'muted'));
    else {
      const table = makeTable(['Etkinlik', 'Koltuk', 'Durum', 'Sona erme', 'İşlem']);
      const body = table.querySelector('tbody');
      reservations.forEach((reservation) => {
        const row = document.createElement('tr');
        const event = state.events.get(reservation.eventId);
        row.append(
          el('td', event?.title || 'Etkinlik'),
          el('td', reservation.seats),
          el('td', statusName(reservation.status)),
          el('td', reservation.expiresAt ? formatDate(reservation.expiresAt) : '-'),
        );
        const actions = el('td', undefined, 'table-action');
        if (reservation.status === 'HELD') {
          const confirm = el('button', 'Onayla', 'primary');
          confirm.type = 'button';
          unavailable(confirm);
          confirm.addEventListener('click', () =>
            run(() => reservationAction(reservation, 'confirm')),
          );
          actions.append(confirm);
        }
        if (reservation.status === 'HELD' || reservation.status === 'CONFIRMED') {
          const cancel = el('button', 'İptal et', 'secondary');
          cancel.type = 'button';
          unavailable(cancel);
          cancel.addEventListener('click', () =>
            run(() => reservationAction(reservation, 'cancel')),
          );
          actions.append(cancel);
        }
        row.append(actions);
        body.append(row);
      });
      wrap.append(table);
    }
    renderPager($('reservations-pages'), state.reservationPage, hasNext, async (page) => {
      state.reservationPage = page;
      await loadReservations(state.revision, state.org.id);
    });
  };
  const loadManagementReservations = async (rev = state.revision, orgId = state.org?.id) => {
    if (!orgId) return;
    const result = await api(
      `/organizations/${orgId}/management/reservations?limit=${PAGE}&offset=${state.managementReservationPage * PAGE}`,
    );
    if (rev !== state.revision) return;
    const data = result.data || [];
    if (!data.length && state.managementReservationPage > 0) {
      state.managementReservationPage -= 1;
      return loadManagementReservations(rev, orgId);
    }
    renderManagementReservations(data, data.length === PAGE);
  };
  const renderManagementReservations = (reservations, hasNext) => {
    const wrap = $('management-reservations-list');
    wrap.replaceChildren();
    if (!reservations.length) {
      wrap.append(el('p', 'Henüz işletme rezervasyonu yok.', 'muted'));
    } else {
      const table = makeTable([
        'Etkinlik',
        'Katılımcı',
        'Koltuk',
        'Durum',
        'Sona erme',
        'Oluşturma',
      ]);
      const body = table.querySelector('tbody');
      reservations.forEach((reservation) => {
        const row = document.createElement('tr');
        row.append(
          el('td', reservation.eventTitle || 'Etkinlik'),
          el('td', reservation.userName || reservation.userEmail || 'Kullanıcı'),
          el('td', reservation.seats),
          el('td', statusName(reservation.status)),
          el('td', reservation.expiresAt ? formatDate(reservation.expiresAt) : '-'),
          el('td', formatDate(reservation.createdAt)),
        );
        body.append(row);
      });
      wrap.append(table);
    }
    renderPager(
      $('management-reservations-pages'),
      state.managementReservationPage,
      hasNext,
      async (page) => {
        state.managementReservationPage = page;
        await loadManagementReservations(state.revision, state.org.id);
      },
    );
  };
  const loadAuditLogs = async (rev = state.revision, orgId = state.org?.id) => {
    if (!orgId) return;
    const result = await api(
      `/organizations/${orgId}/management/audit-logs?limit=${PAGE}&offset=${state.auditPage * PAGE}`,
    );
    if (rev !== state.revision) return;
    const data = result.data || [];
    if (!data.length && state.auditPage > 0) {
      state.auditPage -= 1;
      return loadAuditLogs(rev, orgId);
    }
    renderAuditLogs(data, data.length === PAGE);
  };
  const renderAuditLogs = (logs, hasNext) => {
    const wrap = $('audit-list');
    wrap.replaceChildren();
    if (!logs.length) {
      wrap.append(el('p', 'Henüz işlem geçmişi yok.', 'muted'));
    } else {
      const table = makeTable(['İşlem', 'Etkinlik', 'Kullanıcı', 'Koltuk', 'Durum', 'Tarih']);
      const body = table.querySelector('tbody');
      logs.forEach((log) => {
        const metadata = log.metadata || {};
        const actor =
          log.userName || (log.action === 'RESERVATION_EXPIRED' ? 'Otomatik' : 'Kullanıcı');
        const row = document.createElement('tr');
        row.append(
          el('td', auditActionName(log.action)),
          el('td', log.eventTitle || 'Etkinlik'),
          el('td', actor),
          el('td', metadata.seats == null ? '-' : metadata.seats),
          el('td', metadata.status ? statusName(metadata.status) : '-'),
          el('td', formatDate(log.createdAt)),
        );
        body.append(row);
      });
      wrap.append(table);
    }
    renderPager($('audit-pages'), state.auditPage, hasNext, async (page) => {
      state.auditPage = page;
      await loadAuditLogs(state.revision, state.org.id);
    });
  };
  const reservationAction = async (reservation, action) => {
    const rev = state.revision;
    try {
      await api(`/organizations/${state.org.id}/reservations/${reservation.id}/${action}`, {
        method: 'POST',
      });
      if (rev !== state.revision) return;
      showStatus(
        action === 'confirm' ? 'Rezervasyon onaylandı.' : 'Rezervasyon iptal edildi.',
        'success',
      );
      await loadWorkspace(rev);
    } catch (error) {
      if (rev === state.revision) handleError(error);
    }
  };
  const submit = async (form, fn) => {
    if (state.busy) return;
    const data = new FormData(form);
    await run(() => fn(data, form));
  };
  const login = async (data, register = false) => {
    const payload = Object.fromEntries(data.entries());
    const result = await api(`/auth/${register ? 'register' : 'login'}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.token = result.accessToken;
    state.user = result.user;
    state.revision += 1;
    $('event-form').reset();
    $('member-form').reset();
    $('org-form').reset();
    $('user-caption').textContent = `${state.user.name} · ${state.user.email}`;
    authView(true);
    showStatus('Hoş geldiniz.', 'success');
    await loadOrganizations();
  };
  const logout = (message) => {
    state.token = null;
    state.user = null;
    state.organizations = [];
    state.org = null;
    state.events.clear();
    state.pendingKeys.clear();
    state.revision += 1;
    $('login-form').reset();
    $('register-form').reset();
    authView(false);
    showStatus(message || 'Çıkış yapıldı.', message ? 'error' : 'success');
  };
  $('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submit(event.currentTarget, (data) => login(data));
  });
  $('register-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submit(event.currentTarget, (data) => login(data, true));
  });
  const fillDemo = (email) => {
    $('login-email').value = email;
    $('login-password').value = 'MozkanDemo2026!';
    $('login-email').focus();
  };
  $('demo-owner').addEventListener('click', () => fillDemo('owner@mozkan.dev'));
  $('demo-member').addEventListener('click', () => fillDemo('member@mozkan.dev'));
  $('logout').addEventListener('click', () => logout());
  $('organization-select').addEventListener('change', (event) => {
    const id = event.target.value;
    run(() => selectOrganization(id));
  });
  $('refresh').addEventListener('click', () => {
    run(async () => {
      await loadWorkspace();
      showStatus('Listeler yenilendi.', 'success');
    });
  });
  $('org-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submit(event.currentTarget, async (data) => {
      const result = await api('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name') }),
      });
      $('org-form').reset();
      state.organizations.push(result);
      await selectOrganization(result.id);
      showStatus('Kuruluş oluşturuldu.', 'success');
    });
  });
  $('event-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async (data) => {
      const startsAt = new Date(data.get('startsAt')).toISOString();
      const endsAt = new Date(data.get('endsAt')).toISOString();
      await api(`/organizations/${state.org.id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          title: data.get('title'),
          startsAt,
          endsAt,
          capacity: Number(data.get('capacity')),
        }),
      });
      form.reset();
      showStatus('Etkinlik oluşturuldu.', 'success');
      state.eventPage = 0;
      await loadWorkspace(state.revision);
    });
  });
  $('member-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, async (data) => {
      await api(`/organizations/${state.org.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), role: data.get('role') }),
      });
      form.reset();
      showStatus('Üye eklendi.', 'success');
    });
  });
  authView(false);
  resetOrgUi();
})();
