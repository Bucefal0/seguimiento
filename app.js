const STORAGE_URL_NAME = 'sb_app_url';
const STORAGE_KEY_NAME = 'sb_app_pub_key';
let db = null;
let currentUser = null;
let latestDose = null;
let state = {
  context: 'morning',
  satiety: 3,
  food_noise: 1,
  gi_comfort: 5,
  tags: []
};

const CONTEXT_LABELS = {
  morning: 'Mañana',
  post_meal: 'Post-comida',
  night_xbox: 'Noche / Xbox',
  post_workout: 'Post-entreno',
  free: 'Libre'
};

function getClient() {
  if (db) return db;
  const savedUrl = localStorage.getItem(STORAGE_URL_NAME);
  const savedKey = localStorage.getItem(STORAGE_KEY_NAME);
  if (!savedUrl || !savedKey) return null;
  db = window.supabase.createClient(savedUrl, savedKey);
  return db;
}

function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = isError ? 'toast error' : 'toast';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function toLocalDatetimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function calcCycleDay(appliedAt) {
  if (!appliedAt) return null;
  const diffMs = Date.now() - new Date(appliedAt).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

document.getElementById('dose-date').value = toLocalDatetimeInput();
document.getElementById('w-date').value = toLocalDatetimeInput();

document.querySelectorAll('#context-chips .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#context-chips .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.context = btn.dataset.val;
  });
});

document.querySelectorAll('.scale-row').forEach(row => {
  const key = row.dataset.scale;
  row.querySelectorAll('.scale-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active', 'active-warn'));
      const val = parseInt(btn.dataset.val, 10);
      if (key === 'food_noise' && val >= 4) {
        btn.classList.add('active-warn');
      } else {
        btn.classList.add('active');
      }
      state[key] = val;
    });
  });
});

document.querySelectorAll('#tag-chips .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const tag = btn.dataset.tag;
    btn.classList.toggle('active');
    if (state.tags.includes(tag)) {
      state.tags = state.tags.filter(t => t !== tag);
    } else {
      state.tags.push(tag);
    }
  });
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['tab-checkin', 'tab-records', 'tab-history'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== btn.dataset.tab);
    });
    if (btn.dataset.tab === 'tab-history') {
      loadHistory();
    }
  });
});

async function checkSession() {
  const savedUrl = localStorage.getItem(STORAGE_URL_NAME);
  const savedKey = localStorage.getItem(STORAGE_KEY_NAME);
  if (savedUrl) document.getElementById('sb-url').value = savedUrl;
  if (savedKey) document.getElementById('api-key').value = savedKey;

  const client = getClient();
  if (!client) {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('bottom-nav').classList.add('hidden');
    return;
  }

  const { data: { session } } = await client.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('bottom-nav').classList.remove('hidden');
    await loadLatestDose();
  } else {
    currentUser = null;
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('bottom-nav').classList.add('hidden');
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const urlInput = document.getElementById('sb-url').value.trim();
  const keyInput = document.getElementById('api-key').value.trim();
  if (!urlInput || !keyInput) {
    showToast('Ingresa la URL y la clave pública de Supabase', true);
    return;
  }
  localStorage.setItem(STORAGE_URL_NAME, urlInput);
  localStorage.setItem(STORAGE_KEY_NAME, keyInput);
  db = null;
  const client = getClient();

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await client.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) {
    showToast('Error al entrar: ' + error.message, true);
  } else {
    await checkSession();
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  const client = getClient();
  if (client) await client.auth.signOut();
  await checkSession();
});

async function loadLatestDose() {
  const { data, error } = await getClient()
    .from('doses')
    .select('*')
    .order('applied_at', { ascending: false })
    .limit(1);

  const badge = document.getElementById('cycle-badge');
  if (!error && data && data.length > 0) {
    latestDose = data[0];
    const day = calcCycleDay(latestDose.applied_at);
    badge.textContent = `${latestDose.dose_mg} mg · Día ${day}`;
  } else {
    latestDose = null;
    badge.textContent = 'Registra tu dosis';
  }
}

document.getElementById('save-checkin-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-checkin-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const payload = {
    user_id: currentUser.id,
    dose_id: latestDose ? latestDose.id : null,
    cycle_day: latestDose ? calcCycleDay(latestDose.applied_at) : null,
    context: state.context,
    satiety: state.satiety,
    food_noise: state.food_noise,
    gi_comfort: state.gi_comfort,
    tags: state.tags,
    note: document.getElementById('checkin-note').value.trim() || null
  };

  const { error } = await getClient().from('check_ins').insert(payload);
  btn.disabled = false;
  btn.textContent = 'Guardar registro';

  if (error) {
    showToast('Error al guardar: ' + error.message, true);
  } else {
    showToast('Registro guardado');
    document.getElementById('checkin-note').value = '';
    state.tags = [];
    document.querySelectorAll('#tag-chips .chip').forEach(b => b.classList.remove('active'));
  }
});

document.getElementById('save-dose-btn').addEventListener('click', async () => {
  const dt = document.getElementById('dose-date').value;
  const payload = {
    user_id: currentUser.id,
    applied_at: dt ? new Date(dt).toISOString() : new Date().toISOString(),
    dose_mg: parseFloat(document.getElementById('dose-mg').value),
    injection_site: document.getElementById('dose-site').value,
    notes: document.getElementById('dose-notes').value.trim() || null
  };

  const { error } = await getClient().from('doses').insert(payload);
  if (error) {
    showToast('Error: ' + error.message, true);
  } else {
    showToast('Dosis registrada');
    document.getElementById('dose-notes').value = '';
    await loadLatestDose();
  }
});

document.getElementById('save-weight-btn').addEventListener('click', async () => {
  const weight = parseFloat(document.getElementById('w-kg').value);
  if (!weight) {
    showToast('Ingresa al menos tu peso en kg', true);
    return;
  }
  const dt = document.getElementById('w-date').value;
  const payload = {
    user_id: currentUser.id,
    measured_at: dt ? new Date(dt).toISOString() : new Date().toISOString(),
    weight_kg: weight,
    body_fat_pct: parseFloat(document.getElementById('w-fat').value) || null,
    muscle_mass_kg: parseFloat(document.getElementById('w-muscle').value) || null,
    visceral_fat: parseInt(document.getElementById('w-visceral').value, 10) || null,
    water_pct: parseFloat(document.getElementById('w-water').value) || null
  };

  const { error } = await getClient().from('weigh_ins').insert(payload);
  if (error) {
    showToast('Error: ' + error.message, true);
  } else {
    showToast('Medición de báscula guardada');
    ['w-kg', 'w-fat', 'w-muscle', 'w-visceral', 'w-water'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }
});

async function loadHistory() {
  const client = getClient();
  const { data: summary } = await client.from('v_cycle_summary').select('*');
  const tbody = document.getElementById('cycle-summary-body');
  if (!summary || summary.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Aún no hay suficientes datos.</td></tr>';
  } else {
    tbody.innerHTML = summary.map(r => `
      <tr>
        <td>${r.dose_mg ? r.dose_mg + ' mg' : '—'}</td>
        <td><strong>Día ${r.cycle_day ?? '—'}</strong></td>
        <td>${r.total_registros}</td>
        <td>${r.prom_saciedad}</td>
        <td>${r.prom_ruido_mental}</td>
        <td>${r.prom_bienestar_gi}</td>
      </tr>
    `).join('');
  }

  const { data: logs } = await client
    .from('check_ins')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(20);

  const container = document.getElementById('recent-logs');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="hint">Sin registros todavía.</p>';
  } else {
    container.innerHTML = logs.map(item => {
      const dateStr = new Date(item.recorded_at).toLocaleString('es-MX', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const tagsHtml = (item.tags || []).map(t => `<span class="tag-mini">#${t}</span>`).join('');
      return `
        <div class="log-item">
          <div class="log-top">
            <span>${dateStr} · <strong>${CONTEXT_LABELS[item.context] || item.context}</strong> ${item.cycle_day !== null ? `(Día ${item.cycle_day})` : ''}</span>
            <button class="del-btn" onclick="deleteCheckin('${item.id}')">Eliminar</button>
          </div>
          <div class="log-metrics">
            <span>Saciedad: ${item.satiety}/5</span>
            <span>Ruido: ${item.food_noise}/5</span>
            <span>Estómago: ${item.gi_comfort}/5</span>
          </div>
          ${tagsHtml ? `<div>${tagsHtml}</div>` : ''}
          ${item.note ? `<div class="hint" style="margin-top:4px;">"${item.note}"</div>` : ''}
        </div>
      `;
    }).join('');
  }
}

window.deleteCheckin = async (id) => {
  const { error } = await getClient().from('check_ins').delete().eq('id', id);
  if (error) {
    showToast('No se pudo eliminar', true);
  } else {
    showToast('Registro eliminado');
    await loadHistory();
  }
};

document.getElementById('refresh-btn').addEventListener('click', loadHistory);

document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const { data, error } = await getClient()
    .from('check_ins')
    .select('*')
    .order('recorded_at', { ascending: true });

  if (error || !data || data.length === 0) {
    showToast('No hay datos para exportar', true);
    return;
  }

  const headers = ['fecha_hora', 'dia_ciclo', 'contexto', 'saciedad', 'ruido_mental', 'bienestar_gi', 'etiquetas', 'nota'];
  const rows = data.map(r => [
    r.recorded_at,
    r.cycle_day ?? '',
    r.context,
    r.satiety,
    r.food_noise,
    r.gi_comfort,
    `"${(r.tags || []).join(';')}"`,
    `"${(r.note || '').replace(/"/g, '""')}"`
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seguimiento_checkins_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

checkSession();
