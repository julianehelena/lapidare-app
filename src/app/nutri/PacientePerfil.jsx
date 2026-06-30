import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';
import {
  dataBR, iniciais,
  validarPlano, validarLista, validarSubstituicoes, contarItensLista,
  omitColunasFaltantes,
} from '../../lib/utils.js';
import { TEMPLATE_PADRAO } from '../../lib/checkinDefault.js';
import CheckinForm from '../../components/CheckinForm.jsx';
import Evolucao from './_Evolucao.jsx';
import FollowUp from './_FollowUp.jsx';
import Suplementacao from './_Suplementacao.jsx';
import Habitos from './_Habitos.jsx';
import Anamnese from './_Anamnese.jsx';
import DicaJSON from '../../components/DicaJSON.jsx';

export default function PacientePerfil() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [paciente, setPaciente] = useState(null);
  const [tab, setTab] = useState('plano');
  const [editandoNasc, setEditandoNasc] = useState(false);
  const [novoNasc, setNovoNasc] = useState('');
  const [salvandoNasc, setSalvandoNasc] = useState(false);
  const [salvandoSexo, setSalvandoSexo] = useState(false);

  async function carregar() {
    const { data } = await supabase
      .from('pacientes').select('*').eq('id', id).maybeSingle();
    setPaciente(data);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase
        .from('pacientes').select('*').eq('id', id).maybeSingle();
      if (!active) return;
      setPaciente(data);
    }
    load();
    return () => { active = false; };
  }, [id]);

  async function enviarRedefinicaoSenha() {
    if (!paciente?.email) return;
    const ok = window.confirm(
      `Enviar email de redefinição de senha para ${paciente.email}?\n\n` +
      `A paciente vai receber um link válido por 1 hora pra criar uma nova senha. ` +
      `Você não precisa fazer mais nada.`
    );
    if (!ok) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(paciente.email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      if (error) {
        if (/rate limit/i.test(error.message)) {
          alert('Limite de emails atingido (3/hora no plano grátis do Supabase). Tente de novo daqui a pouco ou configure SMTP próprio em Project Settings → Authentication → SMTP.');
        } else {
          alert('Erro ao enviar: ' + error.message);
        }
        return;
      }
      alert(`✅ Email enviado pra ${paciente.email}!\n\nPede pra paciente verificar a caixa de entrada (e o spam). O link funciona por 1 hora.`);
    } catch (err) {
      alert('Erro inesperado: ' + (err?.message || 'tente de novo'));
    }
  }

  async function salvarNascimento() {
    setSalvandoNasc(true);
    const { error } = await supabase.from('pacientes')
      .update({ nascimento: novoNasc || null }).eq('id', id);
    setSalvandoNasc(false);
    if (error) { alert('Erro: ' + error.message); return; }
    setEditandoNasc(false);
    carregar();
  }

  async function salvarSexo(novoSexo) {
    if (!['feminino', 'masculino'].includes(novoSexo)) return;
    setSalvandoSexo(true);
    const { error } = await supabase.from('pacientes')
      .update({ sexo: novoSexo }).eq('id', id);
    setSalvandoSexo(false);
    if (error) {
      if (/sexo.*schema cache|Could not find.*sexo/i.test(error.message)) {
        alert(
          'Seu Supabase ainda não foi atualizado pra v1.11.0 — a coluna "sexo" não existe.\n\n' +
          'Rode o SQL atualizado:\n' +
          'github.com/danielasoares-rd/lapidare-app/blob/main/supabase/delta-v1.11.0.sql'
        );
      } else {
        alert('Erro ao atualizar sexo: ' + error.message);
      }
      return;
    }
    carregar();
  }

  function calcularIdade(iso) {
    if (!iso) return null;
    const n = new Date(iso + 'T12:00:00');
    const h = new Date();
    let idade = h.getFullYear() - n.getFullYear();
    const m = h.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && h.getDate() < n.getDate())) idade--;
    return idade;
  }

  if (paciente === null) {
    return (
      <div className="card empty-card">
        <div className="empty-sub">Carregando…</div>
      </div>
    );
  }

  if (!paciente) {
    return (
      <>
        <div className="page-title">Paciente não encontrada</div>
        <div className="card empty-card">
          <div className="empty-sub">Talvez tenha sido removida ou o link esteja desatualizado.</div>
          <button className="btn" onClick={() => navigate('/nutri/pacientes')}>Voltar à lista</button>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => navigate('/nutri/pacientes')}
        style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <i className="ti ti-arrow-left" aria-hidden="true"></i> Pacientes
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'var(--amber)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 600, color: 'var(--dark)',
        }}>{iniciais(paciente.nome)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-title" style={{ marginBottom: 2 }}>{paciente.nome}</div>
          <div className="page-sub" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{paciente.email} · {paciente.sexo === 'masculino' ? 'cadastrado' : 'cadastrada'} em {dataBR(paciente.created_at)}</span>
            <button onClick={enviarRedefinicaoSenha}
              title="Envia um email pra paciente com link de redefinição de senha"
              style={{
                background: 'transparent', border: '0.5px solid var(--border)',
                borderRadius: 6, padding: '3px 9px', fontSize: 11,
                color: 'var(--gold-deep)', cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              <i className="ti ti-key" aria-hidden="true" style={{ fontSize: 13 }}></i>
              Enviar redefinição de senha
            </button>
          </div>
          {editandoNasc ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="date" value={novoNasc} onChange={e => setNovoNasc(e.target.value)}
                style={{
                  padding: '4px 8px', fontSize: 12, margin: 0,
                  border: '0.5px solid var(--border)', borderRadius: 6,
                  fontFamily: 'var(--font-sans)',
                }} />
              <button onClick={salvarNascimento} disabled={salvandoNasc}
                style={{
                  background: 'var(--dark)', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                }}>{salvandoNasc ? '…' : 'Salvar'}</button>
              <button onClick={() => setEditandoNasc(false)} style={{
                background: 'none', border: '0.5px solid var(--border)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
              }}>Cancelar</button>
            </div>
          ) : paciente.nascimento ? (
            <button onClick={() => { setNovoNasc(paciente.nascimento); setEditandoNasc(true); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: 'var(--text3)', padding: 0,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--font-sans)',
              }}>
              🎂 {dataBR(paciente.nascimento)}
              {(() => {
                const i = calcularIdade(paciente.nascimento);
                return i !== null ? ` · ${i} anos` : '';
              })()}
              <i className="ti ti-edit" style={{ fontSize: 12, marginLeft: 4, opacity: .6 }} aria-hidden="true"></i>
            </button>
          ) : (
            <button onClick={() => { setNovoNasc(''); setEditandoNasc(true); }}
              style={{
                background: 'none', border: '0.5px dashed var(--border)',
                borderRadius: 6, padding: '3px 10px', fontSize: 11,
                color: 'var(--text3)', cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}>
              + Adicionar data de nascimento
            </button>
          )}

          {/* Sexo — select inline, salva ao mudar */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 10, fontSize: 12, color: 'var(--text3)' }}>
            <span style={{ opacity: 0.6 }}>·</span>
            <span>{paciente.sexo === 'masculino' ? '♂' : '♀'}</span>
            <select
              value={paciente.sexo ?? 'feminino'}
              onChange={e => salvarSexo(e.target.value)}
              disabled={salvandoSexo}
              title="Sexo da paciente — controla concordância de gênero no app"
              style={{
                padding: '2px 6px', fontSize: 12, margin: 0,
                border: '0.5px solid var(--border)', borderRadius: 6,
                background: 'transparent', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', color: 'var(--text3)',
              }}>
              <option value="feminino">Feminino</option>
              <option value="masculino">Masculino</option>
            </select>
          </span>
        </div>
      </div>

      <div className="g3">
        <div className="stat">
          <div className="stat-lbl">Objetivo</div>
          <div className="stat-val" style={{ fontSize: 18 }}>{paciente.objetivo ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Tipo de plano</div>
          <div className="stat-val" style={{ fontSize: 18 }}>{paciente.tipo_plano ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Modalidade</div>
          <div className="stat-val" style={{ fontSize: 18 }}>{paciente.modalidade ?? '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 2, background: 'var(--bg2)',
        borderRadius: 10, padding: 3, marginBottom: 16,
        overflowX: 'auto', scrollbarWidth: 'thin',
      }}>
        {[
          { id: 'evolucao',    label: 'Evolução',     icon: 'chart-line' },
          { id: 'anamnese',    label: 'Atendimento',  icon: 'clipboard-text' },
          { id: 'followup',    label: 'Follow-up',    icon: 'notebook' },
          { id: 'plano',          label: 'Plano',          icon: 'salad' },
          { id: 'substituicoes', label: 'Substituições',  icon: 'switch-horizontal' },
          { id: 'compras',     label: 'Compras',      icon: 'shopping-cart' },
          { id: 'suplementacao', label: 'Suplementação', icon: 'pill' },
          { id: 'habitos',       label: 'Hábitos',       icon: 'checklist' },
          { id: 'prescricoes', label: 'Prescrições',  icon: 'file-text' },
          { id: 'ebooks',      label: 'E-books',      icon: 'book-2' },
          { id: 'avaliacao',   label: 'Avaliação',    icon: 'ruler-measure' },
          { id: 'checkin',     label: 'Check-in',     icon: 'clipboard-check' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: '0 0 auto',
              padding: '7px 12px', fontSize: 13, fontWeight: 500,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              color: tab === t.id ? 'var(--dark)' : 'var(--text3)',
              background: tab === t.id ? 'var(--white)' : 'transparent',
              boxShadow: tab === t.id ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,.05))' : 'none',
              fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            <i className={`ti ti-${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true"></i>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'evolucao' && <Evolucao pacienteId={paciente.id} paciente={paciente} nutriId={user.id} />}
      {tab === 'anamnese' && <Anamnese pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
      {tab === 'followup' && <FollowUp pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
      {tab === 'suplementacao' && <Suplementacao pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
      {tab === 'habitos' && <Habitos pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
      {tab === 'plano' && <PublicarPlano pacienteId={paciente.id} nutriId={user.id} />}
      {tab === 'substituicoes' && <PublicarSubstituicoes pacienteId={paciente.id} nutriId={user.id} />}
      {tab === 'compras' && <PublicarLista pacienteId={paciente.id} nutriId={user.id} />}
      {tab === 'prescricoes' && <EnviarPrescricao pacienteId={paciente.id} nutriId={user.id} />}
      {tab === 'ebooks' && <EbooksDaPaciente pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
      {tab === 'avaliacao' && <RegistrarAvaliacao pacienteId={paciente.id} nutriId={user.id} />}
      {tab === 'checkin' && <CheckinPersonalizado pacienteId={paciente.id} nutriId={user.id} pacienteNome={paciente.nome} />}
    </>
  );
}

/* ============================================================
   CHECK-IN — envio rápido + histórico desta paciente
   (gerenciamento de templates fica em /nutri/checkins)
   ============================================================ */
function CheckinPersonalizado({ pacienteId, nutriId, pacienteNome }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [envios, setEnvios] = useState([]);
  const [templateSel, setTemplateSel] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState(null);

  async function carregar() {
    const [tplRes, envRes] = await Promise.all([
      supabase.from('checkin_templates').select('*')
        .eq('nutri_id', nutriId)
        .or(`paciente_id.is.null,paciente_id.eq.${pacienteId}`)
        .order('created_at'),
      supabase.from('checkin_envios')
        .select('id, enviado_em, respondido_em, lembrete_enviado_em, perguntas, respostas')
        .eq('paciente_id', pacienteId)
        .order('enviado_em', { ascending: false })
        .limit(10),
    ]);
    setTemplates(tplRes.data ?? []);
    setEnvios(envRes.data ?? []);
    // pré-seleciona: personalizado dessa paciente > is_padrao > primeiro
    const sel = (tplRes.data ?? []).find(t => t.paciente_id === pacienteId)
             ?? (tplRes.data ?? []).find(t => t.is_padrao)
             ?? (tplRes.data ?? [])[0];
    setTemplateSel(sel?.id ?? '');
  }
  useEffect(() => { carregar(); }, [pacienteId, nutriId]);

  async function enviar() {
    setAviso(null);
    const tpl = templates.find(t => t.id === templateSel);
    if (!tpl) return setAviso({ tipo: 'erro', msg: 'Selecione um template.' });
    setBusy(true);
    const { error } = await supabase.from('checkin_envios').insert({
      nutri_id: nutriId,
      paciente_id: pacienteId,
      perguntas: tpl.perguntas,
    });
    setBusy(false);
    if (error) return setAviso({ tipo: 'erro', msg: error.message });
    setAviso({ tipo: 'ok', msg: `Check-in "${tpl.nome}" enviado para ${pacienteNome.split(' ')[0]}.` });
    carregar();
  }

  async function reenviarLembrete(envio) {
    const { error } = await supabase
      .from('checkin_envios')
      .update({ lembrete_enviado_em: new Date().toISOString() })
      .eq('id', envio.id);
    if (error) return setAviso({ tipo: 'erro', msg: error.message });
    setAviso({ tipo: 'ok', msg: 'Lembrete enviado.' });
    carregar();
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Enviar check-in rápido</div>
            <div className="card-sub">
              Templates ficam em <strong>Check-ins → Templates</strong>. Aqui você só escolhe e envia para {pacienteNome.split(' ')[0]}.
            </div>
          </div>
          <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => navigate('/nutri/checkins')}>
            <i className="ti ti-settings" aria-hidden="true"></i> Gerenciar
          </button>
        </div>
        <div className="card-body">
          {templates.length === 0 ? (
            <div style={{ fontSize: 14, color: 'var(--text3)' }}>
              Nenhum template disponível. Crie em <strong>Check-ins → Templates</strong>.
            </div>
          ) : (
            <>
              <label className="field-label">Template</label>
              <select value={templateSel} onChange={e => setTemplateSel(e.target.value)}>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nome} ({t.perguntas?.length ?? 0} perguntas)
                    {t.is_padrao ? ' · padrão' : ''}
                    {t.paciente_id === pacienteId ? ' · personalizado' : ''}
                  </option>
                ))}
              </select>

              {aviso && (
                <div style={{
                  marginTop: 10,
                  background: aviso.tipo === 'ok' ? 'var(--green-bg)' : 'var(--red-bg)',
                  color: aviso.tipo === 'ok' ? 'var(--green)' : 'var(--red)',
                  padding: '8px 12px', borderRadius: 6, fontSize: 13,
                }}>{aviso.msg}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={enviar} disabled={busy}>
                  <i className="ti ti-send" aria-hidden="true"></i> {busy ? '...' : 'Enviar agora'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="section-label">Últimos check-ins ({envios.length})</div>
      {envios.length === 0 ? (
        <div className="card empty-card">
          <div className="empty-sub">Nada enviado para esta paciente ainda.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {envios.map((e, i) => {
            const respondeu = !!e.respondido_em;
            const lembrado = !!e.lembrete_enviado_em;
            return (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                borderBottom: i === envios.length - 1 ? 'none' : '0.5px solid #f5f0e8',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: respondeu ? 'var(--green-bg)' : (lembrado ? 'var(--orange-bg)' : 'var(--red-bg)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <i className={`ti ti-${respondeu ? 'check' : (lembrado ? 'bell' : 'clock')}`} style={{
                    fontSize: 18,
                    color: respondeu ? 'var(--green)' : (lembrado ? 'var(--orange)' : 'var(--red)'),
                  }} aria-hidden="true"></i>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {respondeu ? `Respondeu em ${dataBR(e.respondido_em)}` : (lembrado ? 'Lembrete enviado' : 'Aguardando resposta')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    Enviado em {dataBR(e.enviado_em)} · {e.perguntas?.length ?? 0} perguntas
                  </div>
                </div>
                {!respondeu && !lembrado && (
                  <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--orange)', borderColor: 'var(--orange)' }}
                    onClick={() => reenviarLembrete(e)}>
                    <i className="ti ti-bell" aria-hidden="true"></i> Lembrete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================================================
   AVALIAÇÃO ANTROPOMÉTRICA
   ============================================================ */
function RegistrarAvaliacao({ pacienteId, nutriId }) {
  const [historico, setHistorico] = useState([]);
  const [form, setForm] = useState(novaAvaliacao());
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  function novaAvaliacao() {
    return {
      data: new Date().toISOString().slice(0, 10),
      kg: '', altura_cm: '', cintura_cm: '', quadril_cm: '',
      braco_cm: '', coxa_cm: '', pgc: '', mm_kg: '', obs: '',
    };
  }

  async function carregar() {
    const { data } = await supabase
      .from('peso_registros')
      .select('id, data, kg, altura_cm, cintura_cm, quadril_cm, braco_cm, coxa_cm, pgc, mm_kg, obs, pdf_url')
      .eq('paciente_id', pacienteId)
      .order('data', { ascending: false });
    setHistorico(data ?? []);
  }
  useEffect(() => { carregar(); }, [pacienteId]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  function num(v) {
    if (v === '' || v == null) return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  async function salvar() {
    setFeedback(null);
    if (!form.data || !form.kg) {
      return setFeedback({ tipo: 'erro', msg: 'Data e peso são obrigatórios.' });
    }
    setBusy(true);
    let pdfUrl = null;
    try {
      pdfUrl = await uploadDocumento(pdfFile, { nutriId, pacienteId, tipo: 'avaliacao' });
    } catch (e) {
      setBusy(false);
      return setFeedback({ tipo: 'erro', msg: e.message });
    }
    const payload = {
      paciente_id: pacienteId,
      nutri_id: nutriId,
      data: form.data,
      kg: num(form.kg),
      altura_cm: num(form.altura_cm),
      cintura_cm: num(form.cintura_cm),
      quadril_cm: num(form.quadril_cm),
      braco_cm: num(form.braco_cm),
      coxa_cm: num(form.coxa_cm),
      pgc: num(form.pgc),
      mm_kg: num(form.mm_kg),
      obs: form.obs.trim() || null,
      pdf_url: pdfUrl,
    };
    const { error, omitidos } = await omitColunasFaltantes(
      payload, ['pdf_url'],
      (p) => supabase.from('peso_registros').insert(p),
    );
    setBusy(false);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    const msgOmitido = omitidos.length
      ? ` (PDF não salvo — rode o SQL atualizado: github.com/danielasoares-rd/lapidare-app/blob/main/supabase/delta-v1.12.0.sql)`
      : (pdfUrl ? ' PDF anexado.' : '');
    setFeedback({ tipo: omitidos.length ? 'erro' : 'ok', msg: `Avaliação registrada.${msgOmitido}` });
    setForm(novaAvaliacao());
    setPdfFile(null);
    carregar();
  }

  async function remover(id) {
    if (!window.confirm('Remover esta avaliação?')) return;
    await supabase.from('peso_registros').delete().eq('id', id);
    carregar();
  }

  // IMC calculado em tempo real
  const imcPreview = (() => {
    const k = num(form.kg);
    const a = num(form.altura_cm);
    if (!k || !a) return null;
    return (k / Math.pow(a / 100, 2)).toFixed(1);
  })();

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Nova avaliação antropométrica</div>
            <div className="card-sub">Registre peso e medidas — a paciente verá o gráfico de evolução</div>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Data</label>
              <input type="date" value={form.data} onChange={set('data')} />
            </div>
            <div>
              <label className="field-label">Peso (kg) *</label>
              <input inputMode="decimal" placeholder="ex: 76,5" value={form.kg} onChange={set('kg')} />
            </div>
            <div>
              <label className="field-label">Altura (cm)</label>
              <input inputMode="decimal" placeholder="ex: 162" value={form.altura_cm} onChange={set('altura_cm')} />
            </div>
          </div>

          {imcPreview && (
            <div style={{
              marginTop: 8, fontSize: 13, color: 'var(--text2)',
              background: 'var(--bg2)', padding: '6px 10px', borderRadius: 6, display: 'inline-block',
            }}>
              IMC calculado: <strong>{imcPreview}</strong> kg/m²
            </div>
          )}

          <div className="section-label" style={{ marginTop: 14, marginBottom: 6 }}>Circunferências (cm)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Cintura</label>
              <input inputMode="decimal" value={form.cintura_cm} onChange={set('cintura_cm')} />
            </div>
            <div>
              <label className="field-label">Quadril</label>
              <input inputMode="decimal" value={form.quadril_cm} onChange={set('quadril_cm')} />
            </div>
            <div>
              <label className="field-label">Braço</label>
              <input inputMode="decimal" value={form.braco_cm} onChange={set('braco_cm')} />
            </div>
            <div>
              <label className="field-label">Coxa</label>
              <input inputMode="decimal" value={form.coxa_cm} onChange={set('coxa_cm')} />
            </div>
          </div>

          <div className="section-label" style={{ marginTop: 14, marginBottom: 6 }}>Composição corporal</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">% gordura corporal</label>
              <input inputMode="decimal" placeholder="ex: 28,5" value={form.pgc} onChange={set('pgc')} />
            </div>
            <div>
              <label className="field-label">Massa magra (kg)</label>
              <input inputMode="decimal" placeholder="ex: 48,2" value={form.mm_kg} onChange={set('mm_kg')} />
            </div>
          </div>

          <label className="field-label" style={{ marginTop: 14 }}>Observação (opcional)</label>
          <textarea rows="2" value={form.obs} onChange={set('obs')}
            placeholder="Ex: avaliação após 30 dias de plano, paciente relata melhora de energia." />

          <UploadPdfField
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
            pdfUrlAtual={historico[0]?.pdf_url}
            tipo="avaliacao"
          />

          {feedback && <FeedbackInline f={feedback} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={salvar} disabled={busy || !form.kg}>
              <i className="ti ti-check" aria-hidden="true"></i> {busy ? 'Salvando...' : 'Registrar avaliação'}
            </button>
          </div>
        </div>
      </div>

      <div className="section-label">Histórico ({historico.length})</div>
      {historico.length === 0 ? (
        <div className="card empty-card">
          <div className="empty-sub">Nenhuma avaliação registrada ainda.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Peso</th>
                <th>Cintura</th>
                <th>Quadril</th>
                <th>% gordura</th>
                <th>M. magra</th>
                <th>PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historico.map(a => (
                <tr key={a.id}>
                  <td>{dataBR(a.data)}</td>
                  <td><strong>{a.kg ? `${a.kg} kg` : '—'}</strong></td>
                  <td>{a.cintura_cm ? `${a.cintura_cm} cm` : '—'}</td>
                  <td>{a.quadril_cm ? `${a.quadril_cm} cm` : '—'}</td>
                  <td>{a.pgc ? `${a.pgc}%` : '—'}</td>
                  <td>{a.mm_kg ? `${a.mm_kg} kg` : '—'}</td>
                  <td>
                    {a.pdf_url ? (
                      <a href={a.pdf_url} target="_blank" rel="noopener noreferrer"
                         title="Abrir PDF"
                         style={{ color: 'var(--gold-deep)', display: 'inline-flex', alignItems: 'center' }}>
                        <i className="ti ti-file-download" style={{ fontSize: 16 }} aria-hidden="true"></i>
                      </a>
                    ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => remover(a.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}
                      title="Remover">
                      <i className="ti ti-trash" style={{ fontSize: 15 }} aria-hidden="true"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ============================================================
   PUBLICAR PLANO
   ============================================================ */
function PublicarPlano({ pacienteId, nutriId }) {
  const [historico, setHistorico] = useState([]);
  const [json, setJson] = useState('');
  const [validade, setValidade] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [verJson, setVerJson] = useState(null);

  async function carregar() {
    const { data } = await supabase
      .from('planos')
      .select('id, dados, validade, pdf_url, publicado_em')
      .eq('paciente_id', pacienteId)
      .order('publicado_em', { ascending: false })
      .limit(5);
    setHistorico(data ?? []);
  }
  useEffect(() => { carregar(); }, [pacienteId]);

  async function publicar() {
    setFeedback(null);
    // Permite publicar com JSON OU só PDF (pelo menos um dos dois).
    // Se a nutri quer mandar só o PDF (vindo do Shaped/avaliação externa)
    // sem montar o JSON estruturado, salva com dados vazios.
    const temJson = json.trim().length > 0;
    if (!temJson && !pdfFile) {
      return setFeedback({ tipo: 'erro', msg: 'Cole o JSON do plano OU anexe um PDF (pelo menos um dos dois).' });
    }

    let dados = { somente_pdf: true };
    if (temJson) {
      try { dados = JSON.parse(json); }
      catch (e) { return setFeedback({ tipo: 'erro', msg: 'JSON inválido: ' + e.message }); }
      const v = validarPlano(dados);
      if (!v.ok) return setFeedback({ tipo: 'erro', msg: v.erro });
    }

    setBusy(true);
    let pdfUrl = null;
    try {
      pdfUrl = await uploadDocumento(pdfFile, { nutriId, pacienteId, tipo: 'plano' });
    } catch (e) {
      setBusy(false);
      return setFeedback({ tipo: 'erro', msg: e.message });
    }

    const planoPayload = {
      paciente_id: pacienteId,
      nutri_id: nutriId,
      dados,
      validade: validade || dados.validade || null,
      pdf_url: pdfUrl,
    };
    const { error, omitidos } = await omitColunasFaltantes(
      planoPayload, ['pdf_url'],
      (p) => supabase.from('planos').insert(p),
    );
    setBusy(false);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    const aviso = omitidos.length
      ? ` ATENÇÃO: PDF não foi salvo. Rode o SQL: github.com/danielasoares-rd/lapidare-app/blob/main/supabase/delta-v1.10.0.sql`
      : (pdfUrl ? ' PDF anexado.' : '');
    setFeedback({ tipo: omitidos.length ? 'erro' : 'ok', msg: `Plano publicado!${aviso} A paciente verá agora.` });
    setJson('');
    setValidade('');
    setPdfFile(null);
    carregar();
  }

  async function excluirPlano(p) {
    const data = dataBR(p.publicado_em);
    if (!window.confirm(`Excluir plano publicado em ${data}?\n\nA paciente não verá mais este plano. Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from('planos').delete().eq('id', p.id);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    setFeedback({ tipo: 'ok', msg: 'Plano excluído.' });
    carregar();
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Publicar novo plano alimentar</div>
            <div className="card-sub">Cole o JSON da Skill 6 OU anexe um PDF — pelo menos um dos dois</div>
          </div>
        </div>
        <div className="card-body">
          <label className="field-label">JSON do plano (opcional se anexar PDF)</label>
          <textarea
            value={json}
            onChange={e => setJson(e.target.value)}
            rows={10}
            placeholder='{"macros": {"kcal": 1500, ...}, "refeicoes": [...]}'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
          />

          <DicaJSON
            exemploPrompt='gera um JSON de plano alimentar pra paciente com objetivo de emagrecimento, 1500 kcal, 4 refeições (café, almoço, lanche, jantar). Estrutura: { "macros": { "kcal": 1500, "proteinas_g": 90, "carbo_g": 150, "gorduras_g": 50, "agua_l": 2.5 }, "refeicoes": [{ "nome": "Café da manhã", "horario": "07:30", "alimentos": [{ "nome": "...", "quantidade": "...", "subs": [{ "nome": "..." }] }] }] }' />

          <UploadPdfField
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
            pdfUrlAtual={historico[0]?.pdf_url}
            tipo="plano"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginTop: 10 }}>
            <div>
              <label className="field-label">Validade (opcional)</label>
              <input type="date" value={validade} onChange={e => setValidade(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn" onClick={publicar} disabled={busy || (!json.trim() && !pdfFile)}>
                <i className="ti ti-send" aria-hidden="true"></i> {busy ? 'Publicando...' : 'Publicar plano'}
              </button>
            </div>
          </div>

          {feedback && <FeedbackInline f={feedback} />}
        </div>
      </div>

      <HistoricoLista
        titulo="Planos publicados"
        items={historico}
        onDelete={excluirPlano}
        renderItem={(p) => (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {p.dados?.macros?.kcal ? `${p.dados.macros.kcal} kcal · ` : ''}
                {p.dados?.refeicoes?.length ?? 0} refeições
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                Publicado em {dataBR(p.publicado_em)}
                {p.validade && ` · válido até ${dataBR(p.validade)}`}
              </div>
            </div>
            <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setVerJson(p)}>
              <i className="ti ti-code" aria-hidden="true"></i> JSON
            </button>
          </>
        )}
      />

      {verJson && (
        <VerJsonModal item={verJson} dados={verJson.dados} onClose={() => setVerJson(null)} />
      )}
    </>
  );
}

/* ============================================================
   PUBLICAR SUBSTITUIÇÕES
   Tabela separada do plano alimentar — a nutri pode atualizar as
   substituições sem mexer no plano publicado. A paciente vê as
   substituições ao tocar num alimento do plano (lookup pelo nome).
   ============================================================ */
function PublicarSubstituicoes({ pacienteId, nutriId }) {
  const [historico, setHistorico] = useState([]);
  const [json, setJson] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [verJson, setVerJson] = useState(null);

  async function carregar() {
    const { data } = await supabase
      .from('substituicoes')
      .select('id, dados, pdf_url, publicado_em')
      .eq('paciente_id', pacienteId)
      .order('publicado_em', { ascending: false })
      .limit(5);
    setHistorico(data ?? []);
  }
  useEffect(() => { carregar(); }, [pacienteId]);

  async function publicar() {
    setFeedback(null);
    const temJson = json.trim().length > 0;
    if (!temJson && !pdfFile) {
      return setFeedback({ tipo: 'erro', msg: 'Cole o JSON OU anexe um PDF (pelo menos um dos dois).' });
    }

    let dados = [];
    if (temJson) {
      try { dados = JSON.parse(json); }
      catch (e) { return setFeedback({ tipo: 'erro', msg: 'JSON inválido: ' + e.message }); }
      const v = validarSubstituicoes(dados);
      if (!v.ok) return setFeedback({ tipo: 'erro', msg: v.erro });
    }

    setBusy(true);
    let pdfUrl = null;
    try {
      pdfUrl = await uploadDocumento(pdfFile, { nutriId, pacienteId, tipo: 'substituicoes' });
    } catch (e) {
      setBusy(false);
      return setFeedback({ tipo: 'erro', msg: e.message });
    }

    const subsPayload = {
      paciente_id: pacienteId,
      nutri_id: nutriId,
      dados,
      pdf_url: pdfUrl,
    };
    const { error, omitidos } = await omitColunasFaltantes(
      subsPayload, ['pdf_url'],
      (p) => supabase.from('substituicoes').insert(p),
    );
    setBusy(false);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    const aviso = omitidos.length
      ? ` ATENÇÃO: PDF não foi salvo. Rode o SQL: github.com/danielasoares-rd/lapidare-app/blob/main/supabase/delta-v1.10.0.sql`
      : (pdfUrl ? ' PDF anexado.' : '');
    const detalhe = Array.isArray(dados) && dados.length > 0
      ? ` ${dados.length} alimentos com opções de troca.`
      : '';
    setFeedback({ tipo: omitidos.length ? 'erro' : 'ok', msg: `Substituições publicadas!${aviso}${detalhe}` });
    setJson('');
    setPdfFile(null);
    carregar();
  }

  async function excluirSubstituicao(s) {
    const data = dataBR(s.publicado_em);
    if (!window.confirm(`Excluir substituições publicadas em ${data}?\n\nA paciente não verá mais as substituições.`)) return;
    const { error } = await supabase.from('substituicoes').delete().eq('id', s.id);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    setFeedback({ tipo: 'ok', msg: 'Substituições excluídas.' });
    carregar();
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Publicar lista de substituições</div>
            <div className="card-sub">
              Cole o JSON OU anexe um PDF — pelo menos um dos dois. Com JSON,
              a paciente vê substituições ao tocar nos alimentos do plano.
            </div>
          </div>
        </div>
        <div className="card-body">
          <label className="field-label">JSON das substituições</label>
          <textarea
            value={json}
            onChange={e => setJson(e.target.value)}
            rows={12}
            placeholder='[{"alimento": "Arroz integral", "medida": "4 col sopa", "substituicoes": ["Quinoa cozida · 4 col sopa", "Batata doce · 1 un média"]}]'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
          />

          <DicaJSON
            exemploPrompt='Gere um JSON com substituições para cada alimento deste plano alimentar [cole o plano da paciente aqui]. Formato exato: array de objetos, cada um com 3 campos — "alimento" (nome igual ao do plano), "medida" (a quantidade do plano) e "substituicoes" (array de strings com 3 a 5 opções equivalentes nutricionalmente, cada uma já incluindo a quantidade). Exemplo: [{"alimento": "Arroz integral", "medida": "4 col sopa", "substituicoes": ["Quinoa cozida · 4 col sopa", "Batata doce · 1 un média"]}]. IMPORTANTE: cada item em "substituicoes" precisa ser uma string simples, NÃO um objeto.' />

          <UploadPdfField
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
            pdfUrlAtual={historico[0]?.pdf_url}
            tipo="substituicoes"
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={publicar} disabled={busy || (!json.trim() && !pdfFile)}>
              <i className="ti ti-send" aria-hidden="true"></i> {busy ? 'Publicando...' : 'Publicar substituições'}
            </button>
          </div>

          {feedback && <FeedbackInline f={feedback} />}
        </div>
      </div>

      <HistoricoLista
        titulo="Substituições publicadas"
        items={historico}
        onDelete={excluirSubstituicao}
        renderItem={(s) => (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {Array.isArray(s.dados) ? `${s.dados.length} alimentos` : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                Publicado em {dataBR(s.publicado_em)}
              </div>
            </div>
            <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setVerJson(s)}>
              <i className="ti ti-code" aria-hidden="true"></i> JSON
            </button>
          </>
        )}
      />

      {verJson && (
        <VerJsonModal item={verJson} dados={verJson.dados} onClose={() => setVerJson(null)} />
      )}
    </>
  );
}

/* ============================================================
   PUBLICAR LISTA DE COMPRAS
   ============================================================ */
function PublicarLista({ pacienteId, nutriId }) {
  const [historico, setHistorico] = useState([]);
  const [json, setJson] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [verJson, setVerJson] = useState(null);

  async function carregar() {
    const { data } = await supabase
      .from('listas_compras')
      .select('id, dados, pdf_url, publicado_em')
      .eq('paciente_id', pacienteId)
      .order('publicado_em', { ascending: false })
      .limit(5);
    setHistorico(data ?? []);
  }
  useEffect(() => { carregar(); }, [pacienteId]);

  async function publicar() {
    setFeedback(null);
    const temJson = json.trim().length > 0;
    if (!temJson && !pdfFile) {
      return setFeedback({ tipo: 'erro', msg: 'Cole o JSON OU anexe um PDF (pelo menos um dos dois).' });
    }

    let dados = { somente_pdf: true };
    if (temJson) {
      try { dados = JSON.parse(json); }
      catch (e) { return setFeedback({ tipo: 'erro', msg: 'JSON inválido: ' + e.message }); }
      const v = validarLista(dados);
      if (!v.ok) return setFeedback({ tipo: 'erro', msg: v.erro });
    }

    setBusy(true);
    let pdfUrl = null;
    try {
      pdfUrl = await uploadDocumento(pdfFile, { nutriId, pacienteId, tipo: 'compras' });
    } catch (e) {
      setBusy(false);
      return setFeedback({ tipo: 'erro', msg: e.message });
    }

    const listaPayload = {
      paciente_id: pacienteId,
      nutri_id: nutriId,
      dados,
      pdf_url: pdfUrl,
    };
    const { error, omitidos } = await omitColunasFaltantes(
      listaPayload, ['pdf_url'],
      (p) => supabase.from('listas_compras').insert(p),
    );
    setBusy(false);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    const aviso = omitidos.length
      ? ` ATENÇÃO: PDF não foi salvo. Rode o SQL: github.com/danielasoares-rd/lapidare-app/blob/main/supabase/delta-v1.10.0.sql`
      : (pdfUrl ? ' PDF anexado.' : '');
    setFeedback({ tipo: omitidos.length ? 'erro' : 'ok', msg: `Lista publicada!${aviso} A paciente verá agora.` });
    setJson('');
    setPdfFile(null);
    carregar();
  }

  async function excluirLista(l) {
    const data = dataBR(l.publicado_em);
    if (!window.confirm(`Excluir lista de compras publicada em ${data}?\n\nA paciente não verá mais esta lista.`)) return;
    const { error } = await supabase.from('listas_compras').delete().eq('id', l.id);
    if (error) return setFeedback({ tipo: 'erro', msg: error.message });
    setFeedback({ tipo: 'ok', msg: 'Lista excluída.' });
    carregar();
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Publicar nova lista de compras</div>
            <div className="card-sub">Cole o JSON da Skill 7 OU anexe um PDF — pelo menos um dos dois</div>
          </div>
        </div>
        <div className="card-body">
          <label className="field-label">JSON da lista</label>
          <textarea
            value={json}
            onChange={e => setJson(e.target.value)}
            rows={10}
            placeholder='{"lista": [{"categoria": "Hortifruti", "itens": ["banana", "maçã"]}]}'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
          />

          <DicaJSON
            exemploPrompt='gera um JSON de lista de compras pra paciente, agrupando os itens por categoria (Hortifruti, Proteínas, Grãos e cereais, Laticínios, Mercearia, Outros). Inclui só os nomes dos itens (sem quantidade). Estrutura: { "lista": [{ "categoria": "Hortifruti", "emoji": "🥦", "itens": ["banana", "maçã", "alface", "tomate"] }, ...] }' />

          <UploadPdfField
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
            pdfUrlAtual={historico[0]?.pdf_url}
            tipo="compras"
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={publicar} disabled={busy || (!json.trim() && !pdfFile)}>
              <i className="ti ti-send" aria-hidden="true"></i> {busy ? 'Publicando...' : 'Publicar lista'}
            </button>
          </div>

          {feedback && <FeedbackInline f={feedback} />}
        </div>
      </div>

      <HistoricoLista
        titulo="Listas publicadas"
        items={historico}
        onDelete={excluirLista}
        renderItem={(l) => (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {contarItensLista(l.dados)} itens em {l.dados?.lista?.length ?? 0} categorias
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                Publicada em {dataBR(l.publicado_em)}
              </div>
            </div>
            <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setVerJson(l)}>
              <i className="ti ti-code" aria-hidden="true"></i> JSON
            </button>
          </>
        )}
      />

      {verJson && (
        <VerJsonModal item={verJson} dados={verJson.dados} onClose={() => setVerJson(null)} />
      )}
    </>
  );
}

/* ============================================================
   ENVIAR PRESCRIÇÃO (upload PDF)
   ============================================================ */
function EnviarPrescricao({ pacienteId, nutriId }) {
  const [historico, setHistorico] = useState([]);
  const [tipo, setTipo] = useState('exame');
  const [titulo, setTitulo] = useState('');
  const [nota, setNota] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function carregar() {
    const { data } = await supabase
      .from('prescricoes')
      .select('id, tipo, titulo, storage_path, nota, created_at')
      .eq('paciente_id', pacienteId)
      .order('created_at', { ascending: false });
    setHistorico(data ?? []);
  }
  useEffect(() => { carregar(); }, [pacienteId]);

  async function enviar() {
    setFeedback(null);
    if (!arquivo) return setFeedback({ tipo: 'erro', msg: 'Selecione um arquivo PDF.' });
    if (!titulo.trim()) return setFeedback({ tipo: 'erro', msg: 'Informe um título.' });

    setBusy(true);
    const ext = arquivo.name.split('.').pop() || 'pdf';
    const path = `${pacienteId}/${Date.now()}-${titulo.trim().replace(/[^a-z0-9]/gi, '_')}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('prescricoes')
      .upload(path, arquivo, { contentType: arquivo.type });
    if (uploadErr) {
      setBusy(false);
      return setFeedback({ tipo: 'erro', msg: 'Upload falhou: ' + uploadErr.message });
    }

    const { error: insertErr } = await supabase.from('prescricoes').insert({
      paciente_id: pacienteId,
      nutri_id: nutriId,
      tipo, titulo: titulo.trim(),
      storage_path: path,
      nota: nota.trim() || null,
    });
    setBusy(false);
    if (insertErr) {
      // tenta limpar o arquivo subido se o insert falhou
      await supabase.storage.from('prescricoes').remove([path]);
      return setFeedback({ tipo: 'erro', msg: 'Erro ao registrar: ' + insertErr.message });
    }
    setFeedback({ tipo: 'ok', msg: 'Prescrição enviada!' });
    setTitulo(''); setNota(''); setArquivo(null);
    const fileInput = document.getElementById('prescricao-file');
    if (fileInput) fileInput.value = '';
    carregar();
  }

  async function abrirDocumento(path) {
    const { data, error } = await supabase.storage
      .from('prescricoes').createSignedUrl(path, 60);
    if (error) return alert('Não foi possível abrir: ' + error.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function remover(item) {
    if (!window.confirm(`Remover "${item.titulo}"?`)) return;
    await supabase.storage.from('prescricoes').remove([item.storage_path]);
    await supabase.from('prescricoes').delete().eq('id', item.id);
    carregar();
  }

  const TIPO_PILL = {
    exame:   { bg: 'var(--blue-bg)',   color: 'var(--blue)',   label: 'Exame' },
    laudo:   { bg: 'var(--green-bg)',  color: 'var(--green)',  label: 'Laudo' },
    receita: { bg: 'var(--orange-bg)', color: 'var(--orange)', label: 'Receita' },
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Enviar prescrição</div>
            <div className="card-sub">PDF de exame, laudo ou receita — a paciente verá em "Prescrições"</div>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="exame">Exame (pedido)</option>
                <option value="laudo">Laudo</option>
                <option value="receita">Receita</option>
              </select>
            </div>
            <div>
              <label className="field-label">Título</label>
              <input value={titulo} onChange={e => setTitulo(e.target.value)}
                placeholder="Ex: Pedido de exame T4 livre" />
            </div>
          </div>

          <label className="field-label" style={{ marginTop: 10 }}>Arquivo PDF</label>
          <input
            id="prescricao-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={e => setArquivo(e.target.files?.[0] ?? null)}
            style={{ padding: 6 }}
          />

          <label className="field-label" style={{ marginTop: 10 }}>Observação (opcional)</label>
          <textarea rows="2" value={nota} onChange={e => setNota(e.target.value)}
            placeholder="Ex: trazer este pedido na próxima consulta" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={enviar} disabled={busy || !arquivo || !titulo.trim()}>
              <i className="ti ti-upload" aria-hidden="true"></i> {busy ? 'Enviando...' : 'Enviar prescrição'}
            </button>
          </div>

          {feedback && <FeedbackInline f={feedback} />}
        </div>
      </div>

      <div className="section-label">Documentos enviados ({historico.length})</div>
      {historico.length === 0 ? (
        <div className="card empty-card">
          <div className="empty-sub">Nenhuma prescrição enviada ainda.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {historico.map((d, i) => {
            const p = TIPO_PILL[d.tipo] ?? { bg: 'var(--bg2)', color: 'var(--text3)', label: d.tipo };
            return (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                borderBottom: i === historico.length - 1 ? 'none' : '0.5px solid #f5f0e8',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: p.bg, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <i className="ti ti-file-text" style={{ fontSize: 17, color: p.color }} aria-hidden="true"></i>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{d.titulo}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {p.label} · {dataBR(d.created_at)}
                  </div>
                  {d.nota && (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, fontStyle: 'italic' }}>
                      "{d.nota}"
                    </div>
                  )}
                </div>
                <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => abrirDocumento(d.storage_path)}>
                  <i className="ti ti-eye" aria-hidden="true"></i> Ver
                </button>
                <button onClick={() => remover(d)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}
                  title="Remover">
                  <i className="ti ti-trash" style={{ fontSize: 16 }} aria-hidden="true"></i>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================================================
   COMPONENTES AUXILIARES
   ============================================================ */
/**
 * Campo opcional pra subir um PDF junto com Plano/Substituições/Lista.
 * - tipo: 'plano' | 'substituicoes' | 'compras'  (vira pasta no bucket)
 * - pdfUrlAtual: URL salvada no banco (se já existe). Mostra link "Ver atual".
 * - onArquivoSelecionado: callback (file | null) — pai guarda no estado.
 */
function UploadPdfField({ pdfFile, setPdfFile, pdfUrlAtual, tipo }) {
  const rotulo = {
    plano: 'PDF do plano (opcional)',
    substituicoes: 'PDF das substituições (opcional)',
    compras: 'PDF da lista de compras (opcional)',
  }[tipo] ?? 'PDF (opcional)';

  return (
    <div style={{ marginTop: 12 }}>
      <label className="field-label">{rotulo}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 13 }}
        />
        {pdfFile && (
          <button
            type="button"
            onClick={() => setPdfFile(null)}
            className="btn-outline"
            style={{ fontSize: 11, padding: '4px 8px' }}>
            <i className="ti ti-x" aria-hidden="true"></i> Remover seleção
          </button>
        )}
        {!pdfFile && pdfUrlAtual && (
          <a href={pdfUrlAtual} target="_blank" rel="noopener noreferrer"
             className="btn-outline" style={{ fontSize: 11, padding: '4px 8px' }}>
            <i className="ti ti-file-download" aria-hidden="true"></i> Ver PDF atual
          </a>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        A paciente vai ver um botão "Baixar PDF" na tela. Máximo 10 MB.
      </div>
    </div>
  );
}

/**
 * Faz upload de um File pro bucket 'documentos' e retorna a URL pública.
 * Path: {nutriId}/{pacienteId}/{tipo}/{timestamp}-{filename}
 * Volta null se file estiver vazio. Lança erro se upload falhar.
 */
async function uploadDocumento(file, { nutriId, pacienteId, tipo }) {
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('PDF muito grande (máx 10 MB).');
  }
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${nutriId}/${pacienteId}/${tipo}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from('documentos').upload(path, file, {
    contentType: file.type || 'application/pdf',
  });
  if (error) throw new Error('Falha no upload do PDF: ' + error.message);
  const { data } = supabase.storage.from('documentos').getPublicUrl(path);
  return data.publicUrl;
}

function FeedbackInline({ f }) {
  const ok = f.tipo === 'ok';
  return (
    <div style={{
      marginTop: 10,
      background: ok ? 'var(--green-bg)' : 'var(--red-bg)',
      color: ok ? 'var(--green)' : 'var(--red)',
      padding: '8px 12px', borderRadius: 6, fontSize: 13,
    }}>
      <i className={`ti ti-${ok ? 'check' : 'alert-circle'}`} style={{ marginRight: 5 }} aria-hidden="true"></i>
      {f.msg}
    </div>
  );
}

function HistoricoLista({ titulo, items, renderItem, onDelete }) {
  return (
    <>
      <div className="section-label">{titulo} ({items.length})</div>
      {items.length === 0 ? (
        <div className="card empty-card">
          <div className="empty-sub">Nada publicado ainda.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {items.map((it, i) => (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px',
              borderBottom: i === items.length - 1 ? 'none' : '0.5px solid #f5f0e8',
            }}>
              {renderItem(it)}
              {onDelete && (
                <button onClick={() => onDelete(it)}
                  title="Excluir"
                  style={{
                    background: 'none', border: '0.5px solid var(--red)',
                    borderRadius: 6, padding: '4px 8px',
                    color: 'var(--red)', cursor: 'pointer',
                  }}>
                  <i className="ti ti-trash" style={{ fontSize: 15 }} aria-hidden="true"></i>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function VerJsonModal({ item, dados, onClose }) {
  const pretty = JSON.stringify(dados, null, 2);
  async function copiar() {
    try { await navigator.clipboard.writeText(pretty); alert('Copiado!'); }
    catch (e) { alert('Não foi possível copiar.'); }
  }
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(28,23,18,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--white)', borderRadius: 12, padding: 22,
        width: 600, maxWidth: '90vw', maxHeight: '85vh',
        border: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17 }}>JSON publicado</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={copiar}>
              <i className="ti ti-copy" aria-hidden="true"></i> Copiar
            </button>
            <button className="btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
        <pre style={{
          background: 'var(--bg2)', padding: 12, borderRadius: 8,
          fontSize: 12, lineHeight: 1.5, overflow: 'auto', flex: 1,
          fontFamily: 'monospace', color: 'var(--dark)',
        }}>{pretty}</pre>
      </div>
    </div>
  );
}


/* ============================================================
   E-BOOKS DA PACIENTE
   ============================================================ */
const EBOOK_TAGS = [
  { id: 'receitas',      label: 'Receitas'       },
  { id: 'guia',          label: 'Guia'           },
  { id: 'protocolo',     label: 'Protocolo'      },
  { id: 'suplementacao', label: 'Suplementação'  },
  { id: 'outro',         label: 'Outro'          },
];

function EbooksDaPaciente({ pacienteId, nutriId, pacienteNome }) {
  const [todos, setTodos] = useState([]);          // todos os ebooks da nutri
  const [atribuidosIds, setAtribuidosIds] = useState(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busca, setBusca] = useState('');

  async function carregar() {
    const [ebRes, atRes] = await Promise.all([
      supabase.from('ebooks').select('*').eq('nutri_id', nutriId).order('created_at', { ascending: false }),
      supabase.from('ebooks_pacientes').select('ebook_id').eq('paciente_id', pacienteId),
    ]);
    setTodos(ebRes.data ?? []);
    setAtribuidosIds(new Set((atRes.data ?? []).map(a => a.ebook_id)));
  }
  useEffect(() => { carregar(); }, [pacienteId, nutriId]);

  async function toggle(ebookId) {
    if (atribuidosIds.has(ebookId)) {
      await supabase.from('ebooks_pacientes').delete()
        .eq('ebook_id', ebookId).eq('paciente_id', pacienteId);
    } else {
      await supabase.from('ebooks_pacientes').insert({
        ebook_id: ebookId, paciente_id: pacienteId,
      });
    }
    carregar();
  }

  async function abrir(eb) {
    const { data, error } = await supabase.storage
      .from('ebooks').createSignedUrl(eb.storage_path, 120);
    if (error) return alert('Não foi possível abrir: ' + error.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  const atribuidos = todos.filter(e => atribuidosIds.has(e.id));
  const disponiveis = todos.filter(e => !atribuidosIds.has(e.id))
    .filter(e => {
      if (!busca.trim()) return true;
      const q = busca.trim().toLowerCase();
      return (e.titulo ?? '').toLowerCase().includes(q)
        || (e.descricao ?? '').toLowerCase().includes(q);
    });

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">E-books de {pacienteNome.split(' ')[0]}</div>
            <div className="card-sub">Marque os materiais da biblioteca que ela pode acessar, ou suba um novo direto</div>
          </div>
          <button className="btn" onClick={() => setUploadOpen(true)}>
            <i className="ti ti-upload" aria-hidden="true"></i> Subir novo
          </button>
        </div>
        <div className="card-body">
          <div style={{
            fontSize: 10, letterSpacing: 1, color: 'var(--text3)',
            textTransform: 'uppercase', fontWeight: 500, marginBottom: 8,
          }}>
            Materiais atribuídos ({atribuidos.length})
          </div>
          {atribuidos.length === 0 ? (
            <div style={{
              padding: '12px 14px', borderRadius: 8, background: 'var(--bg2)',
              fontSize: 12, color: 'var(--text3)', marginBottom: 14,
            }}>
              Nenhum e-book atribuído ainda. Marque um da biblioteca abaixo ou suba um novo.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {atribuidos.map(eb => (
                <div key={eb.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: 10, borderRadius: 8,
                  background: 'var(--green-bg, var(--bg2))',
                  border: '0.5px solid var(--green, var(--border))',
                }}>
                  <i className="ti ti-check" style={{ fontSize: 16, color: 'var(--green)' }} aria-hidden="true"></i>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{eb.titulo}</div>
                    {eb.descricao && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>{eb.descricao}</div>
                    )}
                  </div>
                  <button onClick={() => abrir(eb)} className="btn-outline" style={{ fontSize: 11, padding: '4px 10px' }}>
                    <i className="ti ti-eye" aria-hidden="true"></i> Abrir
                  </button>
                  <button onClick={() => toggle(eb.id)}
                    style={{
                      background: 'none', border: '0.5px solid var(--red)',
                      borderRadius: 6, padding: '4px 8px',
                      color: 'var(--red)', cursor: 'pointer',
                    }}
                    title="Remover acesso">
                    <i className="ti ti-x" aria-hidden="true"></i>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Disponíveis na biblioteca */}
          <div style={{
            fontSize: 10, letterSpacing: 1, color: 'var(--text3)',
            textTransform: 'uppercase', fontWeight: 500, marginBottom: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Disponíveis na biblioteca ({todos.length - atribuidos.length})</span>
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar..."
              style={{ width: 180, padding: '4px 8px', fontSize: 11, margin: 0 }}
            />
          </div>
          {todos.length === 0 ? (
            <div style={{
              padding: '12px 14px', borderRadius: 8, background: 'var(--bg2)',
              fontSize: 12, color: 'var(--text3)',
            }}>
              Sua biblioteca está vazia. Suba o primeiro e-book pelo menu "Biblioteca" ou pelo botão acima.
            </div>
          ) : disponiveis.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '4px 0' }}>
              Nenhum e-book disponível com esses filtros.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {disponiveis.map(eb => {
                const tag = EBOOK_TAGS.find(t => t.id === (eb.tag ?? 'outro'));
                return (
                  <div key={eb.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 10, borderRadius: 8,
                    background: 'var(--white)',
                    border: '0.5px solid var(--border)',
                  }}>
                    <i className="ti ti-file-text" style={{ fontSize: 16, color: 'var(--text3)' }} aria-hidden="true"></i>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{eb.titulo}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {tag?.label ?? 'Outro'}{eb.descricao && ` · ${eb.descricao.slice(0, 60)}${eb.descricao.length > 60 ? '...' : ''}`}
                      </div>
                    </div>
                    <button onClick={() => abrir(eb)} className="btn-outline" style={{ fontSize: 11, padding: '4px 10px' }}>
                      <i className="ti ti-eye" aria-hidden="true"></i> Ver
                    </button>
                    <button onClick={() => toggle(eb.id)} className="btn" style={{ fontSize: 11, padding: '4px 10px' }}>
                      <i className="ti ti-plus" aria-hidden="true"></i> Atribuir
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {uploadOpen && (
        <ModalUploadEbookPaciente
          nutriId={nutriId} pacienteId={pacienteId}
          onClose={() => setUploadOpen(false)}
          onSaved={() => { setUploadOpen(false); carregar(); }}
        />
      )}
    </>
  );
}


function ModalUploadEbookPaciente({ nutriId, pacienteId, onClose, onSaved }) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tag, setTag] = useState('guia');
  const [arquivo, setArquivo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);

  async function enviar() {
    setErro(null);
    if (!arquivo) return setErro('Selecione um arquivo PDF.');
    if (!titulo.trim()) return setErro('Informe um título.');
    setBusy(true);
    const ext = (arquivo.name.split('.').pop() || 'pdf').toLowerCase();
    const path = `${nutriId}/${Date.now()}-${titulo.trim().replace(/[^a-z0-9]/gi, '_')}.${ext}`;
    const { error: upErr } = await supabase.storage.from('ebooks')
      .upload(path, arquivo, { contentType: arquivo.type });
    if (upErr) { setBusy(false); return setErro('Upload falhou: ' + upErr.message); }

    const { data: insData, error: insErr } = await supabase.from('ebooks').insert({
      nutri_id: nutriId,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      tag, storage_path: path,
    }).select().single();
    if (insErr) {
      await supabase.storage.from('ebooks').remove([path]);
      setBusy(false);
      return setErro('Erro: ' + insErr.message);
    }
    // Já atribui à paciente atual
    await supabase.from('ebooks_pacientes').insert({
      ebook_id: insData.id, paciente_id: pacienteId,
    });
    setBusy(false);
    onSaved();
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--white)', borderRadius: 12,
        maxWidth: 480, width: '100%', maxHeight: '90vh',
        overflow: 'auto', padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Subir e-book pra essa paciente</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              Vai pra biblioteca e já atribui automaticamente
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--text3)', padding: 4,
          }}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>

        <label className="form-lbl">Arquivo (PDF)</label>
        <input type="file" accept="application/pdf" onChange={e => setArquivo(e.target.files?.[0] ?? null)}
          style={{ padding: 6 }} />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          {arquivo ? `${arquivo.name} · ${(arquivo.size / 1024 / 1024).toFixed(1)} MB` : 'Nenhum arquivo selecionado'}
        </div>

        <label className="form-lbl" style={{ marginTop: 12 }}>Título</label>
        <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Cardápio especial low-carb" />

        <label className="form-lbl" style={{ marginTop: 12 }}>Categoria</label>
        <select value={tag} onChange={e => setTag(e.target.value)}>
          {EBOOK_TAGS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        <label className="form-lbl" style={{ marginTop: 12 }}>Descrição (opcional)</label>
        <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 64 }} />

        {erro && (
          <div style={{
            background: 'var(--red-bg)', color: 'var(--red)',
            padding: '6px 10px', borderRadius: 6, fontSize: 11, marginTop: 10,
          }}>{erro}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancelar</button>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={enviar} disabled={busy || !arquivo}>
            <i className="ti ti-upload" aria-hidden="true"></i> {busy ? 'Enviando...' : 'Subir e atribuir'}
          </button>
        </div>
      </div>
    </div>
  );
}
