import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';
import { useTheme } from '../../lib/theme.jsx';
import { textoDias, dataConsultaBR, diasAte, linkCall, consultaEmBreve, gerarGoogleCalendarUrl, gen } from '../../lib/utils.js';

export default function Inicio() {
  const tema = useTheme();
  const nutriNome = tema.nutri_nome ?? 'Sua nutri';
  const navigate = useNavigate();
  const { user, profile } = useSession();
  const [plano, setPlano] = useState(null);
  const [compras, setCompras] = useState(null);
  const [proximaConsulta, setProximaConsulta] = useState(null);
  const [checkinPendente, setCheckinPendente] = useState(null);
  const [ebooksNovos, setEbooksNovos] = useState(0);
  const [habitos, setHabitos] = useState([]);
  const [habitosLogs, setHabitosLogs] = useState({});  // { habito_id: valor }
  const [habitosStreak, setHabitosStreak] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const agora = new Date().toISOString();
      const hoje  = new Date().toISOString().slice(0, 10);
      const [planoRes, comprasRes, consultaRes, checkinRes, ebooksRes, habitosRes, logsHojeRes] = await Promise.all([
        supabase.from('planos').select('dados, publicado_em')
          .eq('paciente_id', user.id).order('publicado_em', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('listas_compras').select('dados, publicado_em')
          .eq('paciente_id', user.id).order('publicado_em', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('consultas').select('id, data_hora, tipo, duracao_min, meet_link, links_extras')
          .eq('paciente_id', user.id).eq('status', 'agendada')
          .gte('data_hora', agora).order('data_hora', { ascending: true }).limit(1).maybeSingle(),
        supabase.from('checkin_envios').select('id, enviado_em, lembrete_enviado_em, nome, tipo')
          .eq('paciente_id', user.id).is('respondido_em', null)
          .order('enviado_em', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('ebooks_pacientes').select('id', { count: 'exact', head: true })
          .eq('paciente_id', user.id).is('visto_em', null),
        supabase.from('habitos').select('id, nome, emoji, tipo, meta, unidade, ordem')
          .eq('paciente_id', user.id).eq('ativo', true).order('ordem'),
        supabase.from('habitos_logs').select('habito_id, valor, data')
          .eq('paciente_id', user.id)
          .gte('data', new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
      ]);
      if (!active) return;
      setPlano(planoRes.data?.dados ?? null);
      setCompras(comprasRes.data?.dados ?? null);
      setProximaConsulta(consultaRes.data ?? null);
      setCheckinPendente(checkinRes.data ?? null);
      setEbooksNovos(ebooksRes.count ?? 0);

      const habitosLista = habitosRes.data ?? [];
      const logsHoje = {};
      for (const l of (logsHojeRes.data ?? [])) {
        if (l.data === hoje) logsHoje[l.habito_id] = Number(l.valor);
      }
      setHabitos(habitosLista);
      setHabitosLogs(logsHoje);

      // Calcula streak (dias seguidos com todos cumpridos)
      const todosLogs = logsHojeRes.data ?? [];
      let streakCount = 0;
      for (let i = 0; i < 30; i++) {
        const dia = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const todos = habitosLista.every(h => {
          const log = todosLogs.find(l => l.habito_id === h.id && l.data === dia);
          if (!log) return false;
          const v = Number(log.valor);
          if (h.tipo === 'boolean') return v >= 1;
          if (h.tipo === 'numero')  return h.meta ? v >= h.meta : v > 0;
          if (h.tipo === 'escala')  return v >= 4;
          return false;
        });
        if (todos && habitosLista.length > 0) streakCount++; else break;
      }
      setHabitosStreak(streakCount);
    }
    load();
    return () => { active = false; };
  }, [user]);

  const proximaRef = plano?.refeicoes?.find(r => !r.feita) ?? plano?.refeicoes?.[0] ?? null;
  const totalCompras = compras?.lista?.reduce((a, c) => a + (c.itens?.length ?? 0), 0) ?? 0;

  const dias = proximaConsulta ? diasAte(proximaConsulta.data_hora) : null;
  const urgente = dias !== null && dias <= 1; // hoje ou amanhã
  const emBreve = proximaConsulta ? consultaEmBreve(proximaConsulta.data_hora) : false;
  const callUrl = proximaConsulta ? linkCall(proximaConsulta) : null;
  const gcalUrl = proximaConsulta ? gerarGoogleCalendarUrl({
    titulo: `Consulta com ${nutriNome}`,
    dataHoraInicio: proximaConsulta.data_hora,
    duracaoMin: proximaConsulta.duracao_min,
    descricao: `Link da call: ${callUrl ?? ''}`,
    local: 'Online',
  }) : null;

  // Lembrete de check-in: se foi enviado pela nutri E ainda não respondido.
  // Se houver `lembrete_enviado_em`, fica em estilo "urgente" (gradiente forte).
  const ckUrgente = !!checkinPendente?.lembrete_enviado_em;

  async function marcarEbooksComoVistos() {
    await supabase.from('ebooks_pacientes')
      .update({ visto_em: new Date().toISOString() })
      .eq('paciente_id', user.id).is('visto_em', null);
    navigate('/paciente/ebooks');
  }

  function cumpriuHabito(h, valor) {
    if (valor === undefined || valor === null) return false;
    if (h.tipo === 'boolean') return valor >= 1;
    if (h.tipo === 'numero')  return h.meta ? valor >= h.meta : valor > 0;
    if (h.tipo === 'escala')  return valor >= 4;
    return false;
  }

  async function setValorHabito(habito, valor) {
    const hoje = new Date().toISOString().slice(0, 10);
    // Update otimista
    setHabitosLogs(prev => ({ ...prev, [habito.id]: valor }));
    if (valor === 0 && habito.tipo === 'boolean') {
      // Toggle off pra boolean: remove o log
      const { data: existente } = await supabase.from('habitos_logs')
        .select('id').eq('habito_id', habito.id).eq('data', hoje).maybeSingle();
      if (existente) await supabase.from('habitos_logs').delete().eq('id', existente.id);
      setHabitosLogs(prev => {
        const novo = { ...prev };
        delete novo[habito.id];
        return novo;
      });
    } else {
      await supabase.from('habitos_logs').upsert({
        habito_id: habito.id, paciente_id: user.id,
        data: hoje, valor,
      }, { onConflict: 'habito_id,data' });
    }
  }

  const habitosCumpridos = habitos.filter(h => cumpriuHabito(h, habitosLogs[h.id])).length;

  return (
    <>
      {/* Aviso de e-books novos */}
      {ebooksNovos > 0 && (
        <div onClick={marcarEbooksComoVistos}
          style={{
            margin: '0 16px 12px', padding: '14px 16px',
            background: 'linear-gradient(135deg, var(--gold-soft, var(--bg-soft)), var(--white))',
            border: '0.5px solid var(--gold-deep)',
            borderRadius: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'var(--gold-deep)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>📚</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase',
              color: 'var(--gold-deep)', fontWeight: 500, marginBottom: 2,
            }}>Novo material</div>
            <div className="serif" style={{ fontSize: 17, lineHeight: 1.1 }}>
              {ebooksNovos === 1
                ? 'Você tem 1 e-book novo'
                : `Você tem ${ebooksNovos} e-books novos`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Toque para abrir
            </div>
          </div>
          <i className="ti ti-chevron-right" style={{ fontSize: 18, color: 'var(--muted)' }} aria-hidden="true"></i>
        </div>
      )}

      {/* Visão completa dos hábitos do dia (interativa) */}
      {habitos.length > 0 && (
        <div style={{
          margin: '0 16px 14px', padding: 16,
          background: 'var(--white)',
          border: `0.5px solid ${habitosCumpridos === habitos.length ? 'var(--green, var(--hair))' : 'var(--hair)'}`,
          borderRadius: 16,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{
                fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase',
                color: 'var(--muted)', fontWeight: 500,
              }}>Hábitos de hoje</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                {habitosCumpridos}<span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>/{habitos.length}</span>
                {habitosCumpridos === habitos.length && habitos.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 14 }}>🎉</span>
                )}
              </div>
            </div>
            {habitosStreak > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px',
                background: 'var(--orange-bg, var(--bg-soft))',
                borderRadius: 999, fontSize: 11,
                color: 'var(--orange, var(--gold-deep))', fontWeight: 500,
              }}>
                <i className="ti ti-flame" aria-hidden="true"></i>
                {habitosStreak} dia{habitosStreak === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {/* Lista de hábitos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {habitos.map(h => {
              const valor = habitosLogs[h.id];
              const ok = cumpriuHabito(h, valor);
              return (
                <div key={h.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  background: ok ? 'var(--green-soft, var(--bg-soft))' : 'var(--bg-soft)',
                  border: `0.5px solid ${ok ? 'var(--green, transparent)' : 'transparent'}`,
                }}>
                  <span style={{ fontSize: 18 }}>{h.emoji ?? '✨'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                      textDecoration: ok && h.tipo === 'boolean' ? 'line-through' : 'none',
                      opacity: ok && h.tipo === 'boolean' ? 0.7 : 1,
                    }}>{h.nome}</div>
                  </div>

                  {h.tipo === 'boolean' && (
                    <button onClick={() => setValorHabito(h, ok ? 0 : 1)}
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: ok ? 'var(--green, var(--gold-deep))' : 'var(--white)',
                        color: ok ? '#fff' : 'var(--muted-2)',
                        border: `1.5px solid ${ok ? 'var(--green, var(--gold-deep))' : 'var(--hair)'}`,
                        cursor: 'pointer', fontSize: 14, padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                      {ok && <i className="ti ti-check" aria-hidden="true"></i>}
                    </button>
                  )}

                  {h.tipo === 'numero' && (() => {
                    const v = valor ?? 0;
                    const meta = h.meta ?? 0;
                    const passo = meta && meta < 5 ? 0.5 : 1;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => setValorHabito(h, Math.max(0, Number((v - passo).toFixed(1))))}
                          style={{
                            width: 26, height: 26, borderRadius: 6,
                            background: 'var(--white)', border: '1px solid var(--hair)',
                            cursor: 'pointer', fontSize: 14, color: 'var(--ink)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>−</button>
                        <div style={{
                          minWidth: 60, textAlign: 'center', fontSize: 12,
                          color: 'var(--ink)', fontWeight: 600,
                        }}>
                          {v}<span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                            {meta ? `/${meta}` : ''} {h.unidade ?? ''}
                          </span>
                        </div>
                        <button onClick={() => setValorHabito(h, Number((v + passo).toFixed(1)))}
                          style={{
                            width: 26, height: 26, borderRadius: 6,
                            background: 'var(--white)', border: '1px solid var(--hair)',
                            cursor: 'pointer', fontSize: 14, color: 'var(--ink)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>+</button>
                      </div>
                    );
                  })()}

                  {h.tipo === 'escala' && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[1,2,3,4,5].map(n => {
                        const ativo = (valor ?? 0) === n;
                        const emoji = ['😞','😕','😐','🙂','😄'][n-1];
                        return (
                          <button key={n} onClick={() => setValorHabito(h, n)}
                            style={{
                              width: 26, height: 26, borderRadius: 6,
                              background: ativo ? 'var(--gold-deep)' : 'transparent',
                              border: 'none', cursor: 'pointer', fontSize: 14, padding: 0,
                              opacity: ativo ? 1 : 0.5,
                            }}>{emoji}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ver detalhes */}
          <button onClick={() => navigate('/paciente/habitos')}
            style={{
              width: '100%', marginTop: 10, padding: '8px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
            Ver histórico completo
            <i className="ti ti-chevron-right" style={{ fontSize: 12 }} aria-hidden="true"></i>
          </button>
        </div>
      )}

      {/* Lembrete de check-in pendente */}
      {checkinPendente && (
        <div
          onClick={() => navigate(`/paciente/checkin/${checkinPendente.id}`)}
          style={{
            margin: '0 16px 12px',
            background: ckUrgente
              ? 'linear-gradient(135deg, #ffd9c4 0%, #f5a373 100%)'
              : 'var(--paper)',
            border: ckUrgente ? 'none' : '1.5px dashed var(--gold)',
            borderRadius: 14,
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer',
          }}>
          <div style={{
            width: 42, height: 42, borderRadius: 11,
            background: ckUrgente ? 'rgba(28,23,18,.12)' : 'var(--gold-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <i className="ti ti-clipboard-text" style={{
              fontSize: 20, color: ckUrgente ? 'var(--ink)' : 'var(--gold-deep)',
            }} aria-hidden="true"></i>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase',
              color: ckUrgente ? 'var(--ink)' : 'var(--gold-deep)',
              fontWeight: 500, marginBottom: 2,
            }}>
              {ckUrgente
                ? 'Lembrete · pendente'
                : checkinPendente.tipo === 'pre_consulta'
                  ? 'Check-in pré-consulta'
                  : 'Check-in pendente'}
            </div>
            <div className="serif" style={{ fontSize: 18, lineHeight: 1.1, marginBottom: 2 }}>
              {checkinPendente.tipo === 'pre_consulta'
                ? 'Antes da nossa primeira consulta'
                : (checkinPendente.nome || 'Sua Dra. pediu um check-in')}
            </div>
            <div style={{ fontSize: 11, color: ckUrgente ? 'var(--ink)' : 'var(--muted)', opacity: ckUrgente ? .8 : 1 }}>
              {checkinPendente.tipo === 'pre_consulta'
                ? 'Toque para responder — leva uns 5 minutos'
                : 'Toque para responder · leva uns 3 minutos'}
            </div>
          </div>
          <i className="ti ti-chevron-right" style={{ fontSize: 18, color: ckUrgente ? 'var(--ink)' : 'var(--muted)', flexShrink: 0 }} aria-hidden="true"></i>
        </div>
      )}

      {/* Lembrete de consulta */}
      {proximaConsulta && (
        <div style={{
          margin: '0 16px 12px',
          background: urgente
            ? 'linear-gradient(135deg, var(--gold) 0%, var(--gold-deep) 100%)'
            : 'linear-gradient(135deg, var(--gold-soft) 0%, var(--bg-soft) 100%)',
          border: urgente ? 'none' : '0.5px solid var(--gold)',
          borderRadius: 14,
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 14,
          color: urgente ? 'var(--ink)' : 'var(--ink)',
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 11,
            background: urgente ? 'rgba(28,23,18,.12)' : 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="ti ti-calendar-event"
               style={{ fontSize: 20, color: urgente ? 'var(--ink)' : 'var(--gold-deep)' }}
               aria-hidden="true"></i>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase',
              color: urgente ? 'var(--ink)' : 'var(--gold-deep)',
              fontWeight: 500, marginBottom: 2, opacity: urgente ? .85 : 1,
            }}>
              Próxima consulta
            </div>
            <div className="serif" style={{ fontSize: 20, lineHeight: 1.1, marginBottom: 2 }}>
              {textoDias(proximaConsulta.data_hora)}
            </div>
            <div style={{ fontSize: 11, color: urgente ? 'var(--ink)' : 'var(--muted)', opacity: urgente ? .8 : 1 }}>
              {dataConsultaBR(proximaConsulta.data_hora)} · {proximaConsulta.duracao_min}min
            </div>
            {callUrl && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <a href={callUrl} target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: emBreve ? 'var(--green)' : (urgente ? 'rgba(28,23,18,.85)' : 'var(--ink)'),
                    color: 'var(--bg-soft)',
                    padding: emBreve ? '8px 14px' : '6px 12px',
                    borderRadius: 10,
                    fontSize: emBreve ? 12 : 11,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}>
                  <i className="ti ti-video" style={{ fontSize: 14 }} aria-hidden="true"></i>
                  {emBreve ? 'Entrar na call agora' : 'Entrar na call'}
                </a>
                {gcalUrl && !urgente && (
                  <a href={gcalUrl} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: 'transparent',
                      color: 'var(--muted)',
                      border: '0.5px solid var(--hair)',
                      padding: '6px 12px', borderRadius: 10,
                      fontSize: 11, fontWeight: 500,
                      textDecoration: 'none',
                    }}>
                    <i className="ti ti-calendar-plus" style={{ fontSize: 13 }} aria-hidden="true"></i>
                    Adicionar à agenda
                  </a>
                )}
              </div>
            )}
            {Array.isArray(proximaConsulta.links_extras) && proximaConsulta.links_extras.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {proximaConsulta.links_extras.map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: 'transparent',
                      color: urgente ? 'var(--ink)' : 'var(--gold-deep)',
                      border: '0.5px solid ' + (urgente ? 'rgba(28,23,18,.4)' : 'var(--gold)'),
                      padding: '5px 10px', borderRadius: 10,
                      fontSize: 11, fontWeight: 500,
                      textDecoration: 'none',
                    }}>
                    <i className="ti ti-external-link" style={{ fontSize: 12 }} aria-hidden="true"></i>
                    {link.label || 'Link'}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hero — próxima refeição */}
      {proximaRef ? (
        <div className="card dark" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--bg-soft)', opacity: .6 }}>
              Próxima refeição{proximaRef.horario ? ` · ${proximaRef.horario}` : ''}
            </span>
            {proximaRef.emoji && (
              <span className="pill" style={{ background: 'var(--gold)', color: 'var(--ink)' }}>{proximaRef.emoji}</span>
            )}
          </div>
          <div className="serif" style={{ fontSize: 22, color: 'var(--bg-soft)', lineHeight: 1.1, marginBottom: 4 }}>
            {proximaRef.nome}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 10 }}>
            {proximaRef.alimentos?.slice(0, 2).map(a => a.nome).join(' · ')}
          </div>
          <button className="btn gold sm" onClick={() => navigate('/paciente/plano')}>Ver plano completo</button>
        </div>
      ) : (
        <div className="card" style={{ padding: '20px 18px', textAlign: 'center' }}>
          <i className="ti ti-sparkles" style={{ fontSize: 28, color: 'var(--gold-deep)', display: 'block', marginBottom: 8 }}></i>
          <div className="serif" style={{ fontSize: 18, marginBottom: 4 }}>{gen(profile?.sexo, 'Bem-vindo', 'Bem-vinda')} ao seu app</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Sua nutricionista publicará seu plano em breve. Você será {gen(profile?.sexo, 'notificado', 'notificada')}!
          </div>
        </div>
      )}

      {/* Cards 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 10px' }}>
        <div className="card" style={{ margin: 0, padding: '12px 14px', cursor: 'pointer' }} onClick={() => navigate('/paciente/plano')}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <i className="ti ti-salad" style={{ fontSize: 14, color: 'var(--green)' }}></i>
            <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>Plano</span>
          </div>
          {plano ? (
            <>
              <div className="serif" style={{ fontSize: 22, lineHeight: 1 }}>
                {plano.macros?.kcal}<span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 2 }}>kcal</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                P {plano.macros?.prot_g}g · C {plano.macros?.cho_g}g · G {plano.macros?.lip_g}g
              </div>
            </>
          ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Aguardando plano</div>}
        </div>

        <div className="card" style={{ margin: 0, padding: '12px 14px', cursor: 'pointer' }} onClick={() => navigate('/paciente/compras')}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <i className="ti ti-shopping-cart" style={{ fontSize: 14, color: 'var(--orange)' }}></i>
            <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>Compras</span>
          </div>
          {compras ? (
            <div className="serif" style={{ fontSize: 22, lineHeight: 1 }}>
              {totalCompras}<span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 2 }}>itens</span>
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Lista não enviada</div>}
        </div>

        <div className="card" style={{ margin: 0, padding: '12px 14px', cursor: 'pointer' }} onClick={() => navigate('/paciente/progresso')}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <i className="ti ti-trending-up" style={{ fontSize: 14, color: 'var(--blue)' }}></i>
            <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>Progresso</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Veja sua evolução</div>
        </div>

        <div className="card" style={{ margin: 0, padding: '12px 14px', cursor: 'pointer' }} onClick={() => navigate('/paciente/chat')}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <i className="ti ti-message-circle" style={{ fontSize: 14, color: 'var(--gold-deep)' }}></i>
            <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>Chat</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Falar com a Dra.</div>
        </div>
      </div>
    </>
  );
}
