const STORAGE_URL_NAME = 'sb_app_url';
const STORAGE_KEY_NAME = 'sb_app_pub_key';
const STORAGE_DS_KEY = 'ds_api_key';

let db = null;
let currentUser = null;
let latestDose = null;
let cycleChartInstance = null;
let weightChartInstance = null;

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

const EXPECTED_MODEL = {
  '2.5': [
    { day: 0, phase: 'Día 0 · Aplicación', satMin: 3.0, satMax: 4.0, noiseMax: 3.0, desc: 'El medicamento empieza a absorberse; el pico de efecto llega entre 24 y 48 horas.' },
    { day: 1, phase: 'Día 1 · Subida rápida', satMin: 3.8, satMax: 5.0, noiseMax: 2.0, desc: 'Alta concentración inicial. Se espera saciedad marcada y poco ruido mental.' },
    { day: 2, phase: 'Día 2 · Pico de efecto', satMin: 3.8, satMax: 5.0, noiseMax: 2.0, desc: 'Punto máximo de concentración. Cuida hidratación y porciones pequeñas en la noche.' },
    { day: 3, phase: 'Día 3 · Meseta estable', satMin: 3.5, satMax: 4.5, noiseMax: 2.5, desc: 'Efecto sólido y equilibrado; suele ser el punto más cómodo para digerir.' },
    { day: 4, phase: 'Día 4 · Descenso gradual', satMin: 3.0, satMax: 4.2, noiseMax: 3.0, desc: 'El nivel empieza a bajar. Prioriza proteína primero para sostener la saciedad.' },
    { day: 5, phase: 'Día 5 · Vida media (~50%)', satMin: 2.5, satMax: 3.8, noiseMax: 3.5, desc: 'La concentración ronda la mitad. Es normal notar algo más de apetito en la tarde.' },
    { day: 6, phase: 'Día 6 · Valle semanal', satMin: 2.0, satMax: 3.5, noiseMax: 4.0, desc: 'Nivel más bajo antes de la siguiente dosis; en 2.5 mg es común que regresen antojos.' }
  ],
  '3.5': [
    { day: 0, phase: 'Día 0 · Aplicación ~3.5 mg', satMin: 3.2, satMax: 4.2, noiseMax: 2.8, desc: 'Escalón intermedio estimado; absorción progresiva sobre la base previa.' },
    { day: 1, phase: 'Día 1 · Subida firme', satMin: 4.0, satMax: 5.0, noiseMax: 1.8, desc: 'Saciedad alta y menos ruido mental que con 2.5 mg. Prioriza proteína.' },
    { day: 2, phase: 'Día 2 · Pico intermedio', satMin: 4.0, satMax: 5.0, noiseMax: 1.8, desc: 'Punto máximo de concentración; mantén cenas ligeras para evitar reflujo.' },
    { day: 3, phase: 'Día 3 · Meseta sólida', satMin: 3.7, satMax: 4.7, noiseMax: 2.2, desc: 'Buen balance entre saciedad sostenida y comodidad digestiva.' },
    { day: 4, phase: 'Día 4 · Estabilidad media', satMin: 3.2, satMax: 4.3, noiseMax: 2.7, desc: 'Descenso más amortiguado que con 2.5 mg; cuida hidratación.' },
    { day: 5, phase: 'Día 5 · Vida media (~50%)', satMin: 2.8, satMax: 4.0, noiseMax: 3.2, desc: 'Ligero repunte de apetito hacia la tarde; apóyate en proteína magra.' },
    { day: 6, phase: 'Día 6 · Valle semanal', satMin: 2.4, satMax: 3.7, noiseMax: 3.6, desc: 'Nivel más bajo antes de la siguiente aplicación; prepara snacks seguros en la noche.' }
  ],
  '5.0': [
    { day: 0, phase: 'Día 0 · Aplicación 5 mg', satMin: 3.5, satMax: 4.5, noiseMax: 2.5, desc: 'Nueva dosis terapéutica; transición gradual sobre el remanente de la semana previa.' },
    { day: 1, phase: 'Día 1 · Pico alto', satMin: 4.2, satMax: 5.0, noiseMax: 1.5, desc: 'Saciedad muy fuerte. Vigila no saltarte proteína ni cenar pesado por riesgo de reflujo.' },
    { day: 2, phase: 'Día 2 · Pico sostenido', satMin: 4.2, satMax: 5.0, noiseMax: 1.5, desc: 'Máximo freno gástrico. Cenas líquidas o muy ligeras si entrenas tarde.' },
    { day: 3, phase: 'Día 3 · Meseta firme', satMin: 4.0, satMax: 4.8, noiseMax: 2.0, desc: 'Control sólido del apetito con mejor tolerancia digestiva.' },
    { day: 4, phase: 'Día 4 · Estabilidad media', satMin: 3.5, satMax: 4.5, noiseMax: 2.5, desc: 'Con 5 mg el descenso se amortigua mejor que con 2.5 mg.' },
    { day: 5, phase: 'Día 5 · Vida media (~50%)', satMin: 3.2, satMax: 4.2, noiseMax: 2.8, desc: 'Ligero aumento de apetito manejable con proteína y agua.' },
    { day: 6, phase: 'Día 6 · Valle semanal', satMin: 2.8, satMax: 4.0, noiseMax: 3.2, desc: 'Punto más bajo del ciclo, pero normalmente con mejor piso que en 2.5 mg.' }
  ]
};

function getExpectedFor(doseMg, day) {
  const d = doseMg ? parseFloat(doseMg) : 2.5;
  const key = d >= 5.0 ? '5.0' : (d >= 3.0 ? '3.5' : '2.5');
  const clampedDay = Math.min(6, Math.max(0, day ?? 0));
  return { key, list: EXPECTED_MODEL[key], current: EXPECTED_MODEL[key][clampedDay] };
}

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBulletsHtml(rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim().replace(/^[-*•]\s*/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'))
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
}

function buildInstantTips(entry) {
  const tips = [];
  const day = entry.cycle_day;

  if ((entry.context === 'night_xbox' || entry.tags.includes('xbox')) && entry.food_noise >= 3) {
    tips.push('Noche de Xbox con antojo: ten a la mano bastones de pepino/jícama con limón o edamames, y sirve cualquier snack en porción cerrada desde la cocina.');
  }
  if (entry.gi_comfort <= 2 || entry.tags.includes('reflujo')) {
    tips.push('Para frenar el reflujo hoy: cena sólida ligera, cero grasas antes de dormir y evita tomar mucha agua junto con la comida de la noche.');
  }
  if (entry.satiety >= 5 && day !== null && day <= 2) {
    tips.push('Estás en pico de saciedad: asegúrate de cubrir tu proteína del día (pollo, claras o batido aislado) para seguir protegiendo tu masa muscular.');
  }
  if (entry.tags.includes('poca_agua') || (entry.food_noise >= 4 && !entry.tags.includes('agua_2l'))) {
    tips.push('Toma un vaso grande de agua fría (o agua mineral con limón) antes de decidir si realmente tienes hambre; el medicamento adormece la sed.');
  }
  if (day !== null && day >= 5 && entry.food_noise >= 3) {
    tips.push(`Día ${day} del ciclo: es normal sentir un poco más de ruido mental porque la dosis va bajando. Prioriza proteína primero en tu siguiente comida.`);
  }
  if (tips.length === 0) {
    tips.push('Buen equilibrio en este registro. Mantén hidratación constante y cenas ligeras si entrenas tarde.');
  }
  return tips;
}

async function askDeepSeek(systemPrompt, userPrompt, maxTokens = 280) {
  const dsKey = localStorage.getItem(STORAGE_DS_KEY);
  if (!dsKey) return null;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${dsKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: maxTokens
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

const SYSTEM_PROMPT_COACH = `Eres un asistente práctico de seguimiento metabólico para un paciente hombre de 50 años (1.78 m) en tratamiento con Tirzepatida (titulación gradual de 2.5 mg -> ~3.5 mg -> 5.0 mg, evaluando tiroides con TSH basal elevada).
Contexto clave:
- Entrena spinning (8-9 pm) y funcional (9-10 pm), llega a casa 10:30 pm y duerme 12:00 am.
- Cuida proteger masa muscular (meta 110-130 g proteína/día), evitar reflujo nocturno y controlar snacks automáticos en noches de Xbox (especialmente día 5-6 del ciclo).
Reglas de respuesta:
- Responde en español claro, directo y cercano.
- Entrega exactamente 2 o 3 viñetas cortas (máximo 2 líneas cada una), sin saludos ni despedidas.
- Si el usuario escribió una nota de comida o síntoma, al menos una viñeta debe referirse directamente a ese alimento o situación específica y relacionarlo con su historial reciente si hay patrones.`;

function updateDsStatusUI() {
  const savedDs = localStorage.getItem(STORAGE_DS_KEY);
  const statusEl = document.getElementById('ds-status');
  const inputEl = document.getElementById('ds-key-input');
  if (savedDs) {
    statusEl.textContent = 'Activa';
    statusEl.style.color = '#34d399';
    inputEl.value = savedDs;
  } else {
    statusEl.textContent = 'No configurada';
    statusEl.style.color = '#94a3b8';
  }
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
  updateDsStatusUI();

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

document.getElementById('save-ds-key-btn').addEventListener('click', () => {
  const val = document.getElementById('ds-key-input').value.trim();
  if (!val) {
    localStorage.removeItem(STORAGE_DS_KEY);
    updateDsStatusUI();
    showToast('Clave DeepSeek eliminada');
  } else {
    localStorage.setItem(STORAGE_DS_KEY, val);
    updateDsStatusUI();
    showToast('Clave DeepSeek guardada');
  }
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
    tags: [...state.tags],
    note: document.getElementById('checkin-note').value.trim() || null
  };

  const { error } = await getClient().from('check_ins').insert(payload);
  btn.disabled = false;
  btn.textContent = 'Guardar registro';

  if (error) {
    showToast('Error al guardar: ' + error.message, true);
    return;
  }

  showToast('Registro guardado');
  const tipBox = document.getElementById('instant-tip-box');
  tipBox.classList.remove('hidden');

  const dsKey = localStorage.getItem(STORAGE_DS_KEY);
  if (dsKey) {
    tipBox.innerHTML = `<h3><span>Recomendación del momento</span><span class="ai-badge">DeepSeek IA...</span></h3><p class="hint" style="margin:0;">Analizando tu nota y tus últimos días...</p>`;
    try {
      const { data: recent } = await getClient()
        .from('check_ins')
        .select('recorded_at, cycle_day, context, satiety, food_noise, gi_comfort, tags, note')
        .order('recorded_at', { ascending: false })
        .limit(8);

      const historyLines = (recent || []).slice(1).map(r => {
        const f = new Date(r.recorded_at).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return `- [${f} · Día ${r.cycle_day ?? '?'} · ${CONTEXT_LABELS[r.context] || r.context}] Sac:${r.satiety}/5, Ruido:${r.food_noise}/5, Est:${r.gi_comfort}/5${r.note ? ` | Nota: "${r.note}"` : ''}`;
      }).join('\n');

      const userPrompt = `Registro actual (${new Date().toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}):
- Dosis: ${latestDose ? latestDose.dose_mg + ' mg' : 'N/A'} | Día del ciclo: ${payload.cycle_day ?? 'N/A'}
- Momento: ${CONTEXT_LABELS[payload.context] || payload.context}
- Saciedad: ${payload.satiety}/5 | Ruido mental: ${payload.food_noise}/5 | Estómago: ${payload.gi_comfort}/5
- Etiquetas: ${payload.tags.length ? payload.tags.join(', ') : 'ninguna'}
- Nota escrita por el usuario: ${payload.note ? `"${payload.note}"` : '(sin texto)'}

Historial previo reciente (para detectar continuidad):
${historyLines || '(primer registro)'}`;

      const aiText = await askDeepSeek(SYSTEM_PROMPT_COACH, userPrompt, 260);
      if (aiText) {
        tipBox.innerHTML = `<h3><span>Recomendación del momento</span><span class="ai-badge">DeepSeek IA</span></h3>${formatBulletsHtml(aiText)}`;
      } else {
        throw new Error('Respuesta vacía');
      }
    } catch (err) {
      const tips = buildInstantTips(payload);
      tipBox.innerHTML = `<h3><span>Recomendación del momento</span><span class="hint">Modo local</span></h3><ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>`;
      showToast('DeepSeek no respondió, usando modo local', true);
    }
  } else {
    const tips = buildInstantTips(payload);
    tipBox.innerHTML = `<h3><span>Recomendación del momento</span></h3><ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>`;
  }

  document.getElementById('checkin-note').value = '';
  state.tags = [];
  document.querySelectorAll('#tag-chips .chip').forEach(b => b.classList.remove('active'));
});

document.getElementById('analyze-deepseek-btn').addEventListener('click', async () => {
  const dsKey = localStorage.getItem(STORAGE_DS_KEY);
  if (!dsKey) {
    showToast('Pega primero tu clave de DeepSeek abajo en esta pestaña', true);
    document.getElementById('ds-key-input').focus();
    return;
  }

  const btn = document.getElementById('analyze-deepseek-btn');
  const box = document.getElementById('deepseek-weekly-box');
  btn.disabled = true;
  btn.textContent = '🤖 Analizando tus últimos 7 días...';

  try {
    const client = getClient();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [logsRes, weightsRes] = await Promise.all([
      client.from('check_ins').select('*').gte('recorded_at', since).order('recorded_at', { ascending: true }),
      client.from('weigh_ins').select('*').order('measured_at', { ascending: false }).limit(3)
    ]);

    const logs = logsRes.data || [];
    const weights = weightsRes.data || [];

    const logsText = logs.map(r => {
      const f = new Date(r.recorded_at).toLocaleString('es-MX', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `- [${f} · Día ${r.cycle_day ?? '?'} · ${CONTEXT_LABELS[r.context] || r.context}] Sac:${r.satiety}/5, Ruido:${r.food_noise}/5, Est:${r.gi_comfort}/5${r.tags?.length ? ` | Tags:${r.tags.join(',')}` : ''}${r.note ? ` | Nota:"${r.note}"` : ''}`;
    }).join('\n');

    const wText = weights.map(w => `${new Date(w.measured_at).toLocaleDateString('es-MX')}: ${w.weight_kg}kg (Grasa ${w.body_fat_pct ?? '?'}%, Músculo ${w.muscle_mass_kg ?? '?'}kg)`).join(' | ');

    const weeklyPrompt = `Analiza los últimos 7 días del paciente (dosis actual: ${latestDose ? latestDose.dose_mg + ' mg, Día ' + calcCycleDay(latestDose.applied_at) : 'N/A'}).
Báscula reciente: ${wText || 'Sin registros'}
Check-ins (${logs.length}):
${logsText || '(sin registros)'}

Entrega en máximo 4 viñetas:
1) Qué comidas o momentos se asociaron con mejor saciedad o digestión.
2) Qué detonó ruido mental o reflujo (si hubo).
3) Cómo va la curva respecto al día del ciclo.
4) Dos ajustes concretos para los próximos días.`;

    const aiText = await askDeepSeek(SYSTEM_PROMPT_COACH, weeklyPrompt, 380);
    box.innerHTML = `<h3><span>Análisis semanal personalizado</span><span class="ai-badge">DeepSeek IA</span></h3>${formatBulletsHtml(aiText || 'Sin respuesta.')}`;
    box.classList.remove('hidden');
  } catch (err) {
    showToast('Error al consultar DeepSeek: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Analizar mis últimos 7 días con DeepSeek';
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

function renderExpectedVsActual(summary) {
  const box = document.getElementById('expected-box');
  if (!latestDose) {
    box.innerHTML = '<p class="hint">Registra tu última dosis para comparar tus datos contra el día del ciclo.</p>';
    return;
  }

  const day = calcCycleDay(latestDose.applied_at);
  const { key, current } = getExpectedFor(latestDose.dose_mg, day);
  const rowToday = (summary || []).find(r => r.cycle_day === day && parseFloat(r.dose_mg) === parseFloat(latestDose.dose_mg))
    || (summary || []).find(r => r.cycle_day === day);

  const realSat = rowToday ? parseFloat(rowToday.prom_saciedad) : null;
  const realNoise = rowToday ? parseFloat(rowToday.prom_ruido_mental) : null;
  const realGi = rowToday ? parseFloat(rowToday.prom_bienestar_gi) : null;

  const satClass = realSat === null ? 'status-info' : (realSat >= current.satMin ? 'status-ok' : 'status-warn');
  const noiseClass = realNoise === null ? 'status-info' : (realNoise <= current.noiseMax ? 'status-ok' : 'status-warn');
  const giClass = realGi === null ? 'status-info' : (realGi >= 3.5 ? 'status-ok' : 'status-warn');

  box.innerHTML = `
    <div class="phase-box">
      <div class="phase-title">${current.phase} (${key} mg)</div>
      <div class="hint">${current.desc}</div>
    </div>
    <div class="compare-grid">
      <div class="compare-cell">
        <span class="lbl">Saciedad real</span>
        <span class="val ${satClass}">${realSat !== null ? realSat + '/5' : '—'}</span>
        <span class="exp">Esperado: ${current.satMin}–${current.satMax}</span>
      </div>
      <div class="compare-cell">
        <span class="lbl">Ruido mental</span>
        <span class="val ${noiseClass}">${realNoise !== null ? realNoise + '/5' : '—'}</span>
        <span class="exp">Esperado: ≤ ${current.noiseMax}</span>
      </div>
      <div class="compare-cell">
        <span class="lbl">Estómago</span>
        <span class="val ${giClass}">${realGi !== null ? realGi + '/5' : '—'}</span>
        <span class="exp">Ideal: ≥ 3.5</span>
      </div>
    </div>
  `;
}

function renderCycleChart(summary) {
  const ctx = document.getElementById('cycle-chart').getContext('2d');
  const { list } = getExpectedFor(latestDose ? latestDose.dose_mg : 2.5, 0);
  const days = [0, 1, 2, 3, 4, 5, 6];
  const labels = days.map(d => `Día ${d}`);

  const realSat = days.map(d => {
    const match = (summary || []).find(r => r.cycle_day === d);
    return match ? parseFloat(match.prom_saciedad) : null;
  });
  const realNoise = days.map(d => {
    const match = (summary || []).find(r => r.cycle_day === d);
    return match ? parseFloat(match.prom_ruido_mental) : null;
  });
  const expSatMid = list.map(item => Number(((item.satMin + item.satMax) / 2).toFixed(2)));

  if (cycleChartInstance) cycleChartInstance.destroy();
  cycleChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Saciedad real',
          data: realSat,
          borderColor: '#2dd4bf',
          backgroundColor: '#2dd4bf',
          tension: 0.3,
          spanGaps: true,
          borderWidth: 3
        },
        {
          label: 'Saciedad esperada',
          data: expSatMid,
          borderColor: '#64748b',
          borderDash: [5, 5],
          pointRadius: 2,
          tension: 0.3,
          borderWidth: 2
        },
        {
          label: 'Ruido mental real',
          data: realNoise,
          borderColor: '#fb923c',
          backgroundColor: '#fb923c',
          tension: 0.3,
          spanGaps: true,
          borderWidth: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 1, max: 5, ticks: { stepSize: 1, color: '#94a3b8' }, grid: { color: '#334155' } },
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
      },
      plugins: {
        legend: { labels: { color: '#f8fafc', boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}

function renderInsights(summary, logs, weights) {
  const box = document.getElementById('insights-box');
  const items = [];

  if (weights && weights.length >= 2) {
    const first = weights[0];
    const last = weights[weights.length - 1];
    const diff = (last.weight_kg - first.weight_kg).toFixed(2);
    const weeks = Math.max(1, (new Date(last.measured_at) - new Date(first.measured_at)) / (1000 * 60 * 60 * 24 * 7));
    const avgWeek = (diff / weeks).toFixed(2);
    items.push({
      cls: 'blue',
      text: `<strong>Tendencia de peso:</strong> Llevas <strong>${diff} kg</strong> en total (promedio de <strong>${avgWeek} kg/semana</strong>).`
    });
  }

  if (summary && summary.length >= 2) {
    const sortedByNoise = [...summary].sort((a, b) => b.prom_ruido_mental - a.prom_ruido_mental);
    const peak = sortedByNoise[0];
    if (parseFloat(peak.prom_ruido_mental) >= 2.5) {
      items.push({
        cls: 'warn',
        text: `<strong>Tu día más vulnerable:</strong> El <strong>Día ${peak.cycle_day}</strong> promedias un ruido mental de <strong>${peak.prom_ruido_mental}/5</strong>. Conviene preparar snacks seguros ese día.`
      });
    }
  }

  if (logs && logs.length >= 3) {
    const xboxLogs = logs.filter(l => l.context === 'night_xbox' || (l.tags || []).includes('xbox'));
    if (xboxLogs.length >= 1) {
      const avgXboxNoise = (xboxLogs.reduce((s, l) => s + l.food_noise, 0) / xboxLogs.length).toFixed(1);
      items.push({
        cls: 'warn',
        text: `<strong>Momento Xbox:</strong> En ${xboxLogs.length} registro(s) nocturnos tu ruido mental promedia <strong>${avgXboxNoise}/5</strong>.`
      });
    }

    const refluxLogs = logs.filter(l => l.gi_comfort <= 2 || (l.tags || []).includes('reflujo'));
    if (refluxLogs.length >= 1) {
      items.push({
        cls: 'warn',
        text: `<strong>Alerta digestiva:</strong> Detectamos <strong>${refluxLogs.length}</strong> episodio(s) de incomodidad gástrica o reflujo. Cuida cenas ligeras 3 h antes de dormir.`
      });
    } else {
      items.push({
        cls: '',
        text: `<strong>Buena tolerancia gástrica:</strong> Sin episodios recientes de reflujo fuerte en tus registros.`
      });
    }
  }

  if (items.length === 0) {
    box.innerHTML = '<p class="hint">Haz al menos 3 check-ins para que la app empiece a detectar tus patrones.</p>';
  } else {
    box.innerHTML = items.map(i => `<div class="insight-item ${i.cls}">${i.text}</div>`).join('');
  }
}

function renderWeights(weights) {
  const kpiBox = document.getElementById('weight-kpis');
  const tbody = document.getElementById('weighin-table-body');
  if (!weights || weights.length === 0) {
    kpiBox.innerHTML = '<p class="hint" style="grid-column:1/-1;">Aún no hay mediciones de báscula en la nube.</p>';
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="hint">Aún no hay mediciones registradas.</td></tr>';
    return;
  }

  const first = weights[0];
  const last = weights[weights.length - 1];
  const diff = (last.weight_kg - first.weight_kg).toFixed(2);
  const fatDiff = (last.body_fat_pct && first.body_fat_pct)
    ? (last.body_fat_pct - first.body_fat_pct).toFixed(1) + '%'
    : '—';

  kpiBox.innerHTML = `
    <div class="compare-cell">
      <span class="lbl">Peso actual</span>
      <span class="val status-info">${Number(last.weight_kg).toFixed(2)} kg</span>
    </div>
    <div class="compare-cell">
      <span class="lbl">Cambio total</span>
      <span class="val status-ok">${diff} kg</span>
    </div>
    <div class="compare-cell">
      <span class="lbl">% Grasa</span>
      <span class="val">${last.body_fat_pct ?? '—'}% (${fatDiff})</span>
    </div>
  `;

  if (tbody) {
    const firstKg = Number(first.weight_kg);
    const firstFatKg = first.body_fat_pct ? firstKg * (Number(first.body_fat_pct) / 100) : null;

    const rowsHtml = weights.map((w, idx) => {
      const kg = Number(w.weight_kg);
      const prevKg = idx > 0 ? Number(weights[idx - 1].weight_kg) : null;
      const semDiff = prevKg !== null ? kg - prevKg : null;
      const acumDiff = idx > 0 ? kg - firstKg : null;
      const fatPct = w.body_fat_pct !== null && w.body_fat_pct !== undefined ? Number(w.body_fat_pct) : null;
      const fatKg = fatPct !== null ? kg * (fatPct / 100) : null;
      const muscKg = w.muscle_mass_kg !== null && w.muscle_mass_kg !== undefined ? Number(w.muscle_mass_kg) : null;
      const dateStr = new Date(w.measured_at).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });

      const semStr = semDiff === null ? '—' : `${semDiff > 0 ? '+' : ''}${semDiff.toFixed(2)}`;
      const semCls = semDiff === null ? '' : (semDiff <= 0 ? 'status-ok' : 'status-warn');
      const acumStr = acumDiff === null ? '—' : `${acumDiff > 0 ? '+' : ''}${acumDiff.toFixed(2)}`;

      return `
        <tr>
          <td>${idx}</td>
          <td>${dateStr}</td>
          <td><strong>${kg.toFixed(2)}</strong></td>
          <td class="${semCls}">${semStr}</td>
          <td class="status-info">${acumStr}</td>
          <td>${fatPct !== null ? fatPct.toFixed(1) + '%' : '—'}</td>
          <td>${fatKg !== null ? fatKg.toFixed(2) : '—'}</td>
          <td>${muscKg !== null ? muscKg.toFixed(2) : '—'}</td>
          <td>${w.visceral_fat ?? '—'}</td>
          <td>${w.water_pct !== null && w.water_pct !== undefined ? Number(w.water_pct).toFixed(1) + '%' : '—'}</td>
          <td>${w.bmr_kcal ?? '—'}</td>
        </tr>
      `;
    }).join('');

    const lastKg = Number(last.weight_kg);
    const totalKgDiff = lastKg - firstKg;
    const totalFatPctDiff = (last.body_fat_pct && first.body_fat_pct) ? (Number(last.body_fat_pct) - Number(first.body_fat_pct)) : null;
    const lastFatKg = last.body_fat_pct ? lastKg * (Number(last.body_fat_pct) / 100) : null;
    const totalFatKgDiff = (lastFatKg !== null && firstFatKg !== null) ? (lastFatKg - firstFatKg) : null;
    const totalMuscDiff = (last.muscle_mass_kg && first.muscle_mass_kg) ? (Number(last.muscle_mass_kg) - Number(first.muscle_mass_kg)) : null;
    const totalViscDiff = (last.visceral_fat && first.visceral_fat) ? (Number(last.visceral_fat) - Number(first.visceral_fat)) : null;
    const totalWaterDiff = (last.water_pct && first.water_pct) ? (Number(last.water_pct) - Number(first.water_pct)) : null;
    const totalBmrDiff = (last.bmr_kcal && first.bmr_kcal) ? (Number(last.bmr_kcal) - Number(first.bmr_kcal)) : null;

    const fmtSigned = (v, dec = 2, suffix = '') => v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dec)}${suffix}`;

    const totalRow = weights.length >= 2 ? `
      <tr class="row-total">
        <td colspan="2"><strong>Balance</strong></td>
        <td class="status-ok"><strong>${fmtSigned(totalKgDiff, 2)}</strong></td>
        <td>—</td>
        <td class="status-ok"><strong>${fmtSigned((totalKgDiff / firstKg) * 100, 1, '%')}</strong></td>
        <td class="status-ok"><strong>${fmtSigned(totalFatPctDiff, 1, '%')}</strong></td>
        <td class="status-ok"><strong>${fmtSigned(totalFatKgDiff, 2)}</strong></td>
        <td><strong>${fmtSigned(totalMuscDiff, 2)}</strong></td>
        <td class="status-ok"><strong>${totalViscDiff === null ? '—' : (totalViscDiff > 0 ? '+' : '') + totalViscDiff}</strong></td>
        <td class="status-info"><strong>${fmtSigned(totalWaterDiff, 1, '%')}</strong></td>
        <td><strong>${totalBmrDiff === null ? '—' : (totalBmrDiff > 0 ? '+' : '') + totalBmrDiff}</strong></td>
      </tr>
    ` : '';

    tbody.innerHTML = rowsHtml + totalRow;
  }

  const ctx = document.getElementById('weight-chart').getContext('2d');
  const labels = weights.map(w => new Date(w.measured_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }));
  const pesoData = weights.map(w => w.weight_kg);
  const muscData = weights.map(w => w.muscle_mass_kg);

  if (weightChartInstance) weightChartInstance.destroy();
  weightChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Peso (kg)',
          data: pesoData,
          borderColor: '#38bdf8',
          backgroundColor: '#38bdf8',
          tension: 0.25,
          borderWidth: 3
        },
        {
          label: 'Músculo (kg)',
          data: muscData,
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          tension: 0.25,
          spanGaps: true,
          borderWidth: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
      },
      plugins: {
        legend: { labels: { color: '#f8fafc', boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}

async function loadHistory() {
  updateDsStatusUI();
  const client = getClient();
  const [summaryRes, logsRes, weightsRes] = await Promise.all([
    client.from('v_cycle_summary').select('*'),
    client.from('check_ins').select('*').order('recorded_at', { ascending: false }).limit(50),
    client.from('weigh_ins').select('*').order('measured_at', { ascending: true })
  ]);

  const summary = summaryRes.data || [];
  const logs = logsRes.data || [];
  const weights = weightsRes.data || [];

  renderExpectedVsActual(summary);
  renderCycleChart(summary);
  renderInsights(summary, logs, weights);
  renderWeights(weights);

  const tbody = document.getElementById('cycle-summary-body');
  if (summary.length === 0) {
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

  const container = document.getElementById('recent-logs');
  if (logs.length === 0) {
    container.innerHTML = '<p class="hint">Sin registros todavía.</p>';
  } else {
    container.innerHTML = logs.slice(0, 20).map(item => {
      const dateStr = new Date(item.recorded_at).toLocaleString('es-MX', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const tagsHtml = (item.tags || []).map(t => `<span class="tag-mini">#${escapeHtml(t)}</span>`).join('');
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
          ${item.note ? `<div class="hint" style="margin-top:4px;">"${escapeHtml(item.note)}"</div>` : ''}
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

document.getElementById('copy-gemini-btn').addEventListener('click', async () => {
  const client = getClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [logsRes, weightsRes] = await Promise.all([
    client.from('check_ins').select('*').gte('recorded_at', since).order('recorded_at', { ascending: true }),
    client.from('weigh_ins').select('*').order('measured_at', { ascending: false }).limit(2)
  ]);

  const logs = logsRes.data || [];
  const weights = weightsRes.data || [];
  const doseInfo = latestDose
    ? `${latestDose.dose_mg} mg (Día ${calcCycleDay(latestDose.applied_at)} desde ${new Date(latestDose.applied_at).toLocaleDateString('es-MX')})`
    : 'Sin dosis registrada';

  let text = `Resumen semanal para análisis (Tirzepatida)\n`;
  text += `Dosis actual: ${doseInfo}\n`;

  if (weights.length > 0) {
    const w = weights[0];
    text += `Última báscula (${new Date(w.measured_at).toLocaleDateString('es-MX')}): ${w.weight_kg} kg`;
    if (w.body_fat_pct) text += `, Grasa: ${w.body_fat_pct}%`;
    if (w.muscle_mass_kg) text += `, Músculo: ${w.muscle_mass_kg} kg`;
    if (w.visceral_fat) text += `, Visceral: ${w.visceral_fat}`;
    text += `\n`;
  }

  text += `\nRegistros de los últimos 7 días (${logs.length}):\n`;
  if (logs.length === 0) {
    text += `- Sin registros aún en los últimos 7 días.\n`;
  } else {
    logs.forEach(item => {
      const f = new Date(item.recorded_at).toLocaleString('es-MX', {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      const ctx = CONTEXT_LABELS[item.context] || item.context;
      const tags = (item.tags && item.tags.length) ? ` | Tags: ${item.tags.join(', ')}` : '';
      const nota = item.note ? ` | Nota: "${item.note}"` : '';
      text += `- [${f} · Día ${item.cycle_day ?? '?'} · ${ctx}] Saciedad ${item.satiety}/5, Ruido ${item.food_noise}/5, Estómago ${item.gi_comfort}/5${tags}${nota}\n`;
    });
  }
  text += `\nCon base en estos datos, ¿cómo ves mi evolución de esta semana y qué ajustes me recomiendas?`;

  try {
    await navigator.clipboard.writeText(text);
    showToast('Resumen copiado. Pégalo en Gemini');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Resumen copiado. Pégalo en Gemini');
  }
});

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
