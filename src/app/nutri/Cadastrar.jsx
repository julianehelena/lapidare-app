import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';
import { dataBR } from '../../lib/utils.js';

const OBJETIVOS = ['Emagrecimento', 'Hipertrofia', 'Reeducação alimentar', 'Saúde geral', 'Performance esportiva'];
const PLANOS    = [
  { v: 'trimestral',     l: 'Trimestral' },
  { v: 'semestral',      l: 'Semestral' },
  { v: 'consultoria',    l: 'Consultoria' },
  { v: 'acompanhamento', l: 'Acompanhamento' },
];
const MODALIDADES = ['Presencial', 'Online', 'Híbrido'];
const SEXOS = [
  { v: 'feminino',  l: 'Feminino' },
  { v: 'masculino', l: 'Masculino' },
];

export default function Cadastrar() {
  const { user } = useSession();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [sexo, setSexo] = useState('feminino');
  const [objetivo, setObjetivo] = useState('Emagrecimento');
  const [tipoPlano, setTipoPlano] = useState('trimestral');
  const [modalidade, setModalidade] = useState('Online');
  const [obs, setObs] = useState('');

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);   // pendente criado (objeto)
  const [pendentes, setPendentes] = useState([]);

  async function carregarPendentes() {
    if (!user) return;
    const { data } = await supabase
      .from('pacientes_pendentes')
      .select('*')
      .eq('nutri_id', user.id)
      .neq('status', 'ativado')
      .order('created_at', { ascending: false });
    setPendentes(data ?? []);
  }
  useEffect(() => { carregarPendentes(); }, [user]);

  function resetForm() {
    setNome(''); setEmail(''); setNascimento(''); setSexo('feminino');
    setObjetivo('Emagrecimento'); setTipoPlano('trimestral');
    setModalidade('Online'); setObs('');
  }

  async function salvar(e) {
    e?.preventDefault?.();
    setErro(null); setSucesso(null);
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!email.trim()) return setErro('Informe o email.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErro('Email inválido.');

    setBusy(true);
    const payload = {
      nutri_id: user.id,
      nome: nome.trim(),
      email: email.trim().toLowerCase(),
      nascimento: nascimento || null,
      sexo,
      objetivo,
      tipo_plano: tipoPlano,
      modalidade,
      obs: obs.trim() || null,
      status: 'pendente',
    };
    // upsert (caso já exista pendente com mesmo email, atualiza dados)
    const { data, error } = await supabase
      .from('pacientes_pendentes')
      .upsert(payload, { onConflict: 'nutri_id,email' })
      .select('*')
      .single();
    setBusy(false);
    if (error) return setErro('Erro ao cadastrar: ' + error.message);

    setSucesso(data);
    resetForm();
    carregarPendentes();
  }

  function linkDe(pendente) {
    return `${window.location.origin}/signup-paciente/${user.id}/${pendente.token}`;
  }

  function mensagemWhats(pendente) {
    const link = linkDe(pendente);
    const primeiroNome = pendente.nome.split(' ')[0];
    return encodeURIComponent(
      `Oi ${primeiroNome}! 😊\n\nPreparei seu acesso ao app de acompanhamento nutricional. Clica no link abaixo, cria sua senha e já entra:\n\n${link}\n\nQualquer dúvida, me chama por aqui!`
    );
  }

  async function copiarLink(pendente) {
    try {
      await navigator.clipboard.writeText(linkDe(pendente));
      alert('Link copiado!');
    } catch {
      prompt('Copie o link abaixo:', linkDe(pendente));
    }
  }

  async function excluirPendente(pendente) {
    if (!window.confirm(`Excluir cadastro pendente de "${pendente.nome}"?`)) return;
    await supabase.from('pacientes_pendentes').delete().eq('id', pendente.id);
    carregarPendentes();
  }

  return (
    <>
      <div className="page-title">Cadastrar paciente</div>
      <div className="page-sub">Preencha os dados da paciente — ela recebe um link pra criar só a senha</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>

        {/* ─── Formulário ─── */}
        <form onSubmit={salvar} className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Novo cadastro</div>

          <Field label="Nome completo *" value={nome} onChange={setNome} required autoFocus />
          <Field label="Email *" type="email" value={email} onChange={setEmail} required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Data de nascimento" type="date" value={nascimento} onChange={setNascimento} />
            <SelectField label="Sexo" value={sexo} onChange={setSexo} options={SEXOS} />
          </div>

          <SelectField label="Objetivo" value={objetivo} onChange={setObjetivo} options={OBJETIVOS} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SelectField label="Tipo de plano" value={tipoPlano} onChange={setTipoPlano} options={PLANOS} />
            <SelectField label="Modalidade" value={modalidade} onChange={setModalidade} options={MODALIDADES} />
          </div>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{
              display: 'block', fontSize: 11, color: 'var(--text3)',
              marginBottom: 5, fontWeight: 500,
            }}>Observação (opcional)</span>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
              placeholder="Ex: indicada pela Camila"
              style={{
                width: '100%', padding: '10px 12px', fontSize: 13,
                border: '0.5px solid var(--border)', borderRadius: 8,
                outline: 'none', fontFamily: 'var(--font-sans)',
                resize: 'vertical', boxSizing: 'border-box',
              }} />
          </label>

          {erro && (
            <div style={{
              fontSize: 12, padding: '8px 12px', borderRadius: 6, marginBottom: 10,
              background: 'var(--red-bg)', color: 'var(--red)',
            }}>{erro}</div>
          )}

          <button type="submit" className="btn" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            <i className="ti ti-user-plus" aria-hidden="true"></i>
            {busy ? 'Cadastrando...' : 'Cadastrar e gerar link'}
          </button>
        </form>

        {/* ─── Painel direito: sucesso recente OU instruções ─── */}
        <div>
          {sucesso ? (
            <CartaoSucesso pendente={sucesso}
              link={linkDe(sucesso)}
              mensagemWhats={mensagemWhats(sucesso)}
              onCopiar={() => copiarLink(sucesso)}
              onDispensar={() => setSucesso(null)} />
          ) : (
            <div className="al-b" style={{ marginBottom: 12 }}>
              <i className="ti ti-info-circle" style={{ fontSize: 16, color: 'var(--blue)', marginTop: 1 }} aria-hidden="true"></i>
              <div>
                <div className="al-t" style={{ color: 'var(--blue)' }}>Como funciona</div>
                <div className="al-d">
                  Você preenche os dados administrativos (objetivo, plano, modalidade).
                  O sistema gera um link único, você envia pra paciente, e ela só precisa criar a senha.
                  Os dados já chegam pré-preenchidos pra ela — sem confusão.
                </div>
              </div>
            </div>
          )}

          {/* ─── Lista de pendentes ─── */}
          <div className="section-label" style={{ marginTop: 4 }}>
            Cadastros pendentes ({pendentes.length})
          </div>
          {pendentes.length === 0 ? (
            <div style={{
              padding: '14px 16px', fontSize: 12, color: 'var(--text3)',
              background: 'var(--bg2)', borderRadius: 8,
            }}>
              Nenhuma paciente aguardando — todas que você cadastrou já criaram conta.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendentes.map(p => (
                <div key={p.id} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.nome}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {p.email} · cadastrada em {dataBR(p.created_at)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                        {p.objetivo} · {p.tipo_plano} · {p.modalidade}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 999,
                      background: p.status === 'enviado' ? 'var(--green-bg)' : 'var(--orange-bg)',
                      color:      p.status === 'enviado' ? 'var(--green)'    : 'var(--orange)',
                      fontWeight: 500,
                    }}>
                      {p.status === 'enviado' ? '✓ Link enviado' : 'Aguardando envio'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn-outline" onClick={() => copiarLink(p)}
                      style={{ fontSize: 11, padding: '4px 10px' }}>
                      <i className="ti ti-copy" aria-hidden="true"></i> Copiar link
                    </button>
                    <a className="btn-outline"
                      href={`https://wa.me/?text=${mensagemWhats(p)}`}
                      target="_blank" rel="noreferrer"
                      onClick={async () => {
                        await supabase.from('pacientes_pendentes')
                          .update({ status: 'enviado' }).eq('id', p.id);
                        carregarPendentes();
                      }}
                      style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>
                      <i className="ti ti-brand-whatsapp" aria-hidden="true"></i> WhatsApp
                    </a>
                    <button onClick={() => excluirPendente(p)}
                      style={{
                        background: 'none', border: '0.5px solid var(--red)',
                        borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                        color: 'var(--red)', marginLeft: 'auto',
                      }}>
                      <i className="ti ti-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}


function CartaoSucesso({ pendente, link, mensagemWhats, onCopiar, onDispensar }) {
  return (
    <div style={{
      padding: 16, borderRadius: 12,
      background: 'var(--green-bg, #ecfdf5)',
      border: '0.5px solid var(--green, #10b981)',
      borderLeft: '3px solid var(--green, #10b981)',
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green, #10b981)', marginBottom: 4 }}>
            ✓ {pendente.nome.split(' ')[0]} cadastrada
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Agora envie o link abaixo. Ela só vai precisar criar a senha.
          </div>
        </div>
        <button onClick={onDispensar}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: 'var(--text3)', padding: 0,
          }}>
          <i className="ti ti-x" aria-hidden="true"></i>
        </button>
      </div>
      <div style={{
        marginTop: 10, padding: '8px 10px',
        background: 'var(--white)', borderRadius: 6,
        fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-soft)',
        wordBreak: 'break-all',
      }}>{link}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="btn" onClick={onCopiar} style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>
          <i className="ti ti-copy" aria-hidden="true"></i> Copiar link
        </button>
        <a className="btn-outline"
          href={`https://wa.me/?text=${mensagemWhats}`}
          target="_blank" rel="noreferrer"
          style={{ flex: 1, justifyContent: 'center', fontSize: 12, textDecoration: 'none' }}>
          <i className="ti ti-brand-whatsapp" aria-hidden="true"></i> WhatsApp
        </a>
      </div>
    </div>
  );
}


function Field({ label, value, onChange, type = 'text', required, autoFocus }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{
        display: 'block', fontSize: 11, color: 'var(--text3)',
        marginBottom: 5, fontWeight: 500,
      }}>{label}</span>
      <input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        required={required} autoFocus={autoFocus}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          border: '0.5px solid var(--border)', borderRadius: 8,
          outline: 'none', fontFamily: 'var(--font-sans)',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  const opts = options.map(o => typeof o === 'string' ? { v: o, l: o } : o);
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{
        display: 'block', fontSize: 11, color: 'var(--text3)',
        marginBottom: 5, fontWeight: 500,
      }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          border: '0.5px solid var(--border)', borderRadius: 8,
          outline: 'none', fontFamily: 'var(--font-sans)',
          boxSizing: 'border-box',
        }}>
        {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
